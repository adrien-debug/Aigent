/**
 * Agent Mission Control — GitHub push layer (server only).
 *
 * Pushes an agent's executable RUNTIME CODE into the project's linked GitHub
 * repository by a DIRECT COMMIT on the remote repo's default branch, via the
 * GitHub REST + Git API. Zero deps beyond `fetch`.
 *
 * FAIL-CLOSED + DRY-RUN BY DEFAULT — double safety on the real push:
 *   1. `pushAgentToRepo` runs in dry-run unless the caller passes
 *      `dryRun: false`, AND
 *   2. even then it only mutates the remote if `process.env.GITHUB_PUSH_ENABLED
 *      === '1'`.
 * If either gate is not satisfied, NO mutating network call is ever made — the
 * function inspects the repo (read-only) and returns a dry-run PushResult.
 *
 * `requireGithub()` fails closed: with no `GITHUB_TOKEN` it throws, never a
 * fallback. Secrets never appear in generated code — every scaffolded handler
 * reads `process.env` at runtime.
 *
 * Never import this module from a client component: it reads GITHUB_TOKEN.
 */
import 'server-only'

import type { AgentManifest, Copilot, Project } from './types'
import {
  buildConsumerIntakePack,
  CONSUMER_PACK_VERSION,
  CONSUMER_READY_PATH,
  consumerProvisionBranchName,
  type ConsumerReadyMarker,
  AGENTS_WANTED_PATH,
  BINDINGS_PATH,
  REGISTRY_JSON_PATH,
  REGISTRY_README_PATH,
} from './consumer-bootstrap'

// ---------------------------------------------------------------------------
// Config / fail-closed
// ---------------------------------------------------------------------------

const GITHUB_API = 'https://api.github.com'

/** Resolve the GitHub token, or throw (fail-closed, no fallback). */
function requireGithub(): { token: string } {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GitHub not configured: set GITHUB_TOKEN')
  }
  return { token }
}

/** Whether the real push is armed (second gate, independent of `dryRun`). */
function pushArmed(): boolean {
  return process.env.GITHUB_PUSH_ENABLED === '1'
}

// ---------------------------------------------------------------------------
// Defense in depth — input validation for repo / path / ref, applied to every
// exported function that takes these from an external caller (HTTP routes,
// future scripts/modules). Callers already catch thrown errors (502 in the
// HTTP routes) so a thrown Error is a safe, non-breaking failure mode.
//
// This exists on top of (not instead of) HTTP-layer validation: even a
// negligent caller that forgets to validate can't turn getRepoFile/getRepoTree
// into a universal read oracle over every private repo the server token can
// see, and can't smuggle query params / secret paths past the GitHub API.
// ---------------------------------------------------------------------------

const REPO_FULL_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

/**
 * Validate a GitHub "owner/name" full repo name. Strict allowlist charset,
 * exactly one slash, no path traversal, no query strings, no "@" (which could
 * be used to smuggle a different host/user in some URL contexts).
 */
function assertValidRepoFullName(repoFullName: string): string {
  if (
    typeof repoFullName !== 'string' ||
    !REPO_FULL_NAME_RE.test(repoFullName) ||
    repoFullName.includes('..') ||
    repoFullName.includes('@') ||
    repoFullName.includes('?') ||
    repoFullName.includes('#')
  ) {
    throw new Error('invalid repo (expected owner/name)')
  }
  return repoFullName
}

// Secret/credential-looking repo paths — equivalent denylist to
// tool-registry.mjs's SECRET_PATH_PATTERNS (kept in sync intentionally; do not
// modify tool-registry.mjs from here).
const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /\.pem$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|[/._-])secrets?([/._-]|$)/i,
  /\.key$/i,
  /(^|\/)credentials(\.|$)/i,
  /\.pfx$/i,
  /\.p12$/i,
]

function isSecretPath(p: string): boolean {
  return SECRET_PATH_PATTERNS.some((re) => re.test(p))
}

/**
 * Validate + normalize a repo-relative path coming from an external caller.
 * Strips a leading slash, rejects traversal ("..") and secret/credential-
 * looking paths. Throws on rejection rather than silently coercing.
 */
function assertSafeRepoPath(path: string): string {
  if (typeof path !== 'string') {
    throw new Error('invalid path')
  }
  const cleanPath = path.replace(/^\/+/, '')
  const segments = cleanPath.split('/')
  if (segments.some((seg) => seg === '..')) {
    throw new Error('invalid path: traversal ("..") is not allowed')
  }
  if (isSecretPath(cleanPath)) {
    throw new Error('refused: this path looks like a secret/credential file and cannot be read')
  }
  return cleanPath
}

/**
 * Validate an optional git ref (branch/tag/sha). Applies the same charset
 * discipline as a repo name segment plus "/" (branches like "feat/x") and "."
 * (tags like "v1.2.3"), while still rejecting traversal and query/fragment
 * injection.
 */
function assertValidRef(ref: string): string {
  if (
    typeof ref !== 'string' ||
    ref.length === 0 ||
    ref.includes('..') ||
    ref.includes('?') ||
    ref.includes('#') ||
    ref.includes('@{') ||
    /[^A-Za-z0-9._/-]/.test(ref)
  ) {
    throw new Error('invalid ref')
  }
  return ref
}

/** Encode a repo-relative path segment-by-segment (not encodeURI: that lets
 * `? # : @` through, which can inject query params into the Contents API). */
function encodeRepoPath(path: string): string {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .map(encodeURIComponent)
    .join('/')
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

interface ScaffoldedFile {
  path: string
  content: string
}

/** Delivery mode: a direct commit on the default branch, or a dedicated PR branch. */
export type PushAgentDeliveryMode = 'direct_commit' | 'pull_request'

export interface PushResult {
  pushed: boolean
  dryRun: boolean
  mode: PushAgentDeliveryMode
  commitUrl?: string
  commitSha?: string
  /** For direct_commit: the default branch. For pull_request: the delivery branch. */
  branch: string
  /** The repo's default branch (PR base). */
  baseBranch?: string
  /** Pull-request URL/number (pull_request mode, real push only). */
  prUrl?: string
  prNumber?: number
  files: string[]
  message: string
}

export interface PushAgentArgs {
  project: Project
  copilot: Copilot
  manifest: AgentManifest
  /** Defaults to true. A real push also requires GITHUB_PUSH_ENABLED=1. */
  dryRun?: boolean
  /**
   * Delivery mode, informational only. The actual mode is decided by WHICH
   * function the caller invokes — `pushAgentToRepo` always commits directly,
   * `pushAgentToRepoPullRequest` always opens a PR. Neither reads this field;
   * the HTTP route (`push-agent/route.ts`) selects the function, defaulting to
   * pull_request unless the caller explicitly asks for direct_commit.
   */
  mode?: PushAgentDeliveryMode
  /** Short run id for the delivery branch name (pull_request mode). */
  runId?: string
  /** Extra PR body context (delivery scorecard / sandbox summary), never secrets. */
  prBodyExtra?: string
}

/** Sanitize a slug into a git-branch-safe segment: lowercase, [a-z0-9-] only, bounded. */
export function deliveryBranchName(slug: string, shortRunId: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
  const base = clean(slug) || 'agent'
  const rid = clean(shortRunId) || 'run'
  return `agent/${base}-${rid}`
}

// ---------------------------------------------------------------------------
// Low-level GitHub fetch (fail-closed on non-2xx)
// ---------------------------------------------------------------------------

/** Hard ceiling so a stalled GitHub API can't hang a request indefinitely. */
const GITHUB_FETCH_TIMEOUT_MS = 15_000

async function gh<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  const { token } = requireGithub()
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(`GitHub request timed out after ${GITHUB_FETCH_TIMEOUT_MS}ms on ${method} ${path}`)
    }
    throw err
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `GitHub ${res.status} on ${method} ${path}: ${(await res.text()).slice(0, 300)}`
    )
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** GET the repo's default branch name (read-only). */
async function getDefaultBranch(repoFullName: string): Promise<string> {
  const safeRepo = assertValidRepoFullName(repoFullName)
  const repo = await gh<{ default_branch: string }>('GET', `repos/${safeRepo}`)
  return repo.default_branch
}

