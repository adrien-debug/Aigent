/**
 * Tool registry — the single, real, executable tool factory for the Agent
 * Builder graph.
 *
 * WHY this file exists: the graph used to hard-code its 5 tools, its
 * confirmation Set and its risk map. The platform now runs ONE LangGraph
 * assistant PER COPILOT, whose behaviour is carried in
 * `config.configurable` (a CopilotBehaviorConfig — see ASSISTANT_CONFIG_CONTRACT).
 * That config lists which tools a copilot gets, each with its own SCOPE
 * (repoFullName / allowedHosts), its `requiresConfirmation` and its `riskLevel`.
 *
 * This module is the REGISTRY those config entries reference. Given a
 * `tools[]` array from the config it mounts REAL, executable LangChain tools —
 * NO stubs. Repo tools hit the live GitHub API (GITHUB_TOKEN); http_get does a
 * real, allowlist-gated fetch; the read tools hit the same live PostgREST
 * perimeter as before (their impls live HERE now, so the graph and the registry
 * never duplicate them); draft_copilot_spec reuses the shared pure builder.
 *
 * The factory ALSO derives `confirmRequired` (Set) and `toolRisk` (map) from the
 * config itself — so the graph no longer owns any hard-coded behaviour on the
 * configured path.
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

import { pgrest } from './pgrest.mjs'
import { buildCopilotDraft } from './draft-spec.mjs'
import { guardedFetch } from './http-guard.mjs'

// Keep large tool outputs bounded so a single call can't blow the context.
const MAX_BODY_CHARS = 8000
const HTTP_TIMEOUT_MS = 10_000
const MARKET_TOOL_TIMEOUT_MS = 15_000

function truncate(text, max = MAX_BODY_CHARS) {
  if (typeof text !== 'string') text = String(text)
  return text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text
}

// Repo paths that must never be readable/listable/searchable by the model,
// even inside a repo the copilot is otherwise scoped to — secrets, private
// keys and credential files. Matched against the repo-relative path (and,
// for tree listings, the bare file name too).
const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /\.pem$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  // "secret"/"secrets" as a delimited token (start, /, ., _ or -) — matches
  // secret.json, my_secret.txt, db-secret.yaml, secrets.yml; NOT secretary.js.
  /(^|[/._-])secrets?([/._-]|$)/i,
  /\.key$/i,
  /(^|\/)credentials(\.|$)/i,
  /\.pfx$/i,
  /\.p12$/i,
]

/**
 * @param {string} p a repo-relative path (or file name)
 * @returns {boolean} true if the path looks like a secret/credential file
 */
function isSecretPath(p) {
  return SECRET_PATH_PATTERNS.some((re) => re.test(p))
}

function githubHeaders() {
  const token = process.env.GITHUB_TOKEN
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'agent-builder-copilot',
  }
  // Auth is optional at the HTTP level but effectively required for private
  // repos and to avoid the anonymous rate limit — send it whenever present.
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/**
 * Normalise a repo path for the GitHub Contents API.
 *
 * WHY: the Contents API expects the repo ROOT as an EMPTY string
 * (`GET /repos/{owner}/{name}/contents/`), NOT "." or "/". In prod the model
 * kept passing path="." (or "/") to mean "the root", which hit `/contents/.`
 * (or `/contents/%2F`) → 404, so the tool returned an error and the model gave
 * up. This maps every "root-ish" sentinel ("", ".", "/", "./", undefined, null)
 * to "" and strips a leading "./" or "/" from real paths, so "foo/bar",
 * "/foo/bar" and "./foo" all resolve to the repo-relative path GitHub expects.
 *
 * @param {unknown} p the path the model supplied (may be undefined/null/".")
 * @returns {string} "" for the root, else the cleaned repo-relative path
 */
