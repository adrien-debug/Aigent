/**
 * AIG-TRADE-001 — TradeAgent delivery package (Lot 10).
 *
 * Produces a VERSIONED, NON-ACTIVATED delivery package for a trading agent,
 * in exactly the shape TradeAgent's intake expects:
 *   agents/<slug>/manifest.json + README.md + handler.ts, plus a
 *   `_registry.json` entry { slug, name, version, model, runtime, source,
 *   pushedAt, manifestPath }.
 *
 * This module ONLY BUILDS the package object + integrity checksum. It NEVER
 * writes to the TradeAgent repo, NEVER calls its API, NEVER activates anything
 * (invariants #20/#22; prompt Lot 10 "ne pas écrire dans TradeAgent, ne pas
 * promouvoir automatiquement"). Persisting/pushing is a separate, human-gated
 * step outside this mission.
 *
 * Delivery status is honest (prompt Lot 10):
 *   DELIVERABLE-LIVE     — only if proven against a LIVE source (not this run)
 *   DELIVERABLE-SNAPSHOT — proven on SNAPSHOT/HISTORICAL data
 *   EXPERIMENTAL         — built but not fully proven
 *   BLOCKED              — a security/contract gate failed
 *   REJECTED             — rejected by human decision
 */

import { createHash } from 'node:crypto'
import type { TradingAgentDef } from './agents/roster'

export type DeliveryStatus =
  | 'DELIVERABLE-LIVE'
  | 'DELIVERABLE-SNAPSHOT'
  | 'EXPERIMENTAL'
  | 'BLOCKED'
  | 'REJECTED'

/** A manifest in TradeAgent-intake shape (subset we control here). */
export interface DeliveredManifest {
  id: string
  copilotId: string
  version: string
  systemPromptSummary: string
  allowedRoutes: string[]
  forbiddenActions: string[]
  confirmationPolicy: 'never' | 'risky-only' | 'always'
  alwaysConfirmActions: string[]
  memorySources: unknown[]
  outputContract: { format: string; invariants: string[]; schemaName: string | null }
  toolIds: string[]
  maxStepsPerRun: number
  maxCostPerRunUsd: number
  updatedAt: string
  skills: Array<{ label: string; detail?: string }>
}

export interface EvidenceSummary {
  /** Truth level the agent was actually proven at. */
  evidenceLevel: 'LIVE' | 'SNAPSHOT' | 'NONE'
  testsPassed: number
  testsTotal: number
  securityScore: number // 0..1, must be 1 to deliver
  contractCompliance: number // 0..1
  benchmarkGlobal: number // 0..1
  gatesBlocked: boolean
  blockReasons: string[]
  costUsd: number | null
  latencyMs: number | null
}

export interface DeliveryPackage {
  slug: string
  name: string
  version: string
  model: string
  runtime: string
  source: 'aigent'
  /** ISO timestamp of package creation — injected, never Date.now() here. */
  builtAt: string
  status: DeliveryStatus
  manifest: DeliveredManifest
  outputContractName: string
  requiredTools: string[]
  permissions: { allowedRoutes: string[]; forbiddenActions: string[] }
  budget: { maxStepsPerRun: number; maxCostPerRunUsd: number; maxLatencyMsTarget: number | null }
  evidence: EvidenceSummary
  sourceStatus: string[]
  /** Files as TradeAgent would receive them, keyed by repo-relative path. */
  files: Record<string, string>
  /** sha256 over the canonical JSON of {manifest, files} — integrity. */
  checksum: string
  registryEntry: {
    slug: string
    name: string
    version: string
    model: string
    runtime: string
    source: 'aigent'
    pushedAt: string
    manifestPath: string
  }
  importProcedure: string[]
  rollbackProcedure: string[]
  compatibility: string[]
}

/** Decide an honest status from evidence. Never over-claims LIVE. */
export function decideStatus(evidence: EvidenceSummary): DeliveryStatus {
  if (evidence.gatesBlocked || evidence.securityScore < 1) return 'BLOCKED'
  if (evidence.testsTotal === 0 || evidence.contractCompliance < 1) return 'EXPERIMENTAL'
  if (evidence.evidenceLevel === 'LIVE' && evidence.benchmarkGlobal >= 0.95)
    return 'DELIVERABLE-LIVE'
  if (evidence.evidenceLevel === 'SNAPSHOT' && evidence.benchmarkGlobal >= 0.95)
    return 'DELIVERABLE-SNAPSHOT'
  return 'EXPERIMENTAL'
}

/** Stable canonical JSON (sorted keys) so the checksum is reproducible. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .toSorted((a, b) => a.localeCompare(b))
        .reduce((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k]
          return acc
        }, {} as Record<string, unknown>)
    }
    return v
  })
}

export function computeChecksum(input: {
  manifest: DeliveredManifest
  files: Record<string, string>
}): string {
  return `sha256:${createHash('sha256').update(canonical(input)).digest('hex')}`
}

export interface BuildPackageInput {
  slug: string
  name: string
  version: string
  model: string
  runtime: string
  manifest: DeliveredManifest
  outputContractName: string
  requiredTools: string[]
  maxLatencyMsTarget: number | null
  evidence: EvidenceSummary
  sourceStatus: string[]
  readme: string
  handlerSource: string
  /** Injected timestamps (no clock in this pure builder). */
  builtAt: string
  pushedAt: string
}

/**
 * Build a delivery package directly from a roster agent + its evidence.
 * Maps the roster's config onto the TradeAgent-intake manifest shape. This is
 * the roster → delivery bridge; the manifest here is a DRAFT (version carries
 * `-draft`) — nothing is materialized or activated by building a package.
 */
