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
/** dry_run = detect scripts only; execute = run them in a disposable clone. */
export type SandboxExecutionMode = 'dry_run' | 'execute'
/** skip = don't install deps (fast, some scripts may fail); auto = install per lockfile. */
export type SandboxInstallMode = 'skip' | 'auto'

/** Result of actually running a repo script in the clone (execute mode). */
export interface ScriptExecResult {
  status: 'passed' | 'failed'
  durationMs: number
  /** Bounded + sanitized output (never full, never a secret value). */
  outputExcerpt: string
  /** Set when the script was killed by the per-command timeout. */
  timedOut?: boolean
}

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
  /** How the checks were produced. */
  executionMode: SandboxExecutionMode
  installMode: SandboxInstallMode
  /** Whether the disposable clone was kept (debug) rather than cleaned up. */
  sandboxKept: boolean
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
  /** How the report was produced (defaults dry_run). */
  executionMode?: SandboxExecutionMode
  installMode?: SandboxInstallMode
  sandboxKept?: boolean
  sandboxPath?: string
  /**
   * Real script results from the runner (execute mode), keyed by script name.
   * When present for a script, they REPLACE the dry_run placeholder. Absent →
   * the script stays skipped/dry_run (Prompt 48 behaviour, unchanged).
   */
  scriptResults?: Record<string, ScriptExecResult>
  /**
   * Scripts intentionally not run because `verify` already covered them
   * (execute mode, option A). Reported as skipped/covered_by_verify.
   */
  coveredByVerify?: string[]
}

/** Max chars kept from any command output — the excerpt, never the full log. */
export const OUTPUT_EXCERPT_MAX = 4000

/**
 * Sanitize command output before it enters a report: mask a value following any
 * KEY/TOKEN/SECRET/PASSWORD assignment, mask credentials embedded in URLs, and
 * hard-cap the length. PURE. Applied by the runner AND re-applied here as a
 * belt-and-braces guard so a report can never carry a raw secret.
 */