function normalizeRepoPath(p) {
  // Missing / non-string → root.
  if (p === undefined || p === null) return ''
  const s = String(p).trim()
  // Root sentinels the model tends to invent → the empty string GitHub wants.
  if (s === '' || s === '.' || s === '/' || s === './') return ''
  // Strip a single leading "./" or "/" so "./foo" and "/foo/bar" become
  // "foo" / "foo/bar". A bare dotfile like ".env" is untouched (no slash).
  return s.replace(/^\.?\//, '')
}

// ---------------------------------------------------------------------------
// Real tool IMPLEMENTATIONS, each a factory that closes over its config scope.
// Every factory returns a LangChain `tool(...)` whose `name` === the registry id.
// ---------------------------------------------------------------------------

// --- GitHub repo tools (scope.repoFullName = "owner/name") -----------------

function makeReadRepoFile(scope) {
  return tool(
    async ({ path }) => {
      const repo = scope?.repoFullName
      if (!repo) return JSON.stringify({ ok: false, error: 'no repoFullName in scope' })
      if (!process.env.GITHUB_TOKEN) {
        return JSON.stringify({ ok: false, error: 'GITHUB_TOKEN not set in the graph server env' })
      }
      // Normalise "." / "/" / "./" / missing → "" (root) so the model can't 404
      // the repo root; strip leading "./" or "/" from real paths.
      const cleanPath = normalizeRepoPath(path)
      // Refuse secret/credential-looking paths BEFORE ever hitting GitHub —
      // .env, *.pem, id_rsa, *secret*, *.key, credentials*, *.pfx, *.p12.
      if (isSecretPath(cleanPath)) {
        return JSON.stringify({ ok: false, error: 'refused: this path looks like a secret/credential file and cannot be read' })
      }
      const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/')
      const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}`
      try {
        const res = await fetch(url, { headers: githubHeaders(), cache: 'no-store' })
        if (!res.ok) {
          // Include status AND a short readable message so the model understands
          // what went wrong (and can retry with a different path) — not an opaque blob.
          const error = res.status === 404
            ? `path not found: '${cleanPath}' in ${repo}`
            : `GitHub ${res.status} for ${repo}/${cleanPath}`
          return JSON.stringify({ ok: false, status: res.status, error })
        }
        const data = await res.json()
        if (Array.isArray(data)) {
          return JSON.stringify({ ok: false, error: `'${cleanPath}' is a directory, use list_repo_tree` })
        }
        // Contents API returns base64 for files; decode to real text.
        const content = data.encoding === 'base64' && typeof data.content === 'string'
          ? Buffer.from(data.content, 'base64').toString('utf8')
          : String(data.content ?? '')
        return JSON.stringify({ ok: true, repo, path: data.path, size: data.size, content: truncate(content) })
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
    {
      name: 'read_repo_file',
      description:
        'Read a single file from the copilot\'s scoped GitHub repo (real GitHub API) — read-only. Pass the repo-relative path, e.g. "README.md" (do NOT pass "." — for the repo root use list_repo_tree with an empty/omitted path). Returns { ok, path, size, content } (content truncated ~8000 chars). Use list_repo_tree to discover paths.',
      schema: z.object({
        path: z.string().describe('Repo-relative path to the file, e.g. "README.md" or "src/index.ts". A leading "./" or "/" is stripped automatically.'),
      }),
    }
  )
}

function makeListRepoTree(scope) {
  return tool(
    async ({ path }) => {
      const repo = scope?.repoFullName
      if (!repo) return JSON.stringify({ ok: false, error: 'no repoFullName in scope' })
      if (!process.env.GITHUB_TOKEN) {
        return JSON.stringify({ ok: false, error: 'GITHUB_TOKEN not set in the graph server env' })
      }
      // Normalise "." / "/" / "./" / missing → "" (root). The Contents API wants
      // "" for the root — "." or "/" would 404 and the model would think the
      // repo root doesn't exist.
      const cleanPath = normalizeRepoPath(path)
      const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/')
      const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}`
      try {
        const res = await fetch(url, { headers: githubHeaders(), cache: 'no-store' })
        if (!res.ok) {
          // Status + short readable message so the model can retry with another path.
          const error = res.status === 404
            ? `path not found: '${cleanPath}' in ${repo}`
            : `GitHub ${res.status} for ${repo}/${cleanPath}`
          return JSON.stringify({ ok: false, status: res.status, error })
        }
        const data = await res.json()
        // A single file returns an object, not an array — normalise both.
        // Drop anything that looks like a secret/credential file so the tool
        // doesn't even let the model discover it exists.
        const entries = (Array.isArray(data) ? data : [data])
          .map((e) => ({ name: e.name, type: e.type, path: e.path }))
          .filter((e) => !isSecretPath(e.path) && !isSecretPath(e.name))
        return JSON.stringify({ ok: true, repo, path: cleanPath, count: entries.length, entries })
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
    {
      name: 'list_repo_tree',
      description:
        'List the entries (files and folders) of the copilot\'s scoped GitHub repo, at the root or a sub-folder (real GitHub API) — read-only. For the repo ROOT pass an EMPTY path or omit it (do NOT pass "." or "/"). Returns { ok, count, entries:[{name,type,path}] }.',
      schema: z.object({
        path: z.string().optional().describe('Repo-relative folder to list. Omit (or pass "") for the repo root — do NOT pass "." or "/". A leading "./" or "/" is stripped automatically.'),
      }),
    }
  )
}

function makeSearchRepo(scope) {
  return tool(
    async ({ query }) => {
      const repo = scope?.repoFullName
      if (!repo) return JSON.stringify({ ok: false, error: 'no repoFullName in scope' })
      if (!process.env.GITHUB_TOKEN) {
        return JSON.stringify({ ok: false, error: 'GITHUB_TOKEN not set in the graph server env' })
      }
      if (!query || !String(query).trim()) return JSON.stringify({ ok: false, error: 'query required' })
      const q = `${query} repo:${repo}`
      const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=10`
      try {
        const res = await fetch(url, { headers: githubHeaders(), cache: 'no-store' })
        if (res.status === 403) {
          // Code search is heavily rate-limited (and needs auth) — surface it cleanly.
          return JSON.stringify({ ok: false, status: 403, error: 'GitHub code search rate-limited or forbidden (needs auth / cooldown)' })
        }
        if (!res.ok) {
          return JSON.stringify({ ok: false, status: res.status, error: `GitHub search ${res.status}` })
        }
        const data = await res.json()
        // Drop matches inside secret/credential-looking files — search must not
        // leak their existence or content snippets either.
        const results = (data.items ?? [])
          .map((i) => ({ path: i.path, url: i.html_url }))
          .filter((r) => !isSecretPath(r.path))
        const total = data.total_count ?? results.length
        if (total === 0) {
          // GitHub code search frequently returns 200 + total_count 0 on private
          // or unindexed repos — that's NOT a reliable "no matches", so don't let
          // the model treat it as proof the code doesn't exist.
          return JSON.stringify({
            ok: true,
            repo,
            total,
            results,
            note: 'code search may be unavailable or unindexed on private repos; if you expected matches, use list_repo_tree + read_repo_file instead',
          })
        }
        return JSON.stringify({ ok: true, repo, total, results })
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    },
    {
      name: 'search_repo',
      description:
        'Search code inside the copilot\'s scoped GitHub repo (real GitHub code-search API) — read-only. Returns the top matches as { path, url }. Note: code search is rate-limited; a 403 means try again later.',
      schema: z.object({
        query: z.string().describe('Code search query (GitHub search syntax), scoped automatically to the copilot\'s repo.'),
      }),
    }
  )
}

// --- Generic HTTP GET, gated by an explicit host allowlist -----------------

/**
 * Stable, model-facing `error` label for each guard refusal code. The tool's
 * JSON contract is read by an LLM, so the wording is pinned here rather than
 * passed through from the guard's internal prose.
 */
const HTTP_GUARD_ERROR_LABEL = {
  'invalid-url': 'invalid url',
  'disallowed-scheme': 'disallowed scheme',
  'host-not-allowed': 'host not allowed',
  'redirect-invalid-url': 'redirect target is not a parseable url',
  'redirect-disallowed-scheme': 'redirect to disallowed scheme',
  'redirect-host-not-allowed': 'redirect to disallowed host',
  'too-many-redirects': 'too many redirects',
}

function makeHttpGet(scope) {
  const allowedHosts = Array.isArray(scope?.allowedHosts) ? scope.allowedHosts : []
  return tool(
    async ({ url }) => {
      // SSRF guard — SHARED with HttpMarketProvider via ./http-guard.mjs, so a
      // hardening lands on both paths at once (they used to be two copies, and
      // the scheme check existed on the market copy only). The guard validates
      // scheme + host up front, disables auto-redirect and re-validates every
      // hop; it never throws, so every outcome below is a plain return.
      const out = await guardedFetch(url, {
        allowedHosts,
        timeoutMs: HTTP_TIMEOUT_MS,
        headers: { 'User-Agent': 'agent-builder-copilot' },
        readBody: (res) => res.text(),
      })
      if (!out.ok) {
        const error = HTTP_GUARD_ERROR_LABEL[out.code] ?? out.reason
        // `host not allowed` echoes the allowlist so the model can self-correct
        // instead of retrying the same refused host.
        return JSON.stringify(
          out.code === 'host-not-allowed'
            ? { ok: false, error, host: out.host, allowedHosts }
            : { ok: false, error, host: out.host ?? undefined, reason: out.reason }
        )
      }
      return JSON.stringify({ ok: true, status: out.status, host: out.host, body: truncate(out.body) })
    },
    {
      name: 'http_get',
      description:
        'HTTP GET a URL whose host is on the copilot\'s allowlist (real fetch) — read-only. Refuses any non-http(s) scheme, any host not in scope.allowedHosts, and re-checks every redirect hop\'s scheme and host too. Returns { ok, status, body } (body truncated ~8000 chars).',
      schema: z.object({
        url: z.string().describe('Absolute http(s) URL to GET. Its host must be in the copilot\'s allowedHosts, else the call is refused.'),
      }),
    }
  )
}

// --- Canonical market reads via the authenticated Next server boundary -----
// The canonical handlers live in market/tools.ts and are intentionally
// `server-only`. The Agent Server is a separate Node process, so it calls the
// protected internal route that dispatches to those exact handlers instead of
// duplicating provider, truth/provenance, or indicator logic here.

const MARKET_PAIR_SCHEMA = z.enum(['BTCUSDT', 'ETHUSDT', 'ETHUSDC', 'BTCUSDC'])
const MARKET_INTERVAL_SCHEMA = z.enum(['1m', '5m', '15m', '1h', '4h', '1d'])

const MARKET_TOOL_SPECS = {
  read_market_snapshot: {
    description:
      'Read a truth-aware market snapshot for one supported pair, including candles, structure, volatility and source freshness when available. Read-only; missing blocks remain UNAVAILABLE/null and are never fabricated.',
    schema: z.object({
      pair: MARKET_PAIR_SCHEMA,
      intervals: z.array(MARKET_INTERVAL_SCHEMA).min(1).max(6).optional(),
      candleLimit: z.number().int().min(2).max(500).optional(),
      volatilityInterval: MARKET_INTERVAL_SCHEMA.optional(),
      asOf: z.number().int().optional(),
      maxAgeMs: z.number().int().min(0).nullable().optional(),
    }).strict(),
  },
  read_volatility_state: {
    description:
      'Read the current ATR/stdev-derived volatility state for a supported pair and interval from real market candles. Read-only; insufficient or absent candles return UNAVAILABLE.',
    schema: z.object({
      pair: MARKET_PAIR_SCHEMA,
      interval: MARKET_INTERVAL_SCHEMA.optional(),
      limit: z.number().int().min(15).max(500).optional(),
      asOf: z.number().int().optional(),
    }).strict(),
  },
  read_market_structure: {
    description:
      'Read deterministic market structure and trend for a supported pair and interval from real market candles. Read-only; insufficient or absent candles return UNAVAILABLE.',
    schema: z.object({
      pair: MARKET_PAIR_SCHEMA,
      interval: MARKET_INTERVAL_SCHEMA.optional(),
      limit: z.number().int().min(15).max(500).optional(),
      asOf: z.number().int().optional(),
    }).strict(),
  },
  read_multi_timeframe_candles: {
    description:
      'Read bounded candle series for one supported pair across one to six requested timeframes. Read-only; every timeframe carries its real truth and source provenance.',
    schema: z.object({
      pair: MARKET_PAIR_SCHEMA,
      intervals: z.array(MARKET_INTERVAL_SCHEMA).min(1).max(6),
      limit: z.number().int().min(2).max(500).optional(),
      asOf: z.number().int().optional(),
    }).strict(),
  },
  read_liquidity_snapshot: {
    description:
      'Read a bounded order-book liquidity snapshot for a supported pair. Read-only; when no real order-book source exists the result is explicitly UNAVAILABLE.',
    schema: z.object({
      pair: MARKET_PAIR_SCHEMA,
      depth: z.number().int().min(1).max(100).optional(),
      asOf: z.number().int().optional(),
    }).strict(),
  },
  read_macro_context: {
    description:
      'Read truth-aware BTC and ETH macro market context derived from real 4h candle structure. Read-only and contextual only; it never authorizes execution.',
    schema: z.object({
      asOf: z.number().int().optional(),
    }).strict(),
  },
  read_account_risk_snapshot: {
    description:
      'Read the account and exposure risk snapshot when a real read-only account source is available. Never invents capital or positions; currently returns UNAVAILABLE when no source exists.',
    schema: z.object({
      pair: MARKET_PAIR_SCHEMA.optional(),
      asOf: z.number().int().optional(),
    }).strict(),
  },
}

/** The seven canonical market tool ids mounted by the LangGraph registry. */
export const MARKET_TOOL_IDS = Object.freeze(Object.keys(MARKET_TOOL_SPECS))

async function invokeMarketHandler(name, args) {
  const appBase =
    process.env.AIGENT_INTERNAL_URL?.replace(/\/+$/, '') ??
    `http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3210}`
  const apiKey = process.env.AMC_API_KEY
  if (!apiKey) {
    return JSON.stringify({ ok: false, error: 'market tool bridge unavailable: AMC_API_KEY not configured' })
  }

  try {
    const response = await fetch(
      `${appBase}/api/agent-ops/market-tools/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-amc-key': apiKey,
        },
        body: JSON.stringify({ args }),
        cache: 'no-store',
        signal: AbortSignal.timeout(MARKET_TOOL_TIMEOUT_MS),
      }
    )
    if (!response.ok) {
      return JSON.stringify({
        ok: false,
        error: `market tool bridge failed with HTTP ${response.status}`,
      })
    }
    const body = await response.json()
    return truncate(JSON.stringify(body))
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? `timed out after ${MARKET_TOOL_TIMEOUT_MS}ms`
        : 'market tool bridge unavailable'
    return JSON.stringify({ ok: false, error: reason })
  }
}

