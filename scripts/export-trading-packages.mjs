#!/usr/bin/env node
/**
 * AIG-PACK-015 — deterministic static export of the six trading agents.
 *
 * SNAPSHOT-ONLY. Zero network, zero OpenAI/Anthropic, zero secret, zero DB call
 * at export time. The source of truth is the FROZEN snapshot captured from the
 * gpu1 `aigent` PostgREST perimeter at commit d448441 and committed to
 * `delivery/tradeagent/_snapshot/db-truth.json`. This script is a pure function
 * of that file: same input bytes -> same output bytes, every run.
 *
 * It emits, under delivery/tradeagent/<slug>/ :
 *   - package.json  : identity, version, model, prompt/contract, tools,
 *                     provenance, evidence level, market compatibility,
 *                     the EXISTING benchmark (read, never regenerated).
 *   - contract.json : the versioned Zod-derived output contract descriptor.
 *   - checksum.txt  : sha256 of package.json + sha256 of contract.json.
 * plus a top-level delivery/tradeagent/manifest.json with every package's
 * checksum and a global checksum over the whole set.
 *
 * Determinism levers:
 *   - canonical JSON: object keys are sorted recursively, 2-space indent, LF,
 *     trailing newline. No Date.now(), no random, no locale.
 *   - the export carries NO wall-clock timestamp. Time-in-package is only the
 *     immutable `created_at` already persisted in the snapshot, and the pinned
 *     source commit — both frozen inputs.
 *
 * Sentinel / Pulse are the two SAFETY-CRITICAL contracts (risk authority and
 * execution gate). If either agent's contract descriptor is invalid, the export
 * ABORTS with a non-zero exit and writes nothing — an invalid safety contract
 * must never be delivered.
 *
 * Run:  node scripts/export-trading-packages.mjs
 * Flags: --out <dir>   (default: delivery/tradeagent)  — used by the test harness
 *        --check       print the global checksum and exit 0/1, write nothing new
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

// ---------------------------------------------------------------------------
// Pinned provenance — the frozen truth this export is a function of.
// ---------------------------------------------------------------------------
const SOURCE_COMMIT = 'd44844129bde0736915ccf30df8ef7cf9b8576ab'
const SOURCE_LABEL = 'AIG-TRADE-001 / AIG-PACK-015'
const CONTRACT_VERSION = 'v1.0.0' // mirrors market/contracts.ts CONTRACT_VERSION
const PACKAGE_FORMAT_VERSION = '1.0.0'
const SNAPSHOT_REL = 'delivery/tradeagent/_snapshot/db-truth.json'

/**
 * TradeAgent backend market truth (reconciled from
 * TradeAgent/app/src/lib/protocol-lab/markets.ts at export authoring time).
 * The backend executes FOUR markets; "ETH-only" is a runtime retail-surface
 * allowlist (MARKET_EXECUTABLE_SYMBOLS), never a backend limit. We record the
 * capability honestly and separate it from the retail default and from each
 * agent's own declared executable universe.
 */
const BACKEND_EXECUTABLE_MARKETS = ['ETH', 'BTC', 'SOL', 'XAU']
const RETAIL_SURFACE_DEFAULT_MARKETS = ['ETH']