export function packageForAgent(input: {
  agent: TradingAgentDef
  version: string
  model: string
  runtime: string
  evidence: EvidenceSummary
  sourceStatus: string[]
  builtAt: string
  pushedAt: string
}): DeliveryPackage {
  const { agent } = input
  const manifest: DeliveredManifest = {
    id: `manifest-${agent.slug}-${input.version}`,
    copilotId: `copilot-${agent.slug}`,
    version: input.version,
    systemPromptSummary: agent.systemPromptSummary,
    allowedRoutes: [...agent.allowedRoutes],
    forbiddenActions: [...agent.forbiddenActions],
    confirmationPolicy: agent.confirmationPolicy,
    alwaysConfirmActions: [...agent.alwaysConfirmActions],
    memorySources: [],
    outputContract: {
      format: agent.outputContract.format,
      invariants: [...agent.outputContract.invariants],
      schemaName: agent.outputContract.schemaName,
    },
    toolIds: [...agent.toolIds],
    maxStepsPerRun: agent.maxStepsPerRun,
    maxCostPerRunUsd: agent.maxCostPerRunUsd,
    updatedAt: input.builtAt,
    skills: agent.skills.map((s) => ({ label: s.label, ...(s.detail ? { detail: s.detail } : {}) })),
  }
  const readme = [
    `# ${agent.name} — ${agent.specialty}`,
    '',
    '> Hosted trading assistant delivered from Aigent (AIG-TRADE-001).',
    '> AI assistant — not a human trader. Read-only market analysis; never',
    '> places an order, moves funds, or accesses a key. Not investment advice.',
    '',
    agent.description,
    '',
    `- Output contract: \`${agent.outputContract.schemaName}\` (mission v1.0.0)`,
    `- Tools: ${agent.toolIds.join(', ')}`,
    `- Universe: ETH-only executable; BTC context-only.`,
  ].join('\n')
  const handlerSource = `// ${agent.slug} — hosted read-only trading assistant handler (generated).\n// Materialized by the Aigent platform; do not hand-edit. Re-push to update.\nexport const AGENT_SLUG = '${agent.slug}'\n`

  return buildDeliveryPackage({
    slug: agent.slug,
    name: agent.name,
    version: input.version,
    model: input.model,
    runtime: input.runtime,
    manifest,
    outputContractName: agent.outputContract.schemaName,
    requiredTools: [...agent.toolIds],
    maxLatencyMsTarget: agent.maxLatencyMsTarget,
    evidence: input.evidence,
    sourceStatus: input.sourceStatus,
    readme,
    handlerSource,
    builtAt: input.builtAt,
    pushedAt: input.pushedAt,
  })
}

export function buildDeliveryPackage(input: BuildPackageInput): DeliveryPackage {
  const manifestPath = `agents/${input.slug}/manifest.json`
  const files: Record<string, string> = {
    [manifestPath]: JSON.stringify(input.manifest, null, 2),
    [`agents/${input.slug}/README.md`]: input.readme,
    [`agents/${input.slug}/handler.ts`]: input.handlerSource,
  }
  const checksum = computeChecksum({ manifest: input.manifest, files })
  const status = decideStatus(input.evidence)

  return {
    slug: input.slug,
    name: input.name,
    version: input.version,
    model: input.model,
    runtime: input.runtime,
    source: 'aigent',
    builtAt: input.builtAt,
    status,
    manifest: input.manifest,
    outputContractName: input.outputContractName,
    requiredTools: input.requiredTools,
    permissions: {
      allowedRoutes: input.manifest.allowedRoutes,
      forbiddenActions: input.manifest.forbiddenActions,
    },
    budget: {
      maxStepsPerRun: input.manifest.maxStepsPerRun,
      maxCostPerRunUsd: input.manifest.maxCostPerRunUsd,
      maxLatencyMsTarget: input.maxLatencyMsTarget,
    },
    evidence: input.evidence,
    sourceStatus: input.sourceStatus,
    files,
    checksum,
    registryEntry: {
      slug: input.slug,
      name: input.name,
      version: input.version,
      model: input.model,
      runtime: input.runtime,
      source: 'aigent',
      pushedAt: input.pushedAt,
      manifestPath,
    },
    importProcedure: [
      'Human operator only — nothing here is automatic.',
      `1. Verify checksum: recompute sha256 over {manifest, files} and match ${checksum}.`,
      `2. Write files under agents/${input.slug}/ in the TradeAgent repo (via the platform GitHub push, never a direct edit).`,
      `3. Add/replace the _registry.json entry for slug "${input.slug}".`,
      '4. In TradeAgent /admin/agents "Aigent intake": the agent appears as deployed → [Activate] to enter the fleet.',
      '5. Activation is a back-office gesture — it does NOT trade, allocate, or price anything.',
    ],
    rollbackProcedure: [
      `1. In /admin/agents, redeploy the previous version (rollback) for slug "${input.slug}".`,
      '2. Or remove the _registry.json entry to fully retract the agent from intake.',
      `3. Delete agents/${input.slug}/ files if a hard removal is intended.`,
      '4. No market state is affected by any of these steps (read-only agent).',
    ],
    compatibility: [
      'Runtime: langgraph (matches TradeAgent hosted-agent intake).',
      'Universe: ETH-only executable (ETHUSDT/ETHUSDC); BTC context-only.',
      'Data: reads TradeAgent PUBLIC /api/market/* routes read-only; no write path.',
      `Output contract: ${input.outputContractName} @ mission contract v1.0.0.`,
    ],
  }
}