/**
 * GET the HEAD commit sha of a branch (default branch when ref is omitted).
 * Read-only. Used for staleness: a changed HEAD invalidates a cached repo scan.
 */
export async function getRepoHeadSha(repoFullName: string, ref?: string): Promise<string> {
  const safeRepo = assertValidRepoFullName(repoFullName)
  const resolvedRef = ref !== undefined ? assertValidRef(ref) : await getDefaultBranch(safeRepo)
  const data = await gh<{ sha: string }>('GET', `repos/${safeRepo}/commits/${encodeURIComponent(resolvedRef)}`)
  return data.sha
}

// ---------------------------------------------------------------------------
// Read-only GitHub browsing (repos / tree / file) — server only
// ---------------------------------------------------------------------------

export interface GithubRepoSummary {
  fullName: string
  name: string
  owner: string
  private: boolean
  defaultBranch: string
  description: string | null
  htmlUrl: string
  updatedAt: string
}

export interface RepoTreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

export interface RepoFileContent {
  path: string
  encoding: 'utf-8'
  text: string
  truncated: boolean
}

/** Shape of a repo object as returned by the GitHub REST API (partial). */
interface GithubApiRepo {
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  default_branch: string
  description: string | null
  html_url: string
  updated_at: string
}

function mapRepo(r: GithubApiRepo): GithubRepoSummary {
  return {
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description ?? null,
    htmlUrl: r.html_url,
    updatedAt: r.updated_at,
  }
}

/**
 * List the authenticated user's accessible repositories (owned, collaborator,
 * org member). Paginates up to a sane cap; sorted by most-recently updated.
 * Read-only. Fails closed via the shared `gh` helper (throws without a token).
 */
export async function listRepos(): Promise<GithubRepoSummary[]> {
  const PER_PAGE = 100
  const MAX_REPOS = 1000
  const maxPages = Math.ceil(MAX_REPOS / PER_PAGE)

  // Dedup by full_name: the owner/collaborator/organization_member affiliations
  // overlap (a repo you own inside an org is returned under several), so the raw
  // paginated batches carry duplicates — collapsing them is what restores the
  // repos that otherwise appear "missing" from the count.
  const byFullName = new Map<string, GithubApiRepo>()
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await gh<GithubApiRepo[]>(
      'GET',
      `user/repos?per_page=${PER_PAGE}&sort=updated&page=${page}&affiliation=owner,collaborator,organization_member`
    )
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const repo of batch) byFullName.set(repo.full_name, repo)
    if (batch.length < PER_PAGE) break
  }

  return Array.from(byFullName.values())
    .map(mapRepo)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
}

/**
 * Fetch a repository's git tree recursively. Defaults to the repo's default
 * branch when no ref is given. Returns BOTH blobs and trees, unfiltered. If the
 * GitHub API truncates the response (very large repo), the partial listing is
 * returned as-is — this never throws for truncation.
 * Read-only.
 */
export async function getRepoTree(
  repoFullName: string,
  ref?: string
): Promise<RepoTreeEntry[]> {
  const safeRepo = assertValidRepoFullName(repoFullName)
  const resolvedRef = ref !== undefined ? assertValidRef(ref) : await getDefaultBranch(safeRepo)
  const data = await gh<{
    truncated?: boolean
    tree?: { path: string; type: string; size?: number }[]
  }>(
    'GET',
    `repos/${safeRepo}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`
  )

  const tree = data.tree ?? []
  return tree
    .filter((e): e is { path: string; type: 'blob' | 'tree'; size?: number } =>
      e.type === 'blob' || e.type === 'tree'
    )
    .map((e) => ({
      path: e.path,
      type: e.type,
      ...(typeof e.size === 'number' ? { size: e.size } : {}),
    }))
}

/**
 * Read a single file's UTF-8 contents from a repository. Defaults to the repo's
 * default branch when no ref is given. Files above the Contents API inline limit
 * (~1MB — the API returns empty content plus a download_url) resolve cleanly to
 * `{ truncated: true, text: '' }` rather than throwing. A non-file target (dir,
 * submodule, symlink) throws.
 * Read-only.
 */
export async function getRepoFile(
  repoFullName: string,
  path: string,
  ref?: string
): Promise<RepoFileContent> {
  const safeRepo = assertValidRepoFullName(repoFullName)
  const cleanPath = assertSafeRepoPath(path)
  const encodedPath = encodeRepoPath(cleanPath)
  const safeRef = ref !== undefined ? assertValidRef(ref) : undefined
  const query = safeRef ? `?ref=${encodeURIComponent(safeRef)}` : ''

  const data = await gh<{
    type: string
    path: string
    content?: string
    encoding?: string
  }>('GET', `repos/${safeRepo}/contents/${encodedPath}${query}`)

  if (data.type !== 'file') {
    throw new Error(`not a file: ${cleanPath} (type: ${data.type})`)
  }

  // Above the inline limit, the API returns an empty content string (and a
  // download_url); treat that as a clean truncation rather than an error.
  if (!data.content) {
    return { path: data.path, encoding: 'utf-8', text: '', truncated: true }
  }

  const text = Buffer.from(data.content, 'base64').toString('utf-8')
  return { path: data.path, encoding: 'utf-8', text, truncated: false }
}

interface RepoSearchMatch {
  path: string
  /** Short text fragments around the match, when GitHub returns them. */
  fragments: string[]
}

export interface RepoSearchResult {
  totalCount: number
  /** True when GitHub's count is not to be trusted as exhaustive (rate-limited/degraded search index). */
  incomplete: boolean
  matches: RepoSearchMatch[]
}

/**
 * Search code in a repository via the GitHub Code Search API, scoped to
 * `repo:{repoFullName}`. Read-only. Secret/credential-looking paths are
 * filtered out of the results (same denylist as getRepoFile).
 * Rate-limited more aggressively by GitHub than other endpoints (search API);
 * a 403 is surfaced as a thrown error rather than retried.
 */
export async function searchRepoCode(repoFullName: string, query: string): Promise<RepoSearchResult> {
  const safeRepo = assertValidRepoFullName(repoFullName)
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('invalid query: must be a non-empty string')
  }
  const q = `${query} repo:${safeRepo}`
  const data = await gh<{
    total_count: number
    incomplete_results: boolean
    items?: {
      path: string
      text_matches?: { fragment?: string }[]
    }[]
  }>('GET', `search/code?q=${encodeURIComponent(q)}&per_page=20`)

  const items = data.items ?? []
  const matches = items
    .filter((item) => !isSecretPath(item.path))
    .map((item) => ({
      path: item.path,
      fragments: (item.text_matches ?? []).map((m) => m.fragment ?? '').filter(Boolean),
    }))

  return {
    totalCount: data.total_count,
    incomplete: data.incomplete_results,
    matches,
  }
}

// ---------------------------------------------------------------------------
// Scaffolding — real, runnable runtime code per runtime
// ---------------------------------------------------------------------------

