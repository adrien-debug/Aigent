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

// ---------------------------------------------------------------------------
// Config / fail-closed
// ---------------------------------------------------------------------------

const GITHUB_API = 'https://api.github.com'

/** Resolve the GitHub token, or throw (fail-closed, no fallback). */
export function requireGithub(): { token: string } {
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
// Public shapes
// ---------------------------------------------------------------------------

export interface ScaffoldedFile {
  path: string
  content: string
}

export interface PushResult {
  pushed: boolean
  dryRun: boolean
  commitUrl?: string
  branch: string
  files: string[]
  message: string
}

export interface PushAgentArgs {
  project: Project
  copilot: Copilot
  manifest: AgentManifest
  /** Defaults to true. A real push also requires GITHUB_PUSH_ENABLED=1. */
  dryRun?: boolean
}

// ---------------------------------------------------------------------------
// Low-level GitHub fetch (fail-closed on non-2xx)
// ---------------------------------------------------------------------------

async function gh<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  const { token } = requireGithub()
  const res = await fetch(`${GITHUB_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
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
  const repo = await gh<{ default_branch: string }>('GET', `repos/${repoFullName}`)
  return repo.default_branch
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
  const resolvedRef = ref ?? (await getDefaultBranch(repoFullName))
  const data = await gh<{
    truncated?: boolean
    tree?: { path: string; type: string; size?: number }[]
  }>(
    'GET',
    `repos/${repoFullName}/git/trees/${encodeURIComponent(resolvedRef)}?recursive=1`
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
  const cleanPath = path.replace(/^\/+/, '')
  const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/')
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : ''

  const data = await gh<{
    type: string
    path: string
    content?: string
    encoding?: string
  }>('GET', `repos/${repoFullName}/contents/${encodedPath}${query}`)

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

// ---------------------------------------------------------------------------
// Scaffolding — real, runnable runtime code per runtime
// ---------------------------------------------------------------------------

/** Escape a string for safe embedding inside a JS template literal. */
function forTemplate(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
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
`

function langgraphHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}
const SYSTEM_PROMPT = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * LangGraph-style single-node runtime. Wire this node into a StateGraph in
 * your own graph file; it calls OpenAI directly so it stays dependency-light.
 * Requires: process.env.OPENAI_API_KEY.
 */
export async function handle({ input }: AgentInput): Promise<AgentResult> {
  const apiKey = process.env.OPENAI_API_KEY
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
`
}

function openaiAssistantsHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}
const INSTRUCTIONS = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * OpenAI Responses runtime (successor to the Assistants API). Stateless per
 * run: passes the agent instructions + user input and returns the reply.
 * Requires: process.env.OPENAI_API_KEY.
 */
export async function handle({ input }: AgentInput): Promise<AgentResult> {
  const apiKey = process.env.OPENAI_API_KEY
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
`
}

function geminiHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}
const SYSTEM_PROMPT = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * Google Gemini runtime. Calls generativelanguage.googleapis.com directly.
 * Requires: process.env.GEMINI_API_KEY.
 */
export async function handle({ input }: AgentInput): Promise<AgentResult> {
  const apiKey = process.env.GEMINI_API_KEY
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
`
}

function customHandler(copilot: Copilot, manifest: AgentManifest): string {
  const sys = forTemplate(manifest.systemPromptSummary)
  return `${handlerHeader(copilot)}
${SHARED_TYPES}
const SYSTEM_PROMPT = \`${sys}\`
const MODEL = ${JSON.stringify(copilot.model)}
const MAX_STEPS = ${manifest.maxStepsPerRun}

/**
 * Custom runtime. Point AGENT_ENDPOINT at your own inference service; it
 * receives the system prompt, model and user input and returns { output }.
 * Requires: process.env.AGENT_ENDPOINT (and any auth your service expects,
 * e.g. process.env.AGENT_API_KEY).
 */
export async function handle({ input }: AgentInput): Promise<AgentResult> {
  const endpoint = process.env.AGENT_ENDPOINT
  if (!endpoint) throw new Error('AGENT_ENDPOINT not set')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = process.env.AGENT_API_KEY
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
`
}

function handlerForRuntime(copilot: Copilot, manifest: AgentManifest): string {
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
- \`manifest.json\` — the serialized agent manifest (prompt, guardrails, contract).

## Running

The handler reads credentials from the environment at runtime — no secret is
embedded in the code. Set:

    ${runtimeEnvVar(copilot)}

Then call \`handle({ input: '...' })\`.

## Guardrails (from manifest)

- Confirmation policy: \`${manifest.confirmationPolicy}\`
- Allowed routes: ${manifest.allowedRoutes.length ? manifest.allowedRoutes.map((r) => `\`${r}\``).join(', ') : '_none declared_'}
- Forbidden actions: ${manifest.forbiddenActions.length ? manifest.forbiddenActions.map((a) => `\`${a}\``).join(', ') : '_none declared_'}

_Regenerate by re-pushing from Agent Mission Control; do not hand-edit._
`
}

/**
 * Generate the executable RUNTIME CODE for an agent, keyed on
 * `copilot.runtime`. Returns at least handler.ts, manifest.json and README.md.
 * No secret is ever inlined — handlers read process.env.
 */
export function scaffoldAgentFiles(
  copilot: Copilot,
  manifest: AgentManifest
): ScaffoldedFile[] {
  const dir = `agents/${copilot.slug}`
  return [
    { path: `${dir}/handler.ts`, content: handlerForRuntime(copilot, manifest) },
    { path: `${dir}/manifest.json`, content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: `${dir}/README.md`, content: readme(copilot, manifest) },
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

  const scaffolded = scaffoldAgentFiles(copilot, manifest)
  const files = scaffolded.map((f) => f.path)
  const repoFullName = project.repoFullName

  // Double safety: dry-run unless explicitly disabled AND the env is armed.
  const wouldPush = !dryRun && pushArmed()

  const branch = await getDefaultBranch(repoFullName)

  if (!wouldPush) {
    return {
      pushed: false,
      dryRun: true,
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
    commitUrl: commit.html_url,
    branch,
    files,
    message: `pushed ${files.length} fichiers sur ${branch} (${commit.sha.slice(0, 7)})`,
  }
}
