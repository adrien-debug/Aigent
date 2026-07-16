/**
 * Agent Mission Control — Target Repo Sandbox Evaluation (PURE core, no I/O).
 *
 * The last mile Aigent was missing: proving a delivered agent actually FITS the
 * repo that hosts it. The control plane already scores an agent (repo-fit,
 * delivery scorecard, release gate) — but none of that proves the pushed
 * `agents/<slug>/…` files parse, register, and sit in a repo whose own gate
 * scripts exist. This module turns the target repo's artifacts + package.json
 * into a `TargetRepoSandboxReport`: a JSON verdict Aigent can consume later.
 *
 * PURE by design: this file does NO network/FS/process — it takes the already
 * READ artifacts (registry text, manifest text, handler/readme presence,
 * package.json scripts) and computes checks, secret scan, sandboxFitScore,
 * status, blockers. The read-only collector (github API) lives in
 * target-repo-sandbox-server.ts. Never fabricates: a missing artifact is a
 * blocker, a missing script is `skipped`, nothing is invented.
 *
 * Read-only doctrine end to end: this evaluation NEVER writes to the target
 * repo, never commits in a sandbox, never pushes. Secret scan reports only the
 * file + pattern NAME, never a value.
 */

export const SANDBOX_SCHEMA_VERSION = 1 as const

export type SandboxCheckStatus = 'passed' | 'warning' | 'failed' | 'skipped'
export type SandboxStatus = 'passed' | 'warning' | 'failed'

export interface SandboxCheck {
  id: string
  label: string
  status: SandboxCheckStatus
  command?: string
  reason?: string
  durationMs?: number
  outputExcerpt?: string
}

export interface TargetRepoSandboxReport {
  schemaVersion: typeof SANDBOX_SCHEMA_VERSION
  runId: string
  agentSlug: string
  copilotId?: string
  versionId?: string
  repo: string
  branch: string
  commit: string | null
  sandboxPath?: string
  status: SandboxStatus
  /** Aigent control-plane repo-fit score (0..100), if available. */
  repoFitScore: number | null
  /** In-situ score from the sandbox checks themselves (0..100). */
  sandboxFitScore: number | null
  checks: SandboxCheck[]
  artifacts: {
    registry?: string
    manifest?: string
    handler?: string
    readme?: string
    reportPath?: string
  }
  warnings: string[]
  blockers: string[]
  createdAt: string
}

// The repo gate scripts we probe, in recommended order. Detection only — we
// never invent a script the target package.json does not declare.
export const SANDBOX_SCRIPT_ORDER = [
  'verify',
  'typecheck',
  'lint',
  'check:ds',
  'check:catalyst',
  'test',
  'build',
] as const

// Secret patterns — NAMES only ever reported, never a matched value.
const SECRET_PATTERNS = [
  'OPENAI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_TOKEN',
  'LANGSMITH_API_KEY',
  'AMC_SESSION_SECRET',
  'PRIVATE_KEY',
  'SECRET',
  'PASSWORD',
] as const

/**
 * A hardcoded secret is a pattern name FOLLOWED BY an assigned value —
 * `X="…"`, `X = '…'`, `X: "…"`, `X=ghp_…`. A bare `process.env.OPENAI_API_KEY`
 * (a READ, the correct wiring) or a mention in prose is NOT a leak, so we don't
 * flag it. `[A-Z0-9_]*` after the pattern lets `OPENAI_API_KEY` still match when
 * embedded in a longer identifier. The assigned value must be non-trivial
 * (≥8 chars, not another env read) to count.
 */
function assignmentRegex(pattern: string): RegExp {
  // e.g. OPENAI_API_KEY = "sk-…"  |  GITHUB_TOKEN: 'ghp_…'  |  PASSWORD=hunter2xyz
  return new RegExp(`${pattern}[A-Z0-9_]*\\s*[:=]\\s*['"\`]?(?!process\\.env)[A-Za-z0-9_./+-]{8,}`, 'i')
}

/** The already-read inputs the pure evaluator scores. All I/O happens upstream. */
export interface SandboxEvalInput {
  runId: string
  agentSlug: string
  copilotId?: string
  versionId?: string
  repo: string
  branch: string
  commit: string | null
  repoFitScore?: number | null
  /** Raw text of agents/_registry.json (null = file absent). */
  registryText: string | null
  /** Raw text of agents/<slug>/manifest.json (null = file absent). */
  manifestText: string | null
  /** Whether the handler / readme files exist in the target repo. */
  handlerPresent: boolean
  readmePresent: boolean
  /** Scripts declared in the TARGET repo package.json (name → command). null = no package.json. */
  targetScripts: Record<string, string> | null
  /** Files (path → text) to secret-scan — only the delivered agent artifacts. */
  artifactTexts: Record<string, string>
  /** Stamp for createdAt — passed in (module stays pure, no Date.now()). */
  createdAt: string
}

