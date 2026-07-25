/**
 * Agent Mission Control — Project Repo Intelligence (server only).
 *
 * The read-only brain behind "open a Project → understand its repo". One tree
 * fetch + a bounded set of key-file reads (via github.ts, which validates paths
 * and REFUSES secret/credential files) produce a structured, secret-free
 * intelligence bundle:
 *
 *   RepoMap             — stack, package manager, scripts, routes, components,
 *                         lib modules, tests, config, docs, DS + env signals
 *   AgenticFootprint    — does this repo already contain agent logic, and where
 *   ResidueFinding[]    — dead/stale/residue signals (SIGNALLED, never removed)
 *   AgentRecommendation — 3–7 agents that would be useful FOR THIS repo
 *
 * Everything here is DETERMINISTIC and structural (path/dependency shape), not
 * an LLM guess — the map has to be trustworthy. NEVER writes to GitHub. NEVER
 * returns a secret. Fail-closed: a GitHub/transport failure surfaces to the
 * caller (the route maps it to a 502 and the UI shows "scan failed / retry").
 *
 * Never import from a client component: github.ts reads GITHUB_TOKEN.
 */
import 'server-only'

import { getRepoFile, getRepoTree } from './github'
import type { Project } from './types'

// ---------------------------------------------------------------------------
// Types (the contract the UI + persistence share)
// ---------------------------------------------------------------------------

export interface RepoMap {
  projectId: string
  repo: { owner: string; name: string; branch: string; url?: string; lastCommitSha?: string }
  stack: string[]
  packageManager?: string
  scripts: Record<string, string>
  appRoutes: string[]
  apiRoutes: string[]
  components: string[]
  libModules: string[]
  tests: string[]
  configFiles: string[]
  docs: string[]
  designSystemSignals: string[]
  envSignals: string[]
  riskNotes: string[]
  scannedAt: string
}

export interface AgenticFootprint {
  hasAgenticCode: boolean
  frameworks: string[]
  graphs: string[]
  tools: string[]
  manifests: string[]
  prompts: string[]
  evals: string[]
  runners: string[]
  routes: string[]
  risks: string[]
  residueSignals: string[]
}

type ResidueSeverity = 'low' | 'medium' | 'high'
type ResidueType =
  | 'dead_component'
  | 'dead_route'
  | 'dead_tool'
  | 'old_prompt'
  | 'stale_agentic_code'
  | 'mock_residue'
  | 'provider_residue'
  | 'env_residue'
  | 'unknown'

export interface ResidueFinding {
  severity: ResidueSeverity
  type: ResidueType
  path: string
  evidence: string
  recommendedAction: string
}

type RecommendationPriority = 'high' | 'medium' | 'low'
export interface AgentRecommendation {
  id: string
  title: string
  priority: RecommendationPriority
  why: string
  proposedRole: string
  toolsNeeded: string[]
  testsNeeded: string[]
  risks: string[]
  releaseValue: string
}

export interface RepoIntelligence {
  map: RepoMap
  footprint: AgenticFootprint
  residue: ResidueFinding[]
  recommendations: AgentRecommendation[]
}

// ---------------------------------------------------------------------------
// Budgets — keep the scan bounded (never aspirate the whole repo).
// ---------------------------------------------------------------------------

const MAX_LIST = 60
const READ_BUDGET = 6

const STACK_HINTS: { dep: string; label: string }[] = [
  { dep: 'next', label: 'Next.js' },
  { dep: 'react', label: 'React' },
  { dep: 'typescript', label: 'TypeScript' },
  { dep: 'tailwindcss', label: 'Tailwind CSS' },
  { dep: '@headlessui/react', label: 'Headless UI (Catalyst)' },
  { dep: '@langchain/langgraph', label: 'LangGraph' },
  { dep: '@langchain/core', label: 'LangChain' },
  { dep: 'openai', label: 'OpenAI SDK' },
  { dep: '@anthropic-ai/sdk', label: 'Anthropic SDK' },
  { dep: '@google/generative-ai', label: 'Google Gemini SDK' },
  { dep: 'langsmith', label: 'LangSmith' },
  { dep: '@modelcontextprotocol/sdk', label: 'MCP SDK' },
  { dep: 'zod', label: 'Zod' },
  { dep: 'vitest', label: 'Vitest' },
  { dep: 'electron', label: 'Electron' },
  { dep: '@supabase/supabase-js', label: 'Supabase' },
]