export function sanitizeOutput(raw: string): string {
  let out = raw
  // URLs with inline credentials: https://user:pass@host → https://***:***@host
  out = out.replaceAll(/(\bhttps?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
  // KEY/TOKEN/SECRET/PASSWORD (+ optional suffix) = <value>  →  = ***
  out = out.replaceAll(/([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*[:=]\s*)['"`]?[^\s'"`]+/gi, '$1***')
  // Bearer tokens.
  out = out.replaceAll(/\b(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1***')
  if (out.length > OUTPUT_EXCERPT_MAX) out = out.slice(0, OUTPUT_EXCERPT_MAX) + '\n…[truncated]'
  return out
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

interface ArtifactCheckContext {
  registry: ReturnType<typeof parseRegistrySlugs>
  registryPresent: boolean
  manifest: ReturnType<typeof manifestIsValid>
  manifestPresent: boolean
}

function buildArtifactCheckContext(input: SandboxEvalInput): ArtifactCheckContext {
  return {
    registry: parseRegistrySlugs(input.registryText),
    registryPresent: input.registryText !== null,
    manifest: manifestIsValid(input.manifestText),
    manifestPresent: input.manifestText !== null,
  }
}

function pushRegistryChecks(
  checks: SandboxCheck[],
  blockers: string[],
  warnings: string[],
  ctx: ArtifactCheckContext,
  agentSlug: string
): void {
  const { registry, registryPresent } = ctx
  checks.push({
    id: 'artifact:registry',
    label: 'agents/_registry.json exists & parses',
    status: registryPresent && registry.ok ? 'passed' : 'failed',
    reason: registryArtifactReason(registryPresent, registry.ok),
  })
  if (!registryPresent) blockers.push('agent_not_pushed_to_target_repo')
  else if (!registry.ok) blockers.push('registry_unparseable')

  const agentInRegistry = registry.slugs.includes(agentSlug)
  checks.push({
    id: 'artifact:registry-entry',
    label: `registry lists "${agentSlug}"`,
    status: agentInRegistry ? 'passed' : 'failed',
    reason: agentInRegistry ? undefined : 'agent_absent_from_registry',
  })
  if (registryPresent && !agentInRegistry) blockers.push('agent_absent_from_registry')

  checks.push({
    id: 'artifact:registry-source',
    label: 'registry entries sourced from aigent',
    status: registryArtifactStatus(registry.aigentSourced, registryPresent),
    reason: registrySourceReason(registryPresent, registry.aigentSourced),
  })
  if (registryPresent && !registry.aigentSourced) warnings.push('registry_source_not_aigent')
}

function pushManifestChecks(
  checks: SandboxCheck[],
  blockers: string[],
  warnings: string[],
  ctx: ArtifactCheckContext
): void {
  const { manifest, manifestPresent } = ctx
  checks.push({
    id: 'artifact:manifest',
    label: 'manifest.json exists & is valid JSON',
    status: manifestPresent && manifest.ok ? 'passed' : 'failed',
    reason: manifestArtifactReason(manifestPresent, manifest.ok),
  })
  if (!manifestPresent) blockers.push('manifest_missing')
  else if (!manifest.ok) blockers.push('manifest_invalid_json')

  checks.push({
    id: 'artifact:manifest-readable',
    label: 'manifest fields (provider/runtime/tools) readable',
    status: manifestReadableStatus(manifest.readable, manifestPresent, manifest.ok),
    reason: manifest.readable ? undefined : 'manifest_fields_unreadable',
  })
  if (manifestPresent && manifest.ok && !manifest.readable) warnings.push('manifest_fields_unreadable')
}

function pushPresenceChecks(
  checks: SandboxCheck[],
  warnings: string[],
  input: SandboxEvalInput
): void {
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
}

function pushSecretScanCheck(
  checks: SandboxCheck[],
  blockers: string[],
  artifactTexts: Record<string, string>
): void {
  const leaks: string[] = []
  for (const [path, text] of Object.entries(artifactTexts)) {
    for (const pattern of scanSecrets(text)) leaks.push(`${path}:${pattern}`)
  }
  checks.push({
    id: 'security:secret-scan',
    label: 'no secret pattern in delivered artifacts',
    status: leaks.length === 0 ? 'passed' : 'failed',
    reason: leaks.length === 0 ? undefined : `secret_pattern_in:${leaks.join(',')}`,
  })
  if (leaks.length > 0) blockers.push('secret_in_artifacts')
}

function buildScriptCheck(
  name: string,
  scripts: Record<string, string> | null,
  scriptResults: Record<string, ScriptExecResult>,
  coveredByVerify: Set<string>,
  blockers: string[]
): SandboxCheck {
  const exists = scripts !== null && Object.prototype.hasOwnProperty.call(scripts, name)
  const command = exists ? `npm run ${name}` : undefined
  const result = scriptResults[name]
  if (!exists) {
    return {
      id: `script:${name}`,
      label: `npm run ${name}`,
      status: 'skipped',
      reason: scripts === null ? 'no_package_json' : 'script_missing',
    }
  }
  if (result) {
    if (result.timedOut) blockers.push(`script_timeout:${name}`)
    return {
      id: `script:${name}`,
      label: `npm run ${name}`,
      status: result.status,
      command,
      durationMs: result.durationMs,
      outputExcerpt: sanitizeOutput(result.outputExcerpt),
      ...(result.timedOut ? { reason: 'timeout' } : {}),
    }
  }
  if (coveredByVerify.has(name)) {
    return { id: `script:${name}`, label: `npm run ${name}`, status: 'skipped', command, reason: 'covered_by_verify' }
  }
  return { id: `script:${name}`, label: `npm run ${name}`, status: 'skipped', command, reason: 'dry_run' }
}

function computeSandboxFitScore(checks: SandboxCheck[]): number | null {
  const scored = checks.filter((c) => c.status !== 'skipped')
  const passed = scored.filter((c) => c.status === 'passed').length
  const applicable = scored.length
  return applicable > 0 ? Math.round((passed / applicable) * 100) : null
}

function resolveSandboxStatus(blockers: string[], warnings: string[]): SandboxStatus {
  if (blockers.length > 0) return 'failed'
  if (warnings.length > 0) return 'warning'
  return 'passed'
}

/**
 * Evaluate a target-repo sandbox from already-read inputs. Deterministic and
 * pure. Blockers (missing registry entry / missing-invalid manifest / secret
 * leak) force status=failed; a non-critical miss (absent handler/readme, a
 * skipped script) is a warning. sandboxFitScore = passed / applicable * 100.
 */
function registryArtifactReason(registryPresent: boolean, registryOk: boolean): string | undefined {
  if (!registryPresent) return 'registry_missing'
  if (!registryOk) return 'registry_unparseable'
  return undefined
}

function registryArtifactStatus(aigentSourced: boolean, registryPresent: boolean): SandboxCheck['status'] {
  if (aigentSourced) return 'passed'
  if (registryPresent) return 'warning'
  return 'skipped'
}

function registrySourceReason(registryPresent: boolean, aigentSourced: boolean): string | undefined {
  if (aigentSourced) return undefined
  if (registryPresent) return 'source_marker_absent'
  return 'registry_missing'
}

function manifestArtifactReason(manifestPresent: boolean, manifestOk: boolean): string | undefined {
  if (!manifestPresent) return 'manifest_missing'
  if (!manifestOk) return 'manifest_invalid_json'
  return undefined
}

function manifestReadableStatus(
  readable: boolean,
  manifestPresent: boolean,
  manifestOk: boolean,
): SandboxCheckStatus {
  if (readable) return 'passed'
  if (manifestPresent && manifestOk) return 'warning'
  return 'skipped'
}

export function evaluateSandbox(input: SandboxEvalInput): TargetRepoSandboxReport {
  const checks: SandboxCheck[] = []
  const warnings: string[] = []
  const blockers: string[] = []

  const artifactCtx = buildArtifactCheckContext(input)
  pushRegistryChecks(checks, blockers, warnings, artifactCtx, input.agentSlug)
  pushManifestChecks(checks, blockers, warnings, artifactCtx)
  pushPresenceChecks(checks, warnings, input)
  pushSecretScanCheck(checks, blockers, input.artifactTexts)

  const scriptResults = input.scriptResults ?? {}
  const coveredByVerify = new Set(input.coveredByVerify ?? [])
  for (const name of SANDBOX_SCRIPT_ORDER) {
    checks.push(buildScriptCheck(name, input.targetScripts, scriptResults, coveredByVerify, blockers))
  }

  const sandboxFitScore = computeSandboxFitScore(checks)
  const status = resolveSandboxStatus(blockers, warnings)
  const { registryPresent, manifestPresent } = artifactCtx

  return {
    schemaVersion: SANDBOX_SCHEMA_VERSION,
    runId: input.runId,
    agentSlug: input.agentSlug,
    copilotId: input.copilotId,
    versionId: input.versionId,
    repo: input.repo,
    branch: input.branch,
    commit: input.commit,
    ...(input.sandboxPath ? { sandboxPath: input.sandboxPath } : {}),
    executionMode: input.executionMode ?? 'dry_run',
    installMode: input.installMode ?? 'skip',
    sandboxKept: input.sandboxKept ?? false,
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