/** Escape a string for safe embedding inside a JS template literal. */
function forTemplate(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/**
 * Map the internal ModelProvider union onto the telemetry ingestion endpoint's
 * wire vocabulary (route.ts providerEnum: openai/gemini/custom/unknown).
 * `google` -> `gemini` (the endpoint's spelling), `local`/anything else has no
 * knowable wire equivalent so it is omitted (undefined) rather than guessed.
 */
function normalizeProviderForWire(provider: Copilot['modelProvider'] | undefined): string | undefined {
  switch (provider) {
    case 'openai':
      return 'openai'
    case 'google':
      return 'gemini'
    default:
      return undefined
  }
}

function handlerHeader(copilot: Copilot): string {
  return [
    `// Auto-generated runtime handler for agent "${copilot.name}" (${copilot.slug}).`,
    `// Runtime: ${copilot.runtime} · model: ${copilot.model}.`,
    `// Regenerated by Agent Mission Control — do not hand-edit; re-push to update.`,
    `// No secrets are embedded: credentials are read from process.env at runtime.`,
  ].join('\n')
}

const SHARED_TYPES = `export interface AgentInput {
  /** End-user message / task for this run. */
  input: string
}

export interface AgentResult {
  /** Final model output for this run. */
  output: string
}

/**
 * Read an environment variable without depending on \`@types/node\` being
 * installed in the host repo. Referencing the global \`process\` directly fails
 * to typecheck ("Cannot find name 'process'") in a repo that hasn't wired node
 * types for this file; this reads it off \`globalThis\` with a local, minimal
 * type so the handler compiles standalone in any TypeScript repo. No secret is
 * embedded — the value is read at runtime.
 */
function readEnv(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return g.process?.env?.[name]
}
`

/**
 * Generates `telemetry.ts` — an opt-in, best-effort runtime telemetry wrapper
 * (prompt 62). Only emitted when `manifest.telemetry` is present (back-compat:
 * agents without it never get this file). Zero npm dependency, no internal
 * Aigent import, standalone TypeScript — same discipline as the handlers.
 *
 * Hard rules enforced by construction, not by convention:
 *   - never throws: every network call is try/catch'd, failure is swallowed;
 *   - never sends raw message/output content — only shape (counts/booleans);
 *   - a no-op unless BOTH the manifest says `enabled: true`-ish AND the
 *     consumer repo's env has `AIGENT_TELEMETRY_ENABLED === 'true'` at
 *     runtime — generation time never hardcodes the on/off switch.
 *
 * Exported (like `handlerForRuntime`) so tests can assert the generated
 * telemetry.ts is TypeScript-safe, dependency-free and never leaks raw
 * content.
 */
export function telemetryWrapperSource(manifest: AgentManifest, copilot?: Copilot): string {
  const t = manifest.telemetry
  const endpointDefault = forTemplate(t?.endpoint ?? '')
  // projectId/agentId: an explicit manifest.telemetry override wins; otherwise
  // fall back to the copilot's OWN project/slug, known at generation time.
  // Without this fallback these stayed undefined for every real agent (the
  // authoring flow never sets manifest.telemetry.projectId/agentId), so every
  // emitted event failed the ingestion endpoint's required-field validation.
  const projectIdDefault = forTemplate(t?.projectId ?? copilot?.projectId ?? '')
  const agentIdDefault = forTemplate(t?.agentId ?? copilot?.slug ?? copilot?.id ?? '')
  const modelDefault = forTemplate(copilot?.model ?? '')
  const providerDefault = normalizeProviderForWire(copilot?.modelProvider)
  const agentVersionDefault = forTemplate(copilot?.latestVersionId ?? '')
  const sampleRateDefault = typeof t?.sampleRate === 'number' ? t.sampleRate : 1
  const redactInputsDefault = t?.redactInputs !== false
  const redactOutputsDefault = t?.redactOutputs !== false

  return `// Auto-generated opt-in runtime telemetry wrapper.
// Regenerated by Agent Mission Control — do not hand-edit; re-push to update.
//
// OPT-IN, BEST-EFFORT, NON-BLOCKING:
//   - disabled by default; requires AIGENT_TELEMETRY_ENABLED=true at runtime.
//   - never throws — a failed or slow POST never breaks the wrapped handler.
//   - never sends raw prompt/message/output content, only their shape.
//
// Env read at runtime (never embedded):
//   AIGENT_TELEMETRY_ENABLED  — 'true' to activate (default: inactive)
//   AIGENT_TELEMETRY_ENDPOINT — POST target (falls back to the manifest default below)
//   AIGENT_TELEMETRY_TOKEN    — Bearer token sent as Authorization

/** Read an env var off globalThis — same pattern as handler.ts's readEnv. */
function readEnv(name: string): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return g.process?.env?.[name]
}

export interface TelemetryConfig {
  enabled: boolean
  endpoint?: string
  projectId?: string
  agentId?: string
  /** The agent's version at generation time (copilot.latestVersionId) — static, not re-resolved at runtime. */
  agentVersion?: string
  /** The model id this handler was generated against (copilot.model). */
  model?: string
  /** Wire-vocabulary provider (openai/gemini) the ingestion endpoint accepts — 'local'/unmapped omitted, never guessed. */
  provider?: 'openai' | 'gemini'
  sampleRate?: number
  redactInputs?: boolean
  redactOutputs?: boolean
}

/** Manifest-time defaults (prompt 62 §2): enabled=false, sampleRate=1, redactInputs=true, redactOutputs=true. */
const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: ${JSON.stringify(Boolean(t?.enabled))},
  endpoint: ${endpointDefault ? `\`${endpointDefault}\`` : 'undefined'},
  // projectId/agentId are REQUIRED by the ingestion endpoint's schema (non-optional,
  // min length 1). Falls back to this copilot's own project/slug when the manifest
  // doesn't override them — see telemetryWrapperSource's projectIdDefault/agentIdDefault.
  projectId: ${projectIdDefault ? `\`${projectIdDefault}\`` : 'undefined'},
  agentId: ${agentIdDefault ? `\`${agentIdDefault}\`` : 'undefined'},
  agentVersion: ${agentVersionDefault ? `\`${agentVersionDefault}\`` : 'undefined'},
  model: ${modelDefault ? `\`${modelDefault}\`` : 'undefined'},
  provider: ${providerDefault ? JSON.stringify(providerDefault) : 'undefined'},
  sampleRate: ${JSON.stringify(sampleRateDefault)},
  redactInputs: ${JSON.stringify(redactInputsDefault)},
  redactOutputs: ${JSON.stringify(redactOutputsDefault)},
}

export type TelemetryStatus = 'started' | 'completed' | 'failed'

export interface RuntimeTelemetryEvent {
  eventId: string
  projectId?: string
  agentId?: string
  agentVersion?: string
  runId?: string
  timestamp: string
  status: TelemetryStatus
  latencyMs?: number
  model?: string
  provider?: 'openai' | 'gemini'
  inputShape?: Record<string, number | boolean>
  outputShape?: Record<string, number | boolean>
  error?: { name?: string; code?: string; messageHash?: string; category?: string }
  usage?: Record<string, number>
  environment?: Record<string, string | number | boolean>
}

/**
 * Whether an event should actually be sent: manifest opt-in AND
 * AIGENT_TELEMETRY_ENABLED='true' AND endpoint+token both resolvable AND the
 * random sample draw falls under sampleRate. Any missing piece → false, and
 * sending is skipped entirely (no network call, no cost).
 */
function shouldSendTelemetry(config: TelemetryConfig): boolean {
  if (!config.enabled) return false
  if (readEnv('AIGENT_TELEMETRY_ENABLED') !== 'true') return false
  const endpoint = readEnv('AIGENT_TELEMETRY_ENDPOINT') ?? config.endpoint
  const token = readEnv('AIGENT_TELEMETRY_TOKEN')
  if (!endpoint || !token) return false
  const sampleRate = typeof config.sampleRate === 'number' ? config.sampleRate : 1
  if (sampleRate <= 0) return false
  if (sampleRate >= 1) return true
  return Math.random() < sampleRate
}

/**
 * SHA-256 (truncated, hex) of an error message via crypto.subtle when
 * available. NEVER returns the raw message. Falls back to a short
 * NON-CRYPTOGRAPHIC rolling hash (clearly marked) when crypto.subtle is
 * unavailable (e.g. some non-browser, non-Node18+ runtimes) so a hash is
 * still produced without ever leaking raw content.
 */