function makeMarketReadTool(name) {
  const spec = MARKET_TOOL_SPECS[name]
  return tool(
    async (args) => invokeMarketHandler(name, args),
    {
      name,
      description: spec.description,
      schema: spec.schema,
    }
  )
}

// --- Live PostgREST read tools (impls now live HERE — single source) -------
// These were previously defined inline in the graph; moved here verbatim so the
// graph consumes them from the registry and nothing is duplicated.

function makeReadProjectSummary() {
  return tool(
    async ({ projectId }) => {
      if (projectId) {
        const rows = await pgrest(`projects?select=id,name,platform,repo_full_name&id=eq.${encodeURIComponent(projectId)}`)
        return JSON.stringify(rows[0] ?? { error: 'project not found' })
      }
      const rows = await pgrest('projects?select=id,name,platform,repo_full_name&order=created_at')
      return JSON.stringify({ count: rows.length, projects: rows })
    },
    {
      name: 'read_project_summary',
      // Behaviour spelled out because the model can't infer it from the shape:
      // WITHOUT projectId this LISTS every project (with a count); WITH projectId
      // it returns that one project. Prod bug: an unspecified description made the
      // model refuse "list the projects" though no-arg already lists them all.
      description:
        'List or read projects (name, platform, linked repo) — read-only. Call with NO projectId to LIST ALL projects (returns { count, projects }). Pass a projectId to read just that one project.',
      schema: z.object({
        projectId: z
          .string()
          .optional()
          .describe('Omit to list ALL projects; provide an id to read only that project.'),
      }),
    }
  )
}