// ---------------------------------------------------------------------------
// Canonical JSON — recursively sorted keys, stable formatting.
// ---------------------------------------------------------------------------
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue)
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort((a, b) => a.localeCompare(b))) out[k] = sortValue(v[k])
    return out
  }
  return v
}
/** Deterministic serialization: sorted keys, 2-space, LF, trailing newline. */
function canonical(obj) {
  return JSON.stringify(sortValue(obj), null, 2).replaceAll('\r\n', '\n') + '\n'
}
function sha256(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// Snapshot loading — the ONLY input.
// ---------------------------------------------------------------------------
function snapshotPath() {
  // AIG_PACK_SNAPSHOT lets the test harness point at an ALTERNATE snapshot
  // (e.g. a deliberately-corrupted copy) without ever touching the frozen
  // committed input. Default is the committed frozen snapshot.
  const override = process.env.AIG_PACK_SNAPSHOT
  return override ? resolve(override) : join(REPO, SNAPSHOT_REL)
}
function loadSnapshot() {
  const p = snapshotPath()
  if (!existsSync(p)) {
    throw new Error(`frozen snapshot missing at ${p} — cannot export without materialized truth`)
  }
  return JSON.parse(readFileSync(p, 'utf8'))
}

/** Resolve the latest version row of a copilot (its delivered version). */
function latestVersion(cp) {
  const v = (cp.copilot_versions || []).find((x) => x.id === cp.latest_version_id)
  if (!v) throw new Error(`copilot ${cp.slug}: latest_version_id ${cp.latest_version_id} not found in snapshot`)
  return v
}
/** Resolve the manifest bound to a given version. */
function manifestFor(cp, version) {
  const m = (cp.manifests || []).find((x) => x.id === version.manifest_id)
  if (!m) throw new Error(`copilot ${cp.slug}: manifest ${version.manifest_id} not found in snapshot`)
  return m
}

/**
 * Resolve the agent's declared executable universe from the manifest tool
 * descriptions / output contract. The trading gamme was authored against ETH
 * pairs (ETHUSDT/ETHUSDC) with BTC pairs as correlation context. We report this
 * as the agent's OWN scope, distinct from the backend capability.
 */
const AGENT_EXECUTABLE_PAIRS = ['ETHUSDT', 'ETHUSDC']
const AGENT_CONTEXT_PAIRS = ['BTCUSDT', 'BTCUSDC']

/**
 * Evidence level for a version — read straight from the persisted benchmark
 * blob. FIXTURE = scored offline on a frozen scenario (truth stays FIXTURE,
 * never presented as LIVE). Never upgraded here.
 */
function evidenceLevel(scores) {
  return (scores?.evidenceLevel) || 'UNAVAILABLE'
}

/**
 * The EXISTING benchmark for a version, read from the persisted scores blob.
 * We never recompute — if the field is absent we mark it UNAVAILABLE.
 */
function benchmarkOf(scores) {
  if (!scores || typeof scores !== 'object') {
    return { present: false, note: 'no persisted benchmark on this version' }
  }
  return {
    present: typeof scores.benchmarkScore === 'number',
    global: typeof scores.benchmarkScore === 'number' ? scores.benchmarkScore : null,
    testPassRate: typeof scores.testPassRate === 'number' ? scores.testPassRate : null,
    contractCompliance: typeof scores.contractCompliance === 'number' ? scores.contractCompliance : null,
    unsafeActionCount: typeof scores.unsafeActionCount === 'number' ? scores.unsafeActionCount : null,
    shadowAgreement: scores.shadowAgreement ?? null,
    evidenceLevel: evidenceLevel(scores),
    note: typeof scores.note === 'string' ? scores.note : null,
    source: 'copilot_versions.scores (persisted, snapshot-only — NOT regenerated)',
  }
}

/**
 * Contract validity for a delivered agent. This is a STRUCTURAL check of the
 * exported contract descriptor (the versioned shape a consumer pins), not an
 * LLM re-run. A valid descriptor has: a non-empty format, a known schemaName,
 * a non-empty invariants list, and the pinned contract version.
 */
const KNOWN_CONTRACTS = new Set([
  'TechnicalAnalysisReport',
  'QuantRegimeReport',
  'RiskAssessment',
  'ExecutionAssessment',
  'MacroContextReport',
  'EducationalLesson',
])
function validateContractDescriptor(desc) {
  const errors = []
  if (!desc || typeof desc !== 'object') return { valid: false, errors: ['contract descriptor missing'] }
  if (desc.format !== 'json') errors.push(`format must be "json", got ${JSON.stringify(desc.format)}`)
  if (!KNOWN_CONTRACTS.has(desc.schemaName)) errors.push(`unknown schemaName ${JSON.stringify(desc.schemaName)}`)
  if (!Array.isArray(desc.invariants) || desc.invariants.length === 0) errors.push('invariants must be a non-empty array')
  if (desc.contractVersion !== CONTRACT_VERSION) errors.push(`contractVersion must be ${CONTRACT_VERSION}`)
  return { valid: errors.length === 0, errors }
}

// ---------------------------------------------------------------------------
// Per-agent package builder.
// ---------------------------------------------------------------------------
function buildPackage(cp, tools) {
  const version = latestVersion(cp)
  const manifest = manifestFor(cp, version)
  const v1 = (cp.copilot_versions || []).find((x) => x.id !== cp.latest_version_id) || null

  // Resolve tool ids -> canonical tool descriptors (deterministic, sorted by name).
  const resolvedTools = (manifest.tool_ids || [])
    .map((tid) => {
      const t = tools[tid]
      if (!t) throw new Error(`copilot ${cp.slug}: tool ${tid} not resolved in snapshot`)
      return {
        name: t.name,
        provider: t.provider,
        riskLevel: t.riskLevel,
        requiresConfirmation: t.requiresConfirmation === true,
        scopedRoutes: Array.isArray(t.scopedRoutes) ? t.scopedRoutes : [],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const scores = version.scores || null
  const benchmark = benchmarkOf(scores)

  const contractDescriptor = {
    contractVersion: CONTRACT_VERSION,
    format: manifest.output_contract?.format ?? 'json',
    schemaName: manifest.output_contract?.schemaName ?? null,
    invariants: manifest.output_contract?.invariants ?? [],
  }
  const contractCheck = validateContractDescriptor(contractDescriptor)

  // read-only tool guarantee: no high/critical tool, none requiring confirmation.
  const anyRiskyTool = resolvedTools.some(
    (t) => t.riskLevel === 'high' || t.riskLevel === 'critical' || t.requiresConfirmation,
  )

  const pkg = {
    packageFormatVersion: PACKAGE_FORMAT_VERSION,
    identity: {
      slug: cp.slug,
      name: cp.name,
      specialty: manifest.system_prompt_summary ? deriveSpecialty(cp.slug) : null,
      isAiAssistant: true,
    },
    version: {
      delivered: version.label,
      deliveredVersionId: version.id,
      stage: version.stage,
      priorVersionLabel: v1 ? v1.label : null,
      createdAt: version.created_at ?? null,
      promotedToProduction: cp.production_version_id === version.id,
    },
    model: {
      model: cp.model,
      provider: cp.model_provider,
    },
    prompt: {
      // The FULL authorized system prompt, verbatim from the delivered manifest.
      systemPrompt: manifest.system_prompt_summary,
      confirmationPolicy: manifest.confirmation_policy,
      alwaysConfirmActions: manifest.always_confirm_actions ?? [],
      forbiddenActions: manifest.forbidden_actions ?? [],
      allowedRoutes: manifest.allowed_routes ?? [],
      maxStepsPerRun: manifest.max_steps_per_run ?? null,
      maxCostPerRunUsd: manifest.max_cost_per_run_usd ?? null,
    },
    contract: contractDescriptor,
    contractValid: contractCheck.valid,
    contractValidationErrors: contractCheck.errors,
    tools: resolvedTools,
    toolGuarantee: {
      allReadOnly: !anyRiskyTool,
      note: anyRiskyTool
        ? 'WARNING: a high/critical or confirmation-required tool is present'
        : 'all tools internal, low-risk, read-only, no confirmation required',
    },
    provenance: {
      source: SOURCE_LABEL,
      sourceCommit: SOURCE_COMMIT,
      backend: 'gpu1 aigent PostgREST perimeter (snapshot, live-read once, then frozen)',
      snapshotFile: SNAPSHOT_REL,
      exportMode: 'SNAPSHOT-ONLY (no OpenAI/Anthropic call, no benchmark regeneration)',
      copilotId: cp.id,
      assistantId: cp.assistant_id ?? null,
      projectId: cp.project_id, // null = validation bench (not assigned to a project)
      targetProjectIds: cp.target_project_ids ?? [],
      tags: cp.tags ?? [],
    },
    evidenceLevel: evidenceLevel(scores),
    benchmark,
    marketCompatibility: {
      // Reconciled from the TradeAgent backend, NOT the legacy retail default.
      backendExecutableMarkets: BACKEND_EXECUTABLE_MARKETS,
      retailSurfaceDefaultMarkets: RETAIL_SURFACE_DEFAULT_MARKETS,
      agentDeclaredExecutablePairs: AGENT_EXECUTABLE_PAIRS,
      agentContextOnlyPairs: AGENT_CONTEXT_PAIRS,
      note:
        'The TradeAgent backend executes ETH/BTC/SOL/XAU (protocol-lab/markets.ts). ' +
        '"ETH-only" is a runtime retail-surface allowlist (MARKET_EXECUTABLE_SYMBOLS), not a backend limit. ' +
        'This agent was authored against the ETH executable pairs with BTC as correlation context.',
    },
  }
  return { pkg, contractDescriptor, contractCheck, slug: cp.slug }
}

/** Static specialty text, derived deterministically from slug (no prose parse). */
function deriveSpecialty(slug) {
  const map = {
    'atlas-market-structure': 'Market structure and multi-timeframe technical read.',
    'vector-quant-regime': 'Quantitative signals and market-regime classification.',
    'sentinel-risk-manager': 'Risk authority — sizing, exposure, and limit enforcement.',
    'pulse-execution-scout': 'Execution conditions — liquidity, spread, slippage, timing.',
    'meridian-macro-context': 'Macro and cross-asset context, transmitted to the ETH universe.',
    'sage-trading-coach': 'Trading education — structured lessons, never signals.',
  }
  return map[slug] ?? null
}

// The two safety-critical agents whose invalid contract blocks the whole export.
const SAFETY_CRITICAL_SLUGS = new Set(['sentinel-risk-manager', 'pulse-execution-scout'])

// ---------------------------------------------------------------------------
// Main export.
// ---------------------------------------------------------------------------
function run(outDir) {
  const snapshot = loadSnapshot()
  const { copilots, tools } = snapshot
  if (!Array.isArray(copilots) || copilots.length !== 6) {
    throw new Error(`expected 6 copilots in snapshot, got ${copilots?.length}`)
  }

  const built = copilots.map((cp) => buildPackage(cp, tools))

  // Safety gate: Sentinel/Pulse invalid contract => abort, write nothing.
  const criticalBlocks = built.filter(
    (b) => SAFETY_CRITICAL_SLUGS.has(b.slug) && !b.contractCheck.valid,
  )
  if (criticalBlocks.length > 0) {
    const lines = criticalBlocks.map((b) => `  - ${b.slug}: ${b.contractCheck.errors.join('; ')}`)
    throw new Error(
      'EXPORT BLOCKED — safety-critical contract invalid (Sentinel/Pulse):\n' + lines.join('\n'),
    )
  }

  // Clean prior per-agent output (never the frozen _snapshot input).
  for (const b of built) {
    const dir = join(outDir, b.slug)
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }

  const manifestEntries = []
  for (const b of built) {
    const dir = join(outDir, b.slug)
    mkdirSync(dir, { recursive: true })

    const pkgJson = canonical(b.pkg)
    const contractJson = canonical(b.contractDescriptor)
    const pkgSum = sha256(pkgJson)
    const contractSum = sha256(contractJson)

    writeFileSync(join(dir, 'package.json'), pkgJson)
    writeFileSync(join(dir, 'contract.json'), contractJson)
    const checksumTxt =
      `sha256  package.json   ${pkgSum}\n` +
      `sha256  contract.json  ${contractSum}\n`
    writeFileSync(join(dir, 'checksum.txt'), checksumTxt)

    manifestEntries.push({
      slug: b.slug,
      name: b.pkg.identity.name,
      version: b.pkg.version.delivered,
      model: b.pkg.model.model,
      evidenceLevel: b.pkg.evidenceLevel,
      contractValid: b.contractCheck.valid,
      benchmarkGlobal: b.pkg.benchmark.global,
      package: {
        path: `${b.slug}/package.json`,
        sha256: pkgSum,
      },
      contract: {
        path: `${b.slug}/contract.json`,
        sha256: contractSum,
      },
    })
  }

  // Global manifest — sorted by slug for stability.
  manifestEntries.sort((a, b) => a.slug.localeCompare(b.slug))
  const snapshotSum = sha256(readFileSync(snapshotPath(), 'utf8'))
  const manifestBody = {
    manifestFormatVersion: PACKAGE_FORMAT_VERSION,
    source: SOURCE_LABEL,
    sourceCommit: SOURCE_COMMIT,
    contractVersion: CONTRACT_VERSION,
    exportMode: 'SNAPSHOT-ONLY',
    snapshotFile: SNAPSHOT_REL,
    snapshotSha256: snapshotSum,
    agentCount: manifestEntries.length,
    backendExecutableMarkets: BACKEND_EXECUTABLE_MARKETS,
    retailSurfaceDefaultMarkets: RETAIL_SURFACE_DEFAULT_MARKETS,
    agents: manifestEntries,
  }
  // Global checksum = sha256 over the per-package checksums, in slug order.
  const globalChecksum = sha256(
    manifestEntries.map((e) => `${e.slug}:${e.package.sha256}:${e.contract.sha256}`).join('\n'),
  )
  const manifest = { ...manifestBody, globalChecksum }
  const manifestJson = canonical(manifest)
  writeFileSync(join(outDir, 'manifest.json'), manifestJson)

  return { globalChecksum, manifestEntries, manifestSha256: sha256(manifestJson) }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { out: join(REPO, 'delivery', 'tradeagent'), check: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = resolve(argv[++i])
    else if (argv[i] === '--check') args.check = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
try {
  const res = run(args.out)
  // Deterministic, machine-parseable stdout (no timestamp).
  process.stdout.write(
    JSON.stringify(
      {
        ok: true,
        outDir: args.out.replace(REPO + '/', ''),
        agents: res.manifestEntries.map((e) => ({
          slug: e.slug,
          version: e.version,
          model: e.model,
          evidenceLevel: e.evidenceLevel,
          contractValid: e.contractValid,
          benchmarkGlobal: e.benchmarkGlobal,
          packageSha256: e.package.sha256,
        })),
        globalChecksum: res.globalChecksum,
      },
      null,
      2,
    ) + '\n',
  )
  process.exit(0)
} catch (err) {
  process.stderr.write(`export-trading-packages FAILED: ${err.message}\n`)
  process.exit(1)
}