async function hashErrorMessage(message: string): Promise<string> {
  try {
    const g = globalThis as { crypto?: { subtle?: SubtleCrypto; randomUUID?: () => string } }
    const subtle = g.crypto?.subtle
    if (subtle) {
      const data = new TextEncoder().encode(message)
      const digest = await subtle.digest('SHA-256', data)
      const bytes = Array.from(new Uint8Array(digest))
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    }
  } catch {
    // fall through to the non-cryptographic fallback below
  }
  // NON-CRYPTOGRAPHIC fallback (djb2-style rolling hash) — only used when
  // crypto.subtle is unavailable. Good enough to dedupe/group errors, NOT a
  // security primitive, and still never carries the raw message.
  let hash = 5381
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 33) ^ message.charCodeAt(i)
  }
  return \`nc\${(hash >>> 0).toString(16)}\`
}

/** A random id, via crypto.randomUUID when available, else a timestamp-based fallback (not cryptographically unique, only used as a best-effort correlation id). */
function randomEventId(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (typeof g.crypto?.randomUUID === 'function') return g.crypto.randomUUID()
  return \`evt_\${Date.now().toString(36)}\${Math.random().toString(36).slice(2, 10)}\`
}

/**
 * The ingestion endpoint requires a non-empty runId on every event
 * (route.ts's schema has no \`.optional()\` on it). \`metadata.runId\` lets a
 * caller correlate telemetry with its OWN run id when it has one; absent
 * that, a fresh id is generated per invocation so the field is NEVER
 * \`undefined\` — every started/completed/failed triple for one call still
 * shares the same runId either way.
 */
function resolveRunId(metadata?: TelemetryMetadata): string {
  return metadata?.runId ?? randomEventId()
}

/**
 * Best-effort, non-blocking POST of a telemetry event. ALWAYS wrapped in
 * try/catch, NEVER rethrows, result is ignored — a down telemetry endpoint or
 * a network failure never affects the wrapped handler. Short timeout via
 * AbortSignal.timeout when available, else a manual AbortController timer.
 */
async function sendRuntimeTelemetry(event: RuntimeTelemetryEvent, config: TelemetryConfig): Promise<void> {
  try {
    const endpoint = readEnv('AIGENT_TELEMETRY_ENDPOINT') ?? config.endpoint
    const token = readEnv('AIGENT_TELEMETRY_TOKEN')
    if (!endpoint || !token) return

    const g = globalThis as {
      fetch?: typeof fetch
      AbortSignal?: { timeout?: (ms: number) => AbortSignal }
      AbortController?: typeof AbortController
    }
    if (typeof g.fetch !== 'function') return

    let signal: AbortSignal | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    if (typeof g.AbortSignal?.timeout === 'function') {
      signal = g.AbortSignal.timeout(900)
    } else if (typeof g.AbortController === 'function') {
      const controller = new g.AbortController()
      timer = setTimeout(() => controller.abort(), 900)
      signal = controller.signal
    }

    try {
      await g.fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: \`Bearer \${token}\`,
        },
        body: JSON.stringify(event),
        signal,
      })
    } finally {
      if (timer) clearTimeout(timer)
    }
  } catch {
    // Best-effort: swallow ANY failure (network, timeout, serialization). The
    // wrapped handler must never observe a telemetry problem.
  }
}

/** Shape of an unknown input: counters/booleans only, never raw content. */
function shapeOf(value: unknown): Record<string, number | boolean> {
  if (value === null || value === undefined) return { isNullish: true }
  if (typeof value === 'string') return { isString: true, length: value.length }
  if (Array.isArray(value)) return { isArray: true, length: value.length }
  if (typeof value === 'object') return { isObject: true, keyCount: Object.keys(value as object).length }
  return { isString: false, isArray: false, isObject: false }
}

/** Metadata identifying a run for telemetry — never carries prompt/output content. */
export interface TelemetryMetadata {
  runId?: string
  config?: TelemetryConfig
}

/**
 * Wrap a handler so every call emits opt-in, best-effort runtime telemetry
 * (started + completed/failed) without ever including raw input/output
 * content. A pure pass-through (zero network cost) whenever
 * shouldSendTelemetry(config) is false.
 */
export function withRuntimeTelemetry<Input, Result>(
  handler: (input: Input) => Promise<Result>,
  metadata?: TelemetryMetadata
): (input: Input) => Promise<Result> {
  const config: TelemetryConfig = { ...DEFAULT_CONFIG, ...(metadata?.config ?? {}) }

  return async (input: Input): Promise<Result> => {
    if (!shouldSendTelemetry(config)) {
      return handler(input)
    }

    // One runId per invocation — shared by the started/completed(-or-failed)
    // pair below, and NEVER undefined (the endpoint requires it non-empty).
    const runId = resolveRunId(metadata)
    // The endpoint's environment schema is a closed enum on both fields
    // (nodeEnv: production/development/test/unknown, runtime: node/edge/unknown)
    // — normalize here rather than forwarding an arbitrary NODE_ENV string,
    // which would otherwise fail the endpoint's strict validation silently.
    const rawNodeEnv = readEnv('NODE_ENV')
    const nodeEnv = rawNodeEnv === 'production' || rawNodeEnv === 'development' || rawNodeEnv === 'test' ? rawNodeEnv : 'unknown'
    const runtimeKind = typeof (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime !== 'undefined' ? 'edge' : 'node'
    const environment: Record<string, string | number | boolean> = { nodeEnv, runtime: runtimeKind }

    const startedAt = Date.now()
    void sendRuntimeTelemetry(
      {
        eventId: randomEventId(),
        projectId: config.projectId,
        agentId: config.agentId,
        agentVersion: config.agentVersion,
        runId,
        timestamp: new Date().toISOString(),
        status: 'started',
        model: config.model,
        provider: config.provider,
        inputShape: shapeOf(input),
        environment,
      },
      config
    )

    try {
      const result = await handler(input)
      void sendRuntimeTelemetry(
        {
          eventId: randomEventId(),
          projectId: config.projectId,
          agentId: config.agentId,
          agentVersion: config.agentVersion,
          runId,
          timestamp: new Date().toISOString(),
          status: 'completed',
          latencyMs: Date.now() - startedAt,
          model: config.model,
          provider: config.provider,
          outputShape: shapeOf(result),
          environment,
        },
        config
      )
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const messageHash = await hashErrorMessage(message)
      void sendRuntimeTelemetry(
        {
          eventId: randomEventId(),
          projectId: config.projectId,
          agentId: config.agentId,
          agentVersion: config.agentVersion,
          runId,
          timestamp: new Date().toISOString(),
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          model: config.model,
          provider: config.provider,
          environment,
          error: {
            name: err instanceof Error ? err.name : undefined,
            messageHash,
            category: 'handler_error',
          },
        },
        config
      )
      throw err
    }
  }
}
`
}

/**
 * Per-handler telemetry wiring fragments. When `manifest.telemetry` is
 * absent, every fragment is the empty string / `'handle'` / `'export '` —
 * i.e. byte-for-byte the same handler source as before telemetry existed
 * (back-compat, locked in by generated-handler.test.ts). When present, the
 * core logic is renamed to an unexported `handleCore` and the exported
 * `handle` becomes `withRuntimeTelemetry(handleCore, { config: TELEMETRY_CONFIG })`
 * from the sibling `./telemetry` file generated alongside it.
 */
function telemetryHooks(
  manifest: AgentManifest
): { importLine: string; innerName: string; innerExportKeyword: string; exportBlock: string } {
  if (!manifest.telemetry) {
    return { importLine: '', innerName: 'handle', innerExportKeyword: 'export ', exportBlock: '' }
  }
  return {
    importLine: `\nimport { withRuntimeTelemetry } from './telemetry'`,
    innerName: 'handleCore',
    innerExportKeyword: '',
    exportBlock: `
export const handle = withRuntimeTelemetry(handleCore, { runId: undefined })
`,
  }
}

function langgraphHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  const tel = telemetryHooks(manifest)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}${tel.importLine}
const SYSTEM_PROMPT = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * LangGraph-style single-node runtime. Wire this node into a StateGraph in
 * your own graph file; it calls OpenAI directly so it stays dependency-light.
 * Requires: process.env.OPENAI_API_KEY.
 */
${tel.innerExportKeyword}async function ${tel.innerName}({ input }: AgentInput): Promise<AgentResult> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  let steps = 0
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: input },
      ],
      max_completion_tokens: 4096,
    }),
  })
  steps += 1
  if (steps > MAX_STEPS) throw new Error('step budget exceeded')
  if (!res.ok) throw new Error(\`OpenAI \${res.status}: \${(await res.text()).slice(0, 200)}\`)

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return { output: (data.choices?.[0]?.message?.content ?? '').trim() }
}
${tel.exportBlock}`
}

function openaiAssistantsHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  const tel = telemetryHooks(manifest)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}${tel.importLine}
const INSTRUCTIONS = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * OpenAI Responses runtime (successor to the Assistants API). Stateless per
 * run: passes the agent instructions + user input and returns the reply.
 * Requires: process.env.OPENAI_API_KEY.
 */
${tel.innerExportKeyword}async function ${tel.innerName}({ input }: AgentInput): Promise<AgentResult> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${apiKey}\`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: INSTRUCTIONS,
      input,
      max_output_tokens: 4096,
      max_tool_calls: MAX_STEPS,
    }),
  })
  if (!res.ok) throw new Error(\`OpenAI \${res.status}: \${(await res.text()).slice(0, 200)}\`)

  const data = (await res.json()) as { output_text?: string }
  return { output: (data.output_text ?? '').trim() }
}
${tel.exportBlock}`
}

function geminiHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  const tel = telemetryHooks(manifest)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}${tel.importLine}
const SYSTEM_PROMPT = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * Google Gemini runtime. Calls generativelanguage.googleapis.com directly.
 * Requires: process.env.GEMINI_API_KEY.
 */
${tel.innerExportKeyword}async function ${tel.innerName}({ input }: AgentInput): Promise<AgentResult> {
  const apiKey = readEnv('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  void MAX_STEPS
  const url =
    \`https://generativelanguage.googleapis.com/v1beta/models/\${MODEL}:generateContent\`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: input }] }],
    }),
  })
  if (!res.ok) throw new Error(\`Gemini \${res.status}: \${(await res.text()).slice(0, 200)}\`)

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  return { output: text }
}
${tel.exportBlock}`
}

function customHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  const tel = telemetryHooks(manifest)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}${tel.importLine}
const SYSTEM_PROMPT = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * Custom runtime. Point AGENT_ENDPOINT at your own inference service; it
 * receives the system prompt, model and user input and returns { output }.
 * Requires: process.env.AGENT_ENDPOINT (and any auth your service expects,
 * e.g. process.env.AGENT_API_KEY).
 */
${tel.innerExportKeyword}async function ${tel.innerName}({ input }: AgentInput): Promise<AgentResult> {
  const endpoint = readEnv('AGENT_ENDPOINT')
  if (!endpoint) throw new Error('AGENT_ENDPOINT not set')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = readEnv('AGENT_API_KEY')
  if (apiKey) headers.Authorization = \`Bearer \${apiKey}\`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
      model: MODEL,
      maxSteps: MAX_STEPS,
      input,
    }),
  })
  if (!res.ok) throw new Error(\`Agent endpoint \${res.status}: \${(await res.text()).slice(0, 200)}\`)

  const data = (await res.json()) as { output?: string }
  return { output: (data.output ?? '').trim() }
}
${tel.exportBlock}`
}

/**
 * The generated runtime handler source for a copilot, by runtime. Exported so
 * tests can assert the generated code is TypeScript-safe and dependency-free
 * (it compiles standalone in a host repo without `@types/node` or Aigent deps).
 */
export function handlerForRuntime(copilot: Copilot, manifest: AgentManifest): string {
  switch (copilot.runtime) {
    case 'langgraph':
      return langgraphHandler(copilot, manifest)
    case 'openai-assistants':
      return openaiAssistantsHandler(copilot, manifest)
    case 'gemini':
      return geminiHandler(copilot, manifest)
    case 'custom':
      return customHandler(copilot, manifest)
    default: {
      // Exhaustiveness guard: if AgentRuntime grows, this fails to compile.
      const _never: never = copilot.runtime
      throw new Error(`unsupported runtime: ${String(_never)}`)
    }
  }
}

/** Env var the generated handler reads, by runtime — documented in the README. */
function runtimeEnvVar(copilot: Copilot): string {
  switch (copilot.runtime) {
    case 'langgraph':
    case 'openai-assistants':
      return 'OPENAI_API_KEY'
    case 'gemini':
      return 'GEMINI_API_KEY'
    case 'custom':
      return 'AGENT_ENDPOINT (+ optional AGENT_API_KEY)'
    default: {
      const _never: never = copilot.runtime
      return String(_never)
    }
  }
}

/** Telemetry section for the README — only rendered when manifest.telemetry is present. */
function readmeTelemetrySection(manifest: AgentManifest): string {
  if (!manifest.telemetry) return ''
  return `

## Runtime telemetry (opt-in)

\`telemetry.ts\` wraps \`handle\` with **opt-in, best-effort, non-blocking**
runtime telemetry. No sensitive data is collected by default — inputs and
outputs are reduced to shape (counts/booleans) only, never raw content, and
errors are sent as a short hash, never the raw message. A slow or failing
telemetry POST never affects the agent's own response.

Set at deploy time to activate:

| Env var | Purpose |
|---|---|
| \`AIGENT_TELEMETRY_ENABLED\` | \`'true'\` to activate (default: inactive) |
| \`AIGENT_TELEMETRY_ENDPOINT\` | POST target for telemetry events |
| \`AIGENT_TELEMETRY_TOKEN\` | Bearer token sent as \`Authorization\` |
`
}