function makeReadCopilotSummary() {
  return tool(
    async ({ copilotId }) => {
      const id = copilotId
      if (id) {
        const rows = await pgrest(
          `copilots?select=id,name,status,model,model_provider,runtime,health&id=eq.${encodeURIComponent(id)}`
        )
        return JSON.stringify(rows[0] ?? { error: 'copilot not found' })
      }
      const rows = await pgrest('copilots?select=id,name,status,model,runtime&order=name')
      return JSON.stringify({ count: rows.length, copilots: rows })
    },
    {
      name: 'read_copilot_summary',
      // Behaviour spelled out because the model can't infer it from the shape:
      // WITHOUT copilotId this LISTS every copilot (with a count); WITH copilotId
      // it returns that one copilot. Prod bug: with the old vague description the
      // model answered "I can only read one copilot by id" and refused to list —
      // even though no-arg lists them ALL (this is the canonical way to count them).
      description:
        'List or read copilots (status, model, runtime, health) — read-only. Call with NO copilotId to LIST ALL copilots (returns { count, copilots }) — this is how you enumerate or count them. Pass a copilotId to read just that one copilot.',
      schema: z.object({
        copilotId: z
          .string()
          .optional()
          .describe('Omit to list ALL copilots (use this to enumerate/count); provide an id to read only that copilot.'),
      }),
    }
  )
}