const uniq = <T>(a: T[]): T[] => [...new Set(a)]
const cap = (a: string[]): string[] => uniq(a).slice(0, MAX_LIST)

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/**
 * Produce the full repo intelligence for a project's linked repo. One tree
 * fetch, then a bounded set of key-file reads. Read-only throughout.
 *
 * `ref` may be a branch, tag or commit sha. Passing one (ensureRepoIntelligence
 * passes the HEAD sha it already resolved) pins every fetch to that ref and
 * spares getRepoTree/getRepoFile from re-resolving the default branch.
 */
export async function scanRepoIntelligence(project: Project, ref?: string): Promise<RepoIntelligence> {
  if (!project.repoFullName) {
    throw new Error('project has no linked GitHub repo (repoFullName is empty)')
  }
  const [owner, name] = project.repoFullName.split('/')
  // A commit sha is not a branch name — keep the same 'main' label as the
  // no-ref case so the persisted map shape is unchanged.
  const branch = ref !== undefined && !/^[0-9a-f]{40}$/i.test(ref) ? ref : 'main'

  const tree = await getRepoTree(project.repoFullName, ref)
  const files = tree.filter((e) => e.type === 'blob').map((e) => e.path)
  const has = (re: RegExp) => files.some((p) => re.test(p))
  const all = (re: RegExp) => files.filter((p) => re.test(p))

  // --- Structural classification (no fetch) ---
  const appRoutes = cap(all(/^(?:src\/)?app\/.*\/(?:page|layout)\.tsx$/))
  const apiRoutes = cap(all(/\/api\/.*\/route\.ts$/))
  const components = cap(all(/^(?:src\/)?components\/.+\.tsx$/))
  const libModules = cap(all(/^(?:src\/)?lib\/.+\.ts$/))
  const tests = cap(all(/\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/).concat(all(/^tests?\//)))
  const configFiles = cap(
    files.filter((p) =>
      /^(?:next\.config|tailwind\.config|tsconfig|vitest\.config|postcss\.config|eslint\.config|\.eslintrc)/.test(p) ||
      /^(?:langgraph\.json|docker-compose.*\.ya?ml|Dockerfile)$/.test(p.split('/').pop() ?? '')
    )
  )
  const docs = cap(
    files.filter((p) => /^docs?\//.test(p) || /^(?:README|AGENTS|CLAUDE)(?:\.md)?$/.test(p.split('/').pop() ?? '') || /\.md$/.test(p) === true && /^(?:README|AGENTS|CLAUDE|CONTRIBUTING|CHANGELOG)/.test(p.split('/').pop() ?? ''))
  )

  // --- Design-system signals (path shape) ---
  const dsSignals: string[] = []
  if (has(/components\/catalyst\//)) dsSignals.push('Catalyst primitives (components/ui/)')
  if (has(/tailwind\.config/) || has(/globals\.css$/)) dsSignals.push('Tailwind config / globals.css')
  if (has(/check-catalyst\.mjs$/)) dsSignals.push('Catalyst gate (check-catalyst.mjs)')
  if (has(/check-palette\.mjs$/)) dsSignals.push('Palette/DS gate (check-palette.mjs)')

  // --- Bounded key-file reads ---
  const stack: string[] = []
  let scripts: Record<string, string> = {}
  let packageManager: string | undefined
  const riskNotes: string[] = []
  const deps: Record<string, string> = {}
  let reads = 0

  if (files.includes('package.json') && reads < READ_BUDGET) {
    reads += 1
    try {
      const pkgFile = await getRepoFile(project.repoFullName, 'package.json', ref)
      const pkg = JSON.parse(pkgFile.text) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        scripts?: Record<string, string>
        packageManager?: string
      }
      Object.assign(deps, pkg.dependencies ?? {}, pkg.devDependencies ?? {})
      for (const { dep, label } of STACK_HINTS) if (deps[dep]) stack.push(label)
      scripts = pkg.scripts ?? {}
      if (typeof pkg.packageManager === 'string') packageManager = pkg.packageManager.split('@')[0]
    } catch {
      riskNotes.push('package.json present but could not be parsed')
    }
  } else if (!files.includes('package.json')) {
    riskNotes.push('no package.json at repo root — stack/scripts could not be derived')
  }
  if (!packageManager) {
    if (has(/^package-lock\.json$/)) packageManager = 'npm'
    else if (has(/^pnpm-lock\.yaml$/)) packageManager = 'pnpm'
    else if (has(/^yarn\.lock$/)) packageManager = 'yarn'
    else if (has(/^bun\.lockb$/)) packageManager = 'bun'
  }
  if (has(/^(?:next\.config)\.(?:ts|js|mjs)$/) && !stack.includes('Next.js')) stack.push('Next.js')
  if (has(/tailwind\.config/) && !stack.includes('Tailwind CSS')) stack.push('Tailwind CSS')

  // --- env signals (which env vars the repo references, from a bounded sample) ---
  const envSignals: string[] = []
  const envExample = files.find((p) => /^\.env\.example$/.test(p))
  if (envExample && reads < READ_BUDGET) {
    reads += 1
    try {
      const f = await getRepoFile(project.repoFullName, envExample, ref)
      for (const line of f.text.split('\n')) {
        const m = line.match(/^#?\s*([A-Z][A-Z0-9_]{2,})\s*=/)
        if (m) envSignals.push(m[1])
      }
    } catch {
      /* env sample is best-effort */
    }
  }

  // --- structural risk notes ---
  if (apiRoutes.length > 0 && !has(/proxy\.(?:ts|js)$/) && !has(/middleware\.(?:ts|js)$/)) {
    riskNotes.push('API routes present but no proxy.ts/middleware.ts found — verify auth gating')
  }
  if (tests.length === 0) riskNotes.push('no test files detected')
  if (!scripts.build) riskNotes.push('no "build" script detected in package.json')
  if (has(/(?:^|\/)\.env(?:$|\.)(?!example|sample)/)) {
    riskNotes.push('a real .env file appears tracked in the repo — review for secret exposure')
  }

  const map: RepoMap = {
    projectId: project.id,
    repo: { owner: owner ?? '', name: name ?? project.repoFullName, branch, url: project.repoUrl },
    stack: uniq(stack),
    packageManager,
    scripts,
    appRoutes,
    apiRoutes,
    components,
    libModules,
    tests,
    configFiles,
    docs,
    designSystemSignals: dsSignals,
    envSignals: uniq(envSignals).slice(0, MAX_LIST),
    riskNotes,
    scannedAt: new Date().toISOString(),
  }

  const footprint = detectAgenticFootprint(files, deps)
  const residue = detectResidue(files, deps, { appRoutes, apiRoutes, components, libModules })
  const recommendations = recommendAgents(map, footprint, residue)

  return { map, footprint, residue, recommendations }
}

// ---------------------------------------------------------------------------
// Agentic footprint — is there agent logic here already, and where?
// ---------------------------------------------------------------------------

function detectAgenticFootprint(files: string[], deps: Record<string, string>): AgenticFootprint {
  const has = (re: RegExp) => files.some((p) => re.test(p))
  const all = (re: RegExp) => files.filter((p) => re.test(p))

  const frameworks: string[] = []
  if (deps['@langchain/langgraph'] || has(/langgraph/i)) frameworks.push('LangGraph')
  if (deps['@langchain/core'] || deps['langchain']) frameworks.push('LangChain')
  if (deps['langsmith'] || has(/langsmith/i)) frameworks.push('LangSmith')
  if (deps['openai']) frameworks.push('OpenAI SDK')
  if (deps['@modelcontextprotocol/sdk'] || has(/\bmcp\b/i)) frameworks.push('MCP')
  if (deps['@anthropic-ai/sdk']) frameworks.push('Anthropic SDK')

  const graphs = cap(all(/(?:graph|langgraph)[^/]*\.(?:mjs|ts)$/i).filter((p) => !/node_modules/.test(p)))
  const tools = cap(all(/tool[-_]?registry|tools?\.(?:ts|mjs)$|tool-handlers/i))
  const manifests = cap(all(/manifest/i))
  const prompts = cap(all(/prompt/i))
  const evals = cap(all(/eval|judge|benchmark/i))
  const runners = cap(all(/runner|orchestrat|workflow/i))
  const routes = cap(all(/\/api\/.*(?:agent|copilot|architect|langgraph|builder).*\/route\.ts$/i))

  const risks: string[] = []
  const residueSignals: string[] = []
  if (frameworks.includes('Anthropic SDK')) {
    risks.push('Anthropic SDK present — if this repo is meant to be OpenAI-primary, that is a provider residue')
    residueSignals.push('@anthropic-ai/sdk dependency')
  }
  if (deps['@google/generative-ai']) {
    risks.push('Google Gemini SDK present — provider residue if OpenAI-primary')
    residueSignals.push('@google/generative-ai dependency')
  }
  if (graphs.length > 0 && manifests.length === 0) {
    risks.push('graph code present but no manifest — the agent contract may be implicit/undocumented')
  }

  const hasAgenticCode =
    frameworks.length > 0 || graphs.length > 0 || tools.length > 0 || manifests.length > 0 || routes.length > 0

  return {
    hasAgenticCode,
    frameworks: uniq(frameworks),
    graphs,
    tools,
    manifests,
    prompts,
    evals,
    runners,
    routes,
    risks,
    residueSignals,
  }
}

// ---------------------------------------------------------------------------
// Residue / dead-code detection — SIGNAL ONLY. Never removes, never fixes.
// ---------------------------------------------------------------------------

function detectResidue(
  files: string[],
  deps: Record<string, string>,
  // Reserved for a future import-graph pass (dead-component/route detection needs
  // reading import statements, out of budget for this structural scan). Prefixed
  // so the structural residue rules below don't falsely flag live modules.
  _classified: { appRoutes: string[]; apiRoutes: string[]; components: string[]; libModules: string[] }
): ResidueFinding[] {
  const findings: ResidueFinding[] = []
  const has = (re: RegExp) => files.some((p) => re.test(p))

  // Provider residue: multi-provider SDKs when the doctrine is OpenAI-primary.
  if (deps['@anthropic-ai/sdk']) {
    findings.push({
      severity: 'medium',
      type: 'provider_residue',
      path: 'package.json',
      evidence: '@anthropic-ai/sdk is a dependency',
      recommendedAction: 'Confirm intended; if OpenAI-primary, remove the Anthropic SDK and any code path using it.',
    })
  }
  if (deps['@google/generative-ai']) {
    findings.push({
      severity: 'medium',
      type: 'provider_residue',
      path: 'package.json',
      evidence: '@google/generative-ai is a dependency',
      recommendedAction: 'Confirm intended; if OpenAI-primary, remove the Gemini SDK and its call sites.',
    })
  }

  // Mock / seed residue tracked in the repo.
  for (const p of files.filter((p) => /(?:^|\/)(?:mock|seed|fixture)s?[-_./]/i.test(p) || /\.(?:mock|seed|fixtures)\./i.test(p))) {
    findings.push({
      severity: 'low',
      type: 'mock_residue',
      path: p,
      evidence: 'file name suggests a mock/seed/fixture',
      recommendedAction: 'Verify it is used by tests only and not shipped in the app path.',
    })
  }

  // Old-prompt residue: versioned/backup prompt files.
  for (const p of files.filter((p) => /prompt/i.test(p) && /(?:[-_.](?:old|v\d+|bak|backup|legacy|deprecated))\b/i.test(p))) {
    findings.push({
      severity: 'low',
      type: 'old_prompt',
      path: p,
      evidence: 'prompt file name carries an old/backup/version marker',
      recommendedAction: 'Confirm which prompt is live; delete the superseded copy (git keeps history).',
    })
  }

  // Backup / legacy source files left in tree.
  for (const p of files.filter((p) => /\.(?:bak|old|orig|backup)$/i.test(p) || /(?:[-_.](?:copy|legacy|deprecated|unused))\.(?:ts|tsx|js|mjs)$/i.test(p))) {
    findings.push({
      severity: has(/\.gitignore$/) ? 'low' : 'medium',
      type: 'stale_agentic_code',
      path: p,
      evidence: 'file name carries a backup/legacy/unused marker',
      recommendedAction: 'Review and remove if superseded — git history preserves it.',
    })
  }

  // env residue: bounded — flag an .env.example key set that is unusually large
  // is out of scope for a structural scan; we only flag a tracked real .env.
  if (has(/(?:^|\/)\.env(?:$|\.local|\.production)$/)) {
    findings.push({
      severity: 'high',
      type: 'env_residue',
      path: files.find((p) => /(?:^|\/)\.env(?:$|\.local|\.production)$/.test(p)) ?? '.env',
      evidence: 'a real .env file is tracked in the repo',
      recommendedAction: 'Remove it from the repo and rotate anything it exposed; keep only .env.example.',
    })
  }

  return findings.slice(0, MAX_LIST)
}

// ---------------------------------------------------------------------------
// Agent recommendations — 3–7 useful agents FOR THIS repo, not generic spam.
// ---------------------------------------------------------------------------

function recommendAgents(map: RepoMap, footprint: AgenticFootprint, residue: ResidueFinding[]): AgentRecommendation[] {
  const recs: AgentRecommendation[] = []
  const readOnly = ['read_repo_file', 'list_repo_tree', 'search_repo']

  // QA & Release — justified when there's a test script or CI gate.
  if (map.scripts.test || map.scripts.verify || map.scripts.check || map.tests.length > 0) {
    recs.push({
      id: 'qa-release',
      title: 'QA & Release Copilot',
      priority: 'high',
      why: `Repo has a test/verify gate (${['test', 'verify', 'check'].filter((s) => map.scripts[s]).join(', ') || `${map.tests.length} test files`}); an agent can triage failures and gate releases.`,
      proposedRole: 'Read the latest test/benchmark signals, summarize failures, and produce a release-readiness verdict.',
      toolsNeeded: readOnly,
      testsNeeded: ['flags a failing gate as not-releasable', 'summarizes a passing run as releasable'],
      risks: ['must never approve a release itself — read-only, human-gated'],
      releaseValue: 'Faster, evidence-based go/no-go on every candidate version.',
    })
  }

  // Security Sentinel — justified when there are API routes / auth / env.
  if (map.apiRoutes.length > 0 || map.envSignals.length > 0) {
    recs.push({
      id: 'security-sentinel',
      title: 'Security Sentinel',
      priority: 'high',
      why: `${map.apiRoutes.length} API route(s) and ${map.envSignals.length} referenced env var(s) — surface a real auth/secret/route attack surface to review.`,
      proposedRole: 'Read-only review for exposed secrets, missing auth gates, unsafe routes and fail-open behaviour.',
      toolsNeeded: readOnly,
      testsNeeded: ['flags an ungated mutating route', 'never reveals a secret value'],
      risks: ['must stay read-only; never quotes secret values'],
      releaseValue: 'Catches auth/secret regressions before they ship.',
    })
  }

  // Design System Guardian — justified by DS signals.
  if (map.designSystemSignals.length > 0) {
    recs.push({
      id: 'design-system-guardian',
      title: 'Design System Guardian',
      priority: map.designSystemSignals.some((s) => /gate/i.test(s)) ? 'medium' : 'high',
      why: `Design-system signals present (${map.designSystemSignals.join('; ')}) — an agent can flag off-system UI (native controls, hardcoded colours, oversized components).`,
      proposedRole: 'Read components and flag deviations from the design system: native controls, hardcoded hex, off-scale spacing, oversized cards/buttons.',
      toolsNeeded: readOnly,
      testsNeeded: ['flags a native <button> in the dashboard path', 'flags a hardcoded hex colour'],
      risks: ['advisory only — proposes fixes, never edits'],
      releaseValue: 'Keeps the UI consistent as the surface grows.',
    })
  }

  // Repo Inspector / Cleanup — justified when residue exists.
  if (residue.length > 0) {
    recs.push({
      id: 'repo-cleanup',
      title: 'Repo Cleanup Copilot',
      priority: residue.some((r) => r.severity === 'high') ? 'high' : 'medium',
      why: `${residue.length} residue signal(s) detected (${uniq(residue.map((r) => r.type)).join(', ')}) — an agent can track dead code, stale prompts and provider residue.`,
      proposedRole: 'Read-only sweep for dead components/routes/tools, stale agentic code and provider residue; report, never delete.',
      toolsNeeded: readOnly,
      testsNeeded: ['identifies a tracked backup file', 'does not propose deleting a live module'],
      risks: ['must never delete — signal only'],
      releaseValue: 'Keeps the codebase lean and the agent surface trustworthy.',
    })
  }

  // API Contract Sentinel — justified by a meaningful API surface.
  if (map.apiRoutes.length >= 5) {
    recs.push({
      id: 'api-contract-sentinel',
      title: 'API Contract Sentinel',
      priority: 'medium',
      why: `${map.apiRoutes.length} API routes — an agent can watch for input-validation gaps and contract drift.`,
      proposedRole: 'Read API route handlers and flag missing input validation, unparameterized queries and inconsistent error shapes.',
      toolsNeeded: readOnly,
      testsNeeded: ['flags a route casting req.json() as T without validation', 'flags a route returning raw error detail'],
      risks: ['read-only; advisory'],
      releaseValue: 'Hardens the backend contract as routes multiply.',
    })
  }

  // LangGraph Runtime Watcher — justified when the repo runs LangGraph.
  if (footprint.frameworks.includes('LangGraph') || footprint.graphs.length > 0) {
    recs.push({
      id: 'langgraph-runtime-watcher',
      title: 'LangGraph Runtime Watcher',
      priority: 'medium',
      why: `LangGraph footprint present (${footprint.graphs.length} graph file(s)) — an agent can watch for recursion/no-progress loops and missing stop conditions.`,
      proposedRole: 'Read graph runtime + traces and flag recursion risk, missing terminal conditions and unbounded loops.',
      toolsNeeded: readOnly,
      testsNeeded: ['flags a graph node lacking a budget guard', 'flags an unbounded agent→tools loop'],
      risks: ['read-only; advisory'],
      releaseValue: 'Prevents GraphRecursionError-class runtime failures.',
    })
  }

  // Docs/Spec Keeper — justified when docs exist alongside code.
  if (map.docs.length > 0) {
    recs.push({
      id: 'docs-spec-keeper',
      title: 'Docs / Spec Keeper',
      priority: 'low',
      why: `${map.docs.length} doc file(s) — an agent can flag docs that drifted from the code (routes, scripts, env).`,
      proposedRole: 'Read docs + code and flag divergence: documented routes/scripts/env that no longer match reality.',
      toolsNeeded: readOnly,
      testsNeeded: ['flags a documented script that no longer exists', 'flags an undocumented new route'],
      risks: ['read-only; advisory'],
      releaseValue: 'Keeps AGENTS.md / README a true mirror of the code.',
    })
  }

  // Cap to 7, keep the highest-priority first (stable order: high → medium → low).
  const order: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 }
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 7)
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/** A cached intelligence older than this is stale and should be re-scanned. */
const INTELLIGENCE_TTL_MS = 24 * 60 * 60 * 1000

export type StalenessReason = 'missing' | 'age' | 'commit-changed' | 'fresh'

/**
 * Decide whether a project's cached intelligence needs a re-scan. Pure so it's
 * trivially testable. `currentSha` (if the caller resolved the repo HEAD) makes
 * a commit change trigger staleness even inside the TTL window.
 */
export function intelligenceStaleness(
  scannedAt: string | null,
  cachedSha: string | null,
  currentSha: string | null,
  nowMs: number
): { stale: boolean; reason: StalenessReason } {
  if (!scannedAt) return { stale: true, reason: 'missing' }
  if (currentSha && cachedSha && currentSha !== cachedSha) return { stale: true, reason: 'commit-changed' }
  const scannedMs = Date.parse(scannedAt)
  if (!Number.isFinite(scannedMs) || nowMs - scannedMs > INTELLIGENCE_TTL_MS) return { stale: true, reason: 'age' }
  return { stale: false, reason: 'fresh' }
}