function readme(copilot: Copilot, manifest: AgentManifest): string {
  return `# ${copilot.name}

Auto-generated agent runtime scaffold, pushed by **Agent Mission Control**.

| | |
|---|---|
| Slug | \`${copilot.slug}\` |
| Runtime | \`${copilot.runtime}\` |
| Model | \`${copilot.model}\` (${copilot.modelProvider}) |
| Manifest version | \`${manifest.version}\` |
| Max steps / run | ${manifest.maxStepsPerRun} |
| Max cost / run | $${manifest.maxCostPerRunUsd} |

## Files

- \`handler.ts\` — runnable entry point exporting \`handle({ input })\`.
- \`manifest.json\` — the serialized agent manifest (prompt, guardrails, contract).${manifest.telemetry ? "\n- `telemetry.ts` — opt-in runtime telemetry wrapper (see below)." : ''}

## Running

The handler reads credentials from the environment at runtime — no secret is
embedded in the code. Set:

    ${runtimeEnvVar(copilot)}

Then call \`handle({ input: '...' })\`.

## Guardrails (from manifest)

- Confirmation policy: \`${manifest.confirmationPolicy}\`
- Allowed routes: ${manifest.allowedRoutes.length ? manifest.allowedRoutes.map((r) => `\`${r}\``).join(', ') : '_none declared_'}
- Forbidden actions: ${manifest.forbiddenActions.length ? manifest.forbiddenActions.map((a) => `\`${a}\``).join(', ') : '_none declared_'}
${readmeTelemetrySection(manifest)}
_Regenerate by re-pushing from Agent Mission Control; do not hand-edit._
`
}

/**
 * Generate the executable RUNTIME CODE for an agent, keyed on
 * `copilot.runtime`. Returns at least handler.ts, manifest.json and README.md.
 * No secret is ever inlined — handlers read process.env.
 */
function scaffoldAgentFiles(
  copilot: Copilot,
  manifest: AgentManifest
): ScaffoldedFile[] {
  const dir = `agents/${copilot.slug}`
  const files: ScaffoldedFile[] = [
    { path: `${dir}/handler.ts`, content: handlerForRuntime(copilot, manifest) },
    { path: `${dir}/manifest.json`, content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: `${dir}/README.md`, content: readme(copilot, manifest) },
  ]
  // telemetry.ts is only generated when the manifest opts into it — absent
  // manifest.telemetry means back-compat, unchanged scaffold (no extra file,
  // no import in handler.ts; see telemetryHooks()).
  if (manifest.telemetry) {
    files.push({ path: `${dir}/telemetry.ts`, content: telemetryWrapperSource(manifest, copilot) })
  }
  return files
}

// ---------------------------------------------------------------------------
// Host registry — turns the target repo into a readable "agent host"
//
// Beyond the per-agent scaffold, a push also maintains two index files at the
// `agents/` root that list EVERY agent hosted in the repo (the one being pushed
// plus those already present). These are aggregate files, so — unlike the pure
// per-agent scaffold — they can't be computed in isolation: a push must first
// READ the repo's current registry and MERGE, otherwise each push would clobber
// the entries of sibling agents. See `mergeRegistryEntry` / `readHostRegistry`.
//
//   agents/_registry.json — MACHINE index (array of AgentRegistryEntry)
//   agents/README.md       — HUMAN index (markdown table)
// ---------------------------------------------------------------------------

// Host registry index — paths shared with consumer-bootstrap.

/**
 * One row of the host registry: pure metadata for a single hosted agent. Never
 * carries a secret — only slug/name/version/model/runtime plus provenance.
 */
export interface AgentRegistryEntry {
  slug: string
  name: string
  version: string
  model: string
  runtime: string
  /** Provenance marker: every entry this platform writes is `"aigent"`. */
  source: 'aigent'
  /** ISO-8601 timestamp of the push that (re)wrote this entry. */
  pushedAt: string
  /** Repo-relative path to this agent's serialized manifest. */
  manifestPath: string
  /**
   * Identity chain back to Aigent — required so a delivered agent's runtime
   * telemetry (emitted by the consumer's telemetry-client.ts) can be joined
   * back to the exact project/copilot/version that produced it. Without these,
   * the registry row only carries a human-readable slug and nothing else ties
   * it back to Aigent's own ids.
   *
   * OPTIONAL on the type because rows written before these fields existed must
   * still load — see `isRegistryEntry`. Every push writes them.
   */
  aigentProjectId?: string
  copilotId?: string
  versionId?: string | null
}

/** Narrowing type guard: is `v` a well-formed AgentRegistryEntry row? */
function isRegistryEntry(v: unknown): v is AgentRegistryEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.slug === 'string' &&
    typeof e.name === 'string' &&
    typeof e.version === 'string' &&
    typeof e.model === 'string' &&
    typeof e.runtime === 'string' &&
    e.source === 'aigent' &&
    typeof e.pushedAt === 'string' &&
    typeof e.manifestPath === 'string' &&
    // Identity chain — OPTIONAL on read, ALWAYS written on push. A registry
    // pushed before these fields existed is still a valid registry, and
    // rejecting those rows here would be destructive rather than strict:
    // `mergeRegistryEntry` rebuilds the file from exactly what this guard
    // returned, so a dropped legacy row would be DELETED from the consumer
    // repo on the next unrelated push. Missing identity is a row to carry
    // forward, not a row to destroy.
    (e.aigentProjectId === undefined || typeof e.aigentProjectId === 'string') &&
    (e.copilotId === undefined || typeof e.copilotId === 'string') &&
    (e.versionId === undefined || e.versionId === null || typeof e.versionId === 'string')
  )
}

/**
 * Read + parse the repo's current `agents/_registry.json`. Fail-SOFT by design:
 *   - a 404 "file absent" (first agent hosted here) → empty registry, normal;
 *   - a genuine network/API error → log + empty registry, NEVER blocks the push
 *     (a later re-push re-aggregates from the surviving on-disk entries);
 *   - malformed / non-array JSON → empty registry.
 * Read-only: this only ever issues the GET already available via `getRepoFile`.
 */
async function readHostRegistry(
  repoFullName: string,
  ref: string
): Promise<AgentRegistryEntry[]> {
  let raw: string
  try {
    const file = await getRepoFile(repoFullName, REGISTRY_JSON_PATH, ref)
    raw = file.text
  } catch (err) {
    // A 404 surfaces as "GitHub 404 on GET …" from the shared `gh` helper: that
    // is the expected "no registry yet" case, not an error worth logging loud.
    const msg = err instanceof Error ? err.message : String(err)
    if (!/GitHub 404 /.test(msg)) {
      console.error(`[github] failed to read ${REGISTRY_JSON_PATH} from ${repoFullName}: ${msg}`)
    }
    return []
  }

  if (!raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRegistryEntry)
  } catch {
    // Corrupt/hand-edited registry: start clean rather than propagate garbage.
    return []
  }
}

/**
 * Merge the pushed agent's entry into the existing registry: drop any prior row
 * for the same slug (re-push = update, not duplicate), append the fresh entry,
 * and sort by slug for a stable diff on every push.
 */
function mergeRegistryEntry(
  existing: AgentRegistryEntry[],
  next: AgentRegistryEntry
): AgentRegistryEntry[] {
  return existing
    .filter((e) => e.slug !== next.slug)
    .concat(next)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

/** Serialize the machine index: pretty JSON, trailing newline (stable diff). */
function renderRegistryJson(entries: AgentRegistryEntry[]): string {
  return `${JSON.stringify(entries, null, 2)}\n`
}

/** Render the human index: a markdown table of every hosted agent. */
function renderRegistryReadme(entries: AgentRegistryEntry[]): string {
  const rows = entries
    .map(
      (e) =>
        `| \`${e.slug}\` | ${e.name} | \`${e.version}\` | \`${e.runtime}\` |`
    )
    .join('\n')
  const table = entries.length
    ? `| Slug | Name | Version | Runtime |\n|---|---|---|---|\n${rows}\n`
    : '_No agents hosted yet._\n'

  return `# Hosted agents

These agents are deployed from the **Agent Mission Control (Aigent)** platform
and must not be hand-edited — re-push from the platform to update them.

${table}`
}

/**
 * Build the two host-registry index files for this push, merged with whatever
 * agents the target repo already hosts. Read-only network work (via
 * `readHostRegistry`), fail-soft: a genuine read failure degrades to an empty
 * base registry rather than aborting the push.
 */
async function scaffoldHostRegistry(
  repoFullName: string,
  ref: string,
  copilot: Copilot,
  manifest: AgentManifest,
  project: Project
): Promise<ScaffoldedFile[]> {
  const existing = await readHostRegistry(repoFullName, ref)
  const entry: AgentRegistryEntry = {
    slug: copilot.slug,
    name: copilot.name,
    version: manifest.version,
    model: copilot.model,
    runtime: copilot.runtime,
    source: 'aigent',
    pushedAt: new Date().toISOString(),
    manifestPath: `agents/${copilot.slug}/manifest.json`,
    aigentProjectId: project.id,
    copilotId: copilot.id,
    versionId: copilot.productionVersionId ?? copilot.latestVersionId ?? null,
  }
  const merged = mergeRegistryEntry(existing, entry)
  return [
    { path: REGISTRY_JSON_PATH, content: renderRegistryJson(merged) },
    { path: REGISTRY_README_PATH, content: renderRegistryReadme(merged) },
  ]
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Push an agent's runtime code to its project's linked GitHub repo by a direct
 * commit on the repo's default branch.
 *
 * DRY-RUN by default (and forced whenever GITHUB_PUSH_ENABLED !== '1'): only a
 * read-only GET on the repo is performed to resolve the default branch; NO
 * mutating call is made. A real push requires BOTH `dryRun === false` AND
 * `GITHUB_PUSH_ENABLED === '1'`.
 */
export async function pushAgentToRepo(args: PushAgentArgs): Promise<PushResult> {
  const { project, copilot, manifest } = args
  const dryRun = args.dryRun ?? true

  if (!project.repoFullName) {
    throw new Error('project has no linked GitHub repo')
  }

  // Requiring the token here fails closed even for dry-runs (which still hit
  // the read-only GET below).
  requireGithub()

  const repoFullName = assertValidRepoFullName(project.repoFullName)

  // Double safety: dry-run unless explicitly disabled AND the env is armed.
  const wouldPush = !dryRun && pushArmed()

  const branch = await getDefaultBranch(repoFullName)

  // Per-agent scaffold PLUS the two host-registry index files, merged with the
  // agents the repo already hosts. The registry read is read-only, so it is
  // safe to run even in dry-run — and it MUST run there too, so PushResult.files
  // lists exactly the 5 paths the real push would write.
  const registryFiles = await scaffoldHostRegistry(repoFullName, branch, copilot, manifest, project)
  const scaffolded = [...scaffoldAgentFiles(copilot, manifest), ...registryFiles]
  const files = scaffolded.map((f) => f.path)

  if (!wouldPush) {
    return {
      pushed: false,
      dryRun: true,
      mode: 'direct_commit',
      branch,
      files,
      message: `dry-run: ${files.length} fichiers prêts, push désactivé`,
    }
  }

  // --- Real push via the Git Data API (commit on default branch). ---

  // 1. Current ref + head commit.
  const ref = await gh<{ object: { sha: string } }>(
    'GET',
    `repos/${repoFullName}/git/refs/heads/${branch}`
  )
  const headCommitSha = ref.object.sha
  const headCommit = await gh<{ tree: { sha: string } }>(
    'GET',
    `repos/${repoFullName}/git/commits/${headCommitSha}`
  )
  const baseTreeSha = headCommit.tree.sha

  // 2. A blob per file.
  const blobs = await Promise.all(
    scaffolded.map(async (f) => {
      const blob = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/blobs`, {
        content: f.content,
        encoding: 'utf-8',
      })
      return { path: f.path, sha: blob.sha }
    })
  )

  // 3. A tree layered on the current base tree.
  const tree = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/trees`, {
    base_tree: baseTreeSha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: '100644',
      type: 'blob',
      sha: b.sha,
    })),
  })

  // 4. The commit.
  const commitMessage = `agent(${copilot.slug}): push runtime v${manifest.version}`
  const commit = await gh<{ sha: string; html_url: string }>(
    'POST',
    `repos/${repoFullName}/git/commits`,
    {
      message: commitMessage,
      tree: tree.sha,
      parents: [headCommitSha],
    }
  )

  // 5. Advance the default-branch ref to the new commit.
  await gh('PATCH', `repos/${repoFullName}/git/refs/heads/${branch}`, {
    sha: commit.sha,
    force: false,
  })

  return {
    pushed: true,
    dryRun: false,
    mode: 'direct_commit',
    commitUrl: commit.html_url,
    commitSha: commit.sha,
    branch,
    files,
    message: `pushed ${files.length} fichiers sur ${branch} (${commit.sha.slice(0, 7)})`,
  }
}