function makeReadRecentRuns() {
  return tool(
    async ({ copilotId, limit }) => {
      const cap = Math.min(Math.max(1, limit ?? 5), 20)
      const filter = copilotId ? `&copilot_id=eq.${encodeURIComponent(copilotId)}` : ''
      const rows = await pgrest(
        `agent_runs?select=id,status,started_at,latency_ms,cost_usd,input_summary,output_summary${filter}&order=started_at.desc&limit=${cap}`
      )
      return JSON.stringify({ count: rows.length, runs: rows })
    },
    {
      name: 'read_recent_runs',
      // Behaviour spelled out: WITHOUT copilotId this returns the most recent runs
      // ACROSS ALL copilots; WITH copilotId it returns only that copilot's runs.
      // `limit` defaults to 5 and is clamped to [1, 20].
      description:
        'Read recent agent runs (status, cost, latency) — read-only. Call with NO copilotId to get the most recent runs across ALL copilots; pass a copilotId to get only that copilot\'s runs. Optional limit defaults to 5, max 20. Returns { count, runs }.',
      schema: z.object({
        copilotId: z
          .string()
          .optional()
          .describe('Omit for recent runs across all copilots; provide an id to filter to one copilot.'),
        limit: z.number().optional().describe('How many runs to return. Default 5, clamped to 1–20.'),
      }),
    }
  )
}