/**
 * Detect HARDCODED secret assignments in a blob — pattern NAMES only ever
 * returned, never the value. A bare `process.env.X` read or a prose mention is
 * NOT flagged (that's correct wiring, not a leak); only `X = "<value>"`-style
 * assignments count.
 */
export function scanSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => assignmentRegex(p).test(text))
}

function parseRegistrySlugs(registryText: string | null): { ok: boolean; slugs: string[]; aigentSourced: boolean } {
  if (registryText === null) return { ok: false, slugs: [], aigentSourced: false }
  try {
    const parsed = JSON.parse(registryText) as unknown
    if (!Array.isArray(parsed)) return { ok: false, slugs: [], aigentSourced: false }
    const slugs: string[] = []
    let aigentSourced = false
    for (const row of parsed) {
      if (row && typeof row === 'object' && typeof (row as { slug?: unknown }).slug === 'string') {
        slugs.push((row as { slug: string }).slug)
        if ((row as { source?: unknown }).source === 'aigent') aigentSourced = true
      }
    }
    return { ok: true, slugs, aigentSourced }
  } catch {
    return { ok: false, slugs: [], aigentSourced: false }
  }
}

function manifestIsValid(manifestText: string | null): { ok: boolean; readable: boolean } {
  if (manifestText === null) return { ok: false, readable: false }
  try {
    const m = JSON.parse(manifestText) as Record<string, unknown>
    // "readable" = the fields the delivery contract expects are present-ish.
    const readable =
      typeof m === 'object' &&
      m !== null &&
      ('systemPromptSummary' in m || 'system_prompt_summary' in m || 'confirmationPolicy' in m || 'toolIds' in m)
    return { ok: true, readable }
  } catch {
    return { ok: false, readable: false }
  }
}

/**
 * Evaluate a target-repo sandbox from already-read inputs. Deterministic and
 * pure. Blockers (missing registry entry / missing-invalid manifest / secret
 * leak) force status=failed; a non-critical miss (absent handler/readme, a
 * skipped script) is a warning. sandboxFitScore = passed / applicable * 100.
 */