/**
 * Deliver an agent through a PULL REQUEST instead of a direct commit: create a
 * dedicated branch off the default branch's HEAD, write the agent files THERE
 * (never on the default branch), and open a PR back to the default branch. NEVER
 * merges — the merge stays a manual act in the target repo.
 *
 * Same double safety as the direct push: DRY-RUN by default and forced unless
 * `dryRun === false` AND `GITHUB_PUSH_ENABLED === '1'`. A dry-run only performs
 * read-only GETs (default branch + registry) and returns the planned branch/files.
 */
export async function pushAgentToRepoPullRequest(args: PushAgentArgs): Promise<PushResult> {
  const { project, copilot, manifest } = args
  const dryRun = args.dryRun ?? true

  if (!project.repoFullName) throw new Error('project has no linked GitHub repo')
  requireGithub()
  const repoFullName = assertValidRepoFullName(project.repoFullName)
  const wouldPush = !dryRun && pushArmed()

  const baseBranch = await getDefaultBranch(repoFullName)
  const shortRunId = (args.runId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'run'
  const deliveryBranch = deliveryBranchName(copilot.slug, shortRunId)

  const registryFiles = await scaffoldHostRegistry(repoFullName, baseBranch, copilot, manifest, project)
  const scaffolded = [...scaffoldAgentFiles(copilot, manifest), ...registryFiles]
  const files = scaffolded.map((f) => f.path)

  if (!wouldPush) {
    return {
      pushed: false,
      dryRun: true,
      mode: 'pull_request',
      branch: deliveryBranch,
      baseBranch,
      files,
      message: `dry-run: PR planifiée sur ${deliveryBranch} → ${baseBranch} (${files.length} fichiers), push désactivé`,
    }
  }

  // 1. Resolve the base branch HEAD commit + its tree.
  const ref = await gh<{ object: { sha: string } }>('GET', `repos/${repoFullName}/git/refs/heads/${baseBranch}`)
  const headCommitSha = ref.object.sha
  const headCommit = await gh<{ tree: { sha: string } }>('GET', `repos/${repoFullName}/git/commits/${headCommitSha}`)

  // 2. Create the dedicated delivery branch off that HEAD. A 422 means the ref
  //    already exists — surface it as a clean, retryable branch_exists error.
  try {
    await gh('POST', `repos/${repoFullName}/git/refs`, {
      ref: `refs/heads/${deliveryBranch}`,
      sha: headCommitSha,
    })
  } catch (err) {
    if (err instanceof Error && /GitHub 422 on POST .*\/git\/refs/.test(err.message)) {
      throw new Error(`branch_exists: ${deliveryBranch}`)
    }
    throw err
  }

  // 3. Blobs → tree (on the base tree) → commit → advance the DELIVERY branch ref
  //    (never the default branch).
  const blobs = await Promise.all(
    scaffolded.map(async (f) => {
      const blob = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/blobs`, { content: f.content, encoding: 'utf-8' })
      return { path: f.path, sha: blob.sha }
    })
  )
  const tree = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/trees`, {
    base_tree: headCommit.tree.sha,
    tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
  })
  const commit = await gh<{ sha: string; html_url: string }>('POST', `repos/${repoFullName}/git/commits`, {
    message: `agent(${copilot.slug}): deliver runtime v${manifest.version} via PR`,
    tree: tree.sha,
    parents: [headCommitSha],
  })
  await gh('PATCH', `repos/${repoFullName}/git/refs/heads/${deliveryBranch}`, { sha: commit.sha, force: false })

  // 4. Open the PR back to the default branch. NEVER merged here.
  const pr = await gh<{ html_url: string; number: number }>('POST', `repos/${repoFullName}/pulls`, {
    title: `Deliver agent "${copilot.name}" (${copilot.slug})`,
    head: deliveryBranch,
    base: baseBranch,
    body: buildPrBody(copilot, manifest, files, args.prBodyExtra),
    maintainer_can_modify: true,
  })

  return {
    pushed: true,
    dryRun: false,
    mode: 'pull_request',
    commitUrl: commit.html_url,
    commitSha: commit.sha,
    branch: deliveryBranch,
    baseBranch,
    prUrl: pr.html_url,
    prNumber: pr.number,
    files,
    message: `PR #${pr.number} ouverte: ${deliveryBranch} → ${baseBranch} (${files.length} fichiers)`,
  }
}

/** PR body — provenance + files + validation + optional scorecard/sandbox summary. No secrets. */
function buildPrBody(copilot: Copilot, manifest: AgentManifest, files: string[], extra?: string): string {
  const lines = [
    `## Agent delivery — ${copilot.name} (\`${copilot.slug}\`)`,
    '',
    `Delivered by **Aigent** (Agent Mission Control). Merge remains a **manual** decision in this repo — this PR is never auto-merged.`,
    '',
    `- **Copilot id:** \`${copilot.id}\``,
    `- **Version:** \`${manifest.version}\``,
    `- **Runtime:** ${copilot.runtime} · **model:** ${copilot.model}`,
    `- **Source:** aigent`,
    '',
    '### Files changed',
    ...files.map((f) => `- \`${f}\``),
    '',
    '### Validation',
    'Run the target repo gate scripts (e.g. `npm run verify` / `npm run typecheck`) before merging. Aigent can validate this branch through its Target Repo Sandbox.',
  ]
  if (extra && extra.trim().length > 0) {
    lines.push('', '### Aigent quality summary', extra.trim())
  }
  lines.push('', '> ⚠️ No secret is embedded — the handler reads credentials from `process.env` at runtime.')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Consumer workspace provision — one-shot intake pack (PR by default)
// ---------------------------------------------------------------------------

export interface ProvisionConsumerArgs {
  project: Project
  /** Defaults to true. Real push requires GITHUB_PUSH_ENABLED=1. */
  dryRun?: boolean
  /** Defaults to pull_request. */
  mode?: PushAgentDeliveryMode
  /** Re-write scaffold even when consumer-ready exists. */
  force?: boolean
}

export interface ConsumerProvisionStatus {
  provisioned: boolean
  version: string | null
  provisionedAt: string | null
  projectKey: string | null
}

/** Read the consumer-ready marker from the linked repo (fail-soft). */
export async function getConsumerProvisionStatus(repoFullName: string): Promise<ConsumerProvisionStatus> {
  const repo = assertValidRepoFullName(repoFullName)
  try {
    const file = await getRepoFile(repo, CONSUMER_READY_PATH)
    const parsed = JSON.parse(file.text) as ConsumerReadyMarker
    if (typeof parsed?.version !== 'string') {
      return { provisioned: false, version: null, provisionedAt: null, projectKey: null }
    }
    return {
      provisioned: true,
      version: parsed.version,
      provisionedAt: typeof parsed.provisionedAt === 'string' ? parsed.provisionedAt : null,
      projectKey: typeof parsed.projectKey === 'string' ? parsed.projectKey : null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/GitHub 404 /.test(msg)) {
      return { provisioned: false, version: null, provisionedAt: null, projectKey: null }
    }
    throw err
  }
}

async function repoFileExists(repoFullName: string, path: string, ref: string): Promise<boolean> {
  try {
    await getRepoFile(repoFullName, path, ref)
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return !/GitHub 404 /.test(msg) ? Promise.reject(err) : false
  }
}

/** Drop pack files that must not clobber an existing consumer workspace. */
async function filterConsumerPack(
  repoFullName: string,
  ref: string,
  files: ScaffoldedFile[],
  force: boolean
): Promise<ScaffoldedFile[]> {
  if (force) return files
  const skipIfExists = new Set([AGENTS_WANTED_PATH, BINDINGS_PATH, REGISTRY_JSON_PATH])
  const kept: ScaffoldedFile[] = []
  for (const file of files) {
    if (skipIfExists.has(file.path) && (await repoFileExists(repoFullName, file.path, ref))) {
      continue
    }
    kept.push(file)
  }
  return kept
}

/**
 * Provision the standard consumer intake pack into the project's linked repo.
 * Opens a PR by default (never auto-merges). Dry-run unless confirm + GITHUB_PUSH_ENABLED.
 */
export async function provisionConsumerIntake(args: ProvisionConsumerArgs): Promise<PushResult> {
  const { project } = args
  const dryRun = args.dryRun ?? true
  const mode = args.mode ?? 'pull_request'
  const force = args.force ?? false

  if (!project.repoFullName) throw new Error('project has no linked GitHub repo')
  requireGithub()
  const repoFullName = assertValidRepoFullName(project.repoFullName)
  const wouldPush = !dryRun && pushArmed()

  const baseBranch = await getDefaultBranch(repoFullName)
  const status = await getConsumerProvisionStatus(repoFullName)
  if (status.provisioned && status.version === CONSUMER_PACK_VERSION && !force) {
    return {
      pushed: false,
      dryRun: !wouldPush,
      mode,
      branch: baseBranch,
      baseBranch,
      files: [],
      message: `consumer intake already provisioned (${CONSUMER_PACK_VERSION})`,
    }
  }

  const provisionedAt = new Date().toISOString()
  const fullPack = buildConsumerIntakePack(project, provisionedAt)
  const scaffolded = await filterConsumerPack(repoFullName, baseBranch, fullPack, force)
  const files = scaffolded.map((f) => f.path)

  const deliveryBranch = consumerProvisionBranchName(project.slug)

  if (mode === 'direct_commit') {
    if (!wouldPush) {
      return {
        pushed: false,
        dryRun: true,
        mode: 'direct_commit',
        branch: baseBranch,
        files,
        message: `dry-run: ${files.length} fichiers intake prêts, push désactivé`,
      }
    }

    const ref = await gh<{ object: { sha: string } }>('GET', `repos/${repoFullName}/git/refs/heads/${baseBranch}`)
    const headCommitSha = ref.object.sha
    const headCommit = await gh<{ tree: { sha: string } }>('GET', `repos/${repoFullName}/git/commits/${headCommitSha}`)
    const blobs = await Promise.all(
      scaffolded.map(async (f) => {
        const blob = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/blobs`, {
          content: f.content,
          encoding: 'utf-8',
        })
        return { path: f.path, sha: blob.sha }
      })
    )
    const tree = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/trees`, {
      base_tree: headCommit.tree.sha,
      tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
    })
    const commit = await gh<{ sha: string; html_url: string }>('POST', `repos/${repoFullName}/git/commits`, {
      message: `aigent: provision consumer intake (${CONSUMER_PACK_VERSION})`,
      tree: tree.sha,
      parents: [headCommitSha],
    })
    await gh('PATCH', `repos/${repoFullName}/git/refs/heads/${baseBranch}`, { sha: commit.sha, force: false })
    return {
      pushed: true,
      dryRun: false,
      mode: 'direct_commit',
      commitUrl: commit.html_url,
      commitSha: commit.sha,
      branch: baseBranch,
      files,
      message: `consumer intake provisioned on ${baseBranch} (${files.length} fichiers)`,
    }
  }

  // pull_request (default)
  if (!wouldPush) {
    return {
      pushed: false,
      dryRun: true,
      mode: 'pull_request',
      branch: deliveryBranch,
      baseBranch,
      files,
      message: `dry-run: PR intake planifiée ${deliveryBranch} → ${baseBranch} (${files.length} fichiers)`,
    }
  }

  const ref = await gh<{ object: { sha: string } }>('GET', `repos/${repoFullName}/git/refs/heads/${baseBranch}`)
  const headCommitSha = ref.object.sha
  // The delivery tree MUST layer the intake pack on top of the existing repo,
  // exactly as the direct_commit path does above. Omitting base_tree makes
  // git/trees build a tree that contains ONLY the pack entries — every other
  // file in the repo reads as deleted, so merging the PR would wipe the
  // consumer repo down to the pack. Read the head commit's tree sha and pass
  // it as base_tree so the pack is an addition, not a replacement.
  const headCommit = await gh<{ tree: { sha: string } }>('GET', `repos/${repoFullName}/git/commits/${headCommitSha}`)

  try {
    await gh('POST', `repos/${repoFullName}/git/refs`, { ref: `refs/heads/${deliveryBranch}`, sha: headCommitSha })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/422/.test(msg)) throw new Error(`branch_exists: ${deliveryBranch}`)
    throw err
  }

  const blobs = await Promise.all(
    scaffolded.map(async (f) => {
      const blob = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/blobs`, {
        content: f.content,
        encoding: 'utf-8',
      })
      return { path: f.path, sha: blob.sha }
    })
  )
  const tree = await gh<{ sha: string }>('POST', `repos/${repoFullName}/git/trees`, {
    base_tree: headCommit.tree.sha,
    tree: blobs.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
  })
  const commit = await gh<{ sha: string; html_url: string }>('POST', `repos/${repoFullName}/git/commits`, {
    message: `aigent: provision consumer intake (${CONSUMER_PACK_VERSION})`,
    tree: tree.sha,
    parents: [headCommitSha],
  })
  await gh('PATCH', `repos/${repoFullName}/git/refs/heads/${deliveryBranch}`, { sha: commit.sha, force: true })

  const pr = await gh<{ html_url: string; number: number }>('POST', `repos/${repoFullName}/pulls`, {
    title: `aigent: consumer intake (${project.name})`,
    head: deliveryBranch,
    base: baseBranch,
    body: [
      `## Consumer intake — ${project.name}`,
      '',
      'Provisioned by **Aigent**. Merge manually after review.',
      '',
      `- Pack version: \`${CONSUMER_PACK_VERSION}\``,
      `- Intake UI: \`/admin/aigent\``,
      `- Demand file: \`AGENTS-WANTED.md\``,
      '',
      '### Files',
      ...files.map((f) => `- \`${f}\``),
      '',
      'After merge: restyle `/admin/aigent` to your design system, then push agents from Aigent.',
    ].join('\n'),
  })

  return {
    pushed: true,
    dryRun: false,
    mode: 'pull_request',
    commitUrl: commit.html_url,
    commitSha: commit.sha,
    branch: deliveryBranch,
    baseBranch,
    prUrl: pr.html_url,
    prNumber: pr.number,
    files,
    message: `PR #${pr.number}: consumer intake → ${baseBranch} (${files.length} fichiers)`,
  }
}