function makeReadToolPermissions() {
  return tool(
    async ({ copilotId }) => {
      if (!copilotId) return JSON.stringify({ error: 'copilotId required' })
      const rows = await pgrest(
        `tools?select=name,risk_level,enabled,requires_confirmation,provider&copilot_id=eq.${encodeURIComponent(copilotId)}&order=risk_level,name`
      )
      const needConfirm = rows.filter((r) => r.requires_confirmation).length
      return JSON.stringify({ count: rows.length, requiresConfirmationCount: needConfirm, tools: rows })
    },
    {
      name: 'read_tool_permissions',
      // Behaviour spelled out: unlike the other read tools this one REQUIRES a
      // copilotId (permissions are always scoped to a single copilot); with no id
      // it returns an error, so obtain one via read_copilot_summary first.
      description:
        'Read the tool permission matrix (risk, enabled, requires-confirmation) for ONE copilot — read-only. REQUIRES a copilotId; without it the call returns an error. Returns { count, requiresConfirmationCount, tools }. To find an id first, call read_copilot_summary with no argument.',
      schema: z.object({
        copilotId: z
          .string()
          .optional()
          .describe('REQUIRED — the copilot whose tool permissions to read. Omitting it returns an error.'),
      }),
    }
  )
}

// --- The gated WRITE tool — reuses the shared pure builder ------------------