export function evaluateSandbox(input: SandboxEvalInput): TargetRepoSandboxReport {
  const checks: SandboxCheck[] = []
  const warnings: string[] = []
  const blockers: string[] = []

  // --- Agent artifact checks -------------------------------------------------
  const registry = parseRegistrySlugs(input.registryText)
  const registryPresent = input.registryText !== null
  checks.push({
    id: 'artifact:registry',
    label: 'agents/_registry.json exists & parses',
    status: registryPresent && registry.ok ? 'passed' : 'failed',
    reason: !registryPresent ? 'registry_missing' : !registry.ok ? 'registry_unparseable' : undefined,
  })
  if (!registryPresent) blockers.push('agent_not_pushed_to_target_repo')
  else if (!registry.ok) blockers.push('registry_unparseable')

  const agentInRegistry = registry.slugs.includes(input.agentSlug)
  checks.push({
    id: 'artifact:registry-entry',
    label: `registry lists "${input.agentSlug}"`,
    status: agentInRegistry ? 'passed' : 'failed',
    reason: agentInRegistry ? undefined : 'agent_absent_from_registry',
  })
  if (registryPresent && !agentInRegistry) blockers.push('agent_absent_from_registry')

  checks.push({
    id: 'artifact:registry-source',
    label: 'registry entries sourced from aigent',
    status: registry.aigentSourced ? 'passed' : registryPresent ? 'warning' : 'skipped',
    reason: registry.aigentSourced ? undefined : registryPresent ? 'source_marker_absent' : 'registry_missing',
  })
  if (registryPresent && !registry.aigentSourced) warnings.push('registry_source_not_aigent')

  const manifest = manifestIsValid(input.manifestText)
  const manifestPresent = input.manifestText !== null
  checks.push({
    id: 'artifact:manifest',
    label: 'manifest.json exists & is valid JSON',
    status: manifestPresent && manifest.ok ? 'passed' : 'failed',
    reason: !manifestPresent ? 'manifest_missing' : !manifest.ok ? 'manifest_invalid_json' : undefined,
  })
  if (!manifestPresent) blockers.push('manifest_missing')
  else if (!manifest.ok) blockers.push('manifest_invalid_json')

  checks.push({
    id: 'artifact:manifest-readable',
    label: 'manifest fields (provider/runtime/tools) readable',
    status: manifest.readable ? 'passed' : manifestPresent && manifest.ok ? 'warning' : 'skipped',
    reason: manifest.readable ? undefined : 'manifest_fields_unreadable',
  })
  if (manifestPresent && manifest.ok && !manifest.readable) warnings.push('manifest_fields_unreadable')

  checks.push({
    id: 'artifact:handler',
    label: 'handler.ts exists',
    status: input.handlerPresent ? 'passed' : 'warning',
    reason: input.handlerPresent ? undefined : 'handler_missing',
  })
  if (!input.handlerPresent) warnings.push('handler_missing')

  checks.push({
    id: 'artifact:readme',
    label: 'README.md exists',
    status: input.readmePresent ? 'passed' : 'warning',
    reason: input.readmePresent ? undefined : 'readme_missing',
  })
  if (!input.readmePresent) warnings.push('readme_missing')

  // --- Secret scan (names only) ---------------------------------------------
  const leaks: string[] = []
  for (const [path, text] of Object.entries(input.artifactTexts)) {
    for (const pattern of scanSecrets(text)) leaks.push(`${path}:${pattern}`)
  }
  checks.push({
    id: 'security:secret-scan',
    label: 'no secret pattern in delivered artifacts',
    status: leaks.length === 0 ? 'passed' : 'failed',
    reason: leaks.length === 0 ? undefined : `secret_pattern_in:${leaks.join(',')}`,
  })
  if (leaks.length > 0) blockers.push('secret_in_artifacts')

  // --- Repo gate script detection (NEVER invents a script) ------------------
  // Read-only default: we DETECT which repo scripts exist and report the rest
  // as skipped. Actually running them requires a disposable clone (the server
  // collector may opt into it); by default this stays a dry-run so we never
  // execute code from the target repo unprompted.
  const scripts = input.targetScripts
  for (const name of SANDBOX_SCRIPT_ORDER) {
    const exists = scripts !== null && Object.prototype.hasOwnProperty.call(scripts, name)
    checks.push({
      id: `script:${name}`,
      label: `npm run ${name}`,
      status: 'skipped',
      command: exists ? `npm run ${name}` : undefined,
      reason: scripts === null ? 'no_package_json' : exists ? 'dry_run' : 'script_missing',
    })
  }

  // --- Score & status --------------------------------------------------------
  // sandboxFitScore = passed / (passed + failed + warning). Skipped checks are
  // excluded — a script that isn't in the target repo shouldn't drag the score.
  const scored = checks.filter((c) => c.status !== 'skipped')
  const passed = scored.filter((c) => c.status === 'passed').length
  const applicable = scored.length
  const sandboxFitScore = applicable > 0 ? Math.round((passed / applicable) * 100) : null

  const status: SandboxStatus = blockers.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed'

  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    runId: input.runId,
    agentSlug: input.agentSlug,
    copilotId: input.copilotId,
    versionId: input.versionId,
    repo: input.repo,
    branch: input.branch,
    commit: input.commit,
    status,
    repoFitScore: input.repoFitScore ?? null,
    sandboxFitScore,
    checks,
    artifacts: {
      registry: registryPresent ? 'agents/_registry.json' : undefined,
      manifest: manifestPresent ? `agents/${input.agentSlug}/manifest.json` : undefined,
      handler: input.handlerPresent ? `agents/${input.agentSlug}/handler.ts` : undefined,
      readme: input.readmePresent ? `agents/${input.agentSlug}/README.md` : undefined,
    },
    warnings,
    blockers,
    createdAt: input.createdAt,
  }
}

/**
 * Validate an unknown value as a TargetRepoSandboxReport (schemaVersion=1).
 * Used by consumers that read a persisted report back. Returns the typed report
 * or throws a descriptive error (never a partial object).
 */
export function parseSandboxReport(value: unknown): TargetRepoSandboxReport {
  if (typeof value !== 'object' || value === null) throw new Error('sandbox report: not an object')
  const v = value as Record<string, unknown>
  if (v.schemaVersion !== SANDBOX_SCHEMA_VERSION) throw new Error(`sandbox report: unsupported schemaVersion ${String(v.schemaVersion)}`)
  if (typeof v.runId !== 'string' || typeof v.agentSlug !== 'string' || typeof v.repo !== 'string') {
    throw new Error('sandbox report: missing runId/agentSlug/repo')
  }
  if (!Array.isArray(v.checks)) throw new Error('sandbox report: checks is not an array')
  if (v.status !== 'passed' && v.status !== 'warning' && v.status !== 'failed') {
    throw new Error(`sandbox report: bad status ${String(v.status)}`)
  }
  return value as TargetRepoSandboxReport
}