function makeDraftCopilotSpec() {
  // A PURE tool (no interrupt inside). Human approval is enforced UPSTREAM by the
  // dedicated `approval` node, so this body only runs AFTER approval and never
  // re-runs on replay. It NEVER persists — it returns a proposed spec built by the
  // SHARED builder (draft-spec.mjs), so the direct path and this path can't diverge.
  return tool(
    async ({ name, description, runtime, model }) => {
      return JSON.stringify({ ok: true, persisted: false, draft: buildCopilotDraft({ name, description, runtime, model }) })
    },
    {
      name: 'draft_copilot_spec',
      description:
        'Prepare a DRAFT copilot spec (manifest + tools + starter tests/benchmark) for human review. Requires human confirmation before it runs; never persists anything.',
      schema: z.object({
        name: z.string().optional().describe('Human-readable name for the copilot to draft.'),
        description: z.string().optional().describe('One-line description of what the copilot does.'),
        // Field docs steer the model toward the platform's real values. The prod
        // bug was the model volunteering "default"/"gpt-4.1" hints — off-platform —
        // when the actual runtime is 'langgraph' and the default model is 'gpt-5.4'.
        runtime: z
          .string()
          .optional()
          .describe("Execution runtime. Prefer 'langgraph' (the platform runtime; the only one with a real engine). Omit to default to 'langgraph' — do NOT pass 'default'."),
        model: z
          .string()
          .optional()
          .describe("Model id. Prefer the platform default 'gpt-5.4'. Omit to use it — do NOT pass legacy ids like 'gpt-4.1'."),
      }),
    }
  )
}

// ---------------------------------------------------------------------------
// The registry — maps a registry `id` to a factory (scope) → real tool.
// Repo/http tools take the per-copilot scope; the rest ignore it.
// ---------------------------------------------------------------------------
const REGISTRY = {
  read_repo_file: (scope) => makeReadRepoFile(scope),
  list_repo_tree: (scope) => makeListRepoTree(scope),
  search_repo: (scope) => makeSearchRepo(scope),
  http_get: (scope) => makeHttpGet(scope),
  read_project_summary: () => makeReadProjectSummary(),
  read_copilot_summary: () => makeReadCopilotSummary(),
  read_recent_runs: () => makeReadRecentRuns(),
  read_tool_permissions: () => makeReadToolPermissions(),
  draft_copilot_spec: () => makeDraftCopilotSpec(),
  ...Object.fromEntries(MARKET_TOOL_IDS.map((id) => [id, () => makeMarketReadTool(id)])),
}

/** The set of all tool ids the registry can build. */
export const REGISTRY_IDS = Object.keys(REGISTRY)

/**
 * Build a single real tool by registry id, scoped. Returns null for an unknown
 * id (the caller decides whether to skip or error). Exposed for the fallback
 * path (the graph builds its 5 default tools through this).
 */
export function buildTool(id, scope) {
  const make = REGISTRY[id]
  return make ? make(scope ?? {}) : null
}

/**
 * The factory the graph calls with `cfg.tools` (the CopilotBehaviorConfig's
 * tools[]). It mounts the REAL tools and derives gating from the config itself:
 *   - `tools`          — the executable LangChain tools, in config order
 *   - `confirmRequired`— Set of tool names where requiresConfirmation === true
 *   - `toolRisk`       — name → riskLevel map (default 'medium' when absent)
 * Unknown ids are skipped (defensive — a stale config can't crash the graph).
 *
 * @param {Array<{id:string, requiresConfirmation?:boolean, riskLevel?:string, scope?:object}>} configTools
 */
export function buildToolsFromConfig(configTools = []) {
  const tools = []
  const confirmRequired = new Set()
  const toolRisk = {}
  const seenIds = new Set()
  for (const entry of Array.isArray(configTools) ? configTools : []) {
    if (!entry || typeof entry.id !== 'string') continue
    // Dedupe by id: a stale config with two entries of the same id would
    // otherwise mount two tools with the same name, and bindTools would be
    // handed a duplicate. Only the first occurrence of each id mounts.
    if (seenIds.has(entry.id)) continue
    seenIds.add(entry.id)
    const built = buildTool(entry.id, entry.scope)
    if (!built) continue // skip unknown ids rather than crash on a stale config
    tools.push(built)
    if (entry.requiresConfirmation === true) confirmRequired.add(entry.id)
    toolRisk[entry.id] = entry.riskLevel ?? 'medium'
  }
  return { tools, confirmRequired, toolRisk }
}
