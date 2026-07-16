/**
 * Agent Mission Control — repo-fit score (PURE, no I/O, no secrets).
 *
 * Prompt 45 grounded suite GENERATION in the repo (the prompt asks the LLM not
 * to invent routes/scripts). This module closes the loop on the OUTPUT: it
 * validates the generated test cases SEMANTICALLY against the scanned RepoMap
 * and produces a first, transparent `repoFitScore` — "how well is this agent's
 * suite actually anchored in THIS repo?".
 *
 * It answers, deterministically and explainably (never an LLM guess):
 *   1. is the suite repo_aware or manifest_only?
 *   2. do the scripts the cases cite exist in RepoMap.scripts?
 *   3. do the routes the cases cite exist in RepoMap.appRoutes/apiRoutes?
 *   4. are the repo's DS / env / risk signals actually covered by a case?
 *   5. are the agent's tools compatible with a repo-inspection role?
 *
 * PURE by design: no `server-only`, no PostgREST, no GitHub, no env — unit
 * testable and credential-safe. NOT a gate: this score is display/metadata for
 * now (never blocks a promotion).
 */

import type { RepoMap } from './repo-intelligence'
import type { SuiteSource } from './repo-suite-context'

export type RepoFitLevel = 'none' | 'weak' | 'partial' | 'strong'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip'

export interface RepoFitCheck {
  id: string
  label: string
  status: CheckStatus
  evidence?: string
}

export interface RepoFitResult {
  score: number
  level: RepoFitLevel
  suiteSource: SuiteSource
  checks: RepoFitCheck[]
  missingCoverage: string[]
  hallucinationWarnings: string[]
}

/** A generated case, reduced to the text we scan (matches NewTestCaseInput). */
export interface RepoFitCase {
  name: string
  input: string
  expectedBehavior: string
  expectedToolCalls: string[]
  tags: string[]
}

export interface RepoFitInput {
  suiteSource: SuiteSource
  cases: RepoFitCase[]
  /** Tools mounted on the agent (names). */
  toolNames: string[]
  /** The scanned repo map (or null for manifest-only / no repo). */
  repoMap: RepoMap | null
  /** Residue findings count from the intelligence bundle (risk coverage signal). */
  residueCount?: number
  /** Agent role/mission text — used only to detect a repo-inspection intent. */
  roleText?: string
}

// ---------------------------------------------------------------------------
// Text helpers — everything is scanned case-insensitively over the joined text.
// ---------------------------------------------------------------------------

function caseText(c: RepoFitCase): string {
  return `${c.name}\n${c.input}\n${c.expectedBehavior}\n${c.tags.join(' ')}`.toLowerCase()
}

function allCasesText(cases: RepoFitCase[]): string {
  return cases.map(caseText).join('\n')
}

/** npm script names cited in a case, e.g. "npm run check:ds" / "run verify" / "`build`". */
const SCRIPT_CITATION_RE = /\b(?:npm run|pnpm|yarn|run)\s+([a-z][a-z0-9:_-]*)/gi

function citedScripts(text: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(SCRIPT_CITATION_RE)
  while ((m = re.exec(text)) !== null) out.add(m[1].toLowerCase())
  return [...out]
}

/** Route paths cited in a case: /api/... or /admin/... (URL-style tokens). */
const ROUTE_CITATION_RE = /(\/(?:api|admin)\/[a-z0-9/_[\]-]*)/gi

function citedRoutes(text: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  const re = new RegExp(ROUTE_CITATION_RE)
  while ((m = re.exec(text)) !== null) {
    // Trim a trailing slash/punctuation so "/api/foo." matches "/api/foo".
    out.add(m[1].replace(/[.,;:)\]]+$/, '').replace(/\/+$/, '').toLowerCase())
  }
  return [...out]
}

/**
 * Turn a RepoMap route entry (a FILE PATH like
 * "src/app/api/agent-ops/copilots/route.ts") into the URL prefix it serves
 * ("/api/agent-ops/copilots"), so a cited URL can be checked against it. Also
 * handles already-URL-shaped entries. Returns null when nothing URL-like.
 */
export function routeFilePathToUrl(entry: string): string | null {
  const lower = entry.toLowerCase()
  // Already a URL.
  if (lower.startsWith('/api/') || lower.startsWith('/admin/')) {
    return lower.replace(/\/(?:route|page|layout)\.tsx?$/, '').replace(/\/+$/, '') || null
  }
  // File path → strip up to app/, drop the /route.tsx|/page.tsx|/layout.tsx tail.
  const appIdx = lower.search(/(?:^|\/)app\//)
  if (appIdx === -1) return null
  let url = lower.slice(appIdx).replace(/^.*?app\//, '/')
  url = url.replace(/\/(?:route|page|layout)\.tsx?$/, '')
  // Route groups "(site)" are not part of the URL.
  url = url.replace(/\/\([^)]+\)/g, '')
  return url.replace(/\/+$/, '') || null
}

function knownRouteUrls(repoMap: RepoMap): string[] {
  const urls = new Set<string>()
  for (const entry of [...repoMap.apiRoutes, ...repoMap.appRoutes]) {
    const url = routeFilePathToUrl(entry)
    if (url) urls.add(url)
  }
  return [...urls]
}

/** A cited route is "known" if it equals or is a prefix-path of a real route. */
function routeIsKnown(cited: string, known: string[]): boolean {
  return known.some((k) => k === cited || k.startsWith(cited + '/') || cited.startsWith(k + '/'))
}

// Coverage keyword sets — a signal is "covered" if any case text hits one.
const DS_KEYWORDS = ['design system', 'design-system', 'catalyst', 'check:ds', 'check:catalyst', 'tokens', 'palette', 'accent color', 'ds gate']
const SECRET_KEYWORDS = ['secret', 'process.env', 'api key', 'api_key', 'service role', 'service_role', 'credential', 'token', 'redact', 'leak']
const RISK_KEYWORDS = ['review before delete', 'do not auto-delete', 'not auto-delete', "don't delete", 'flag', 'residue', 'dead code', 'evidence', 'recommend review', 'risk']

function anyCaseHits(text: string, keywords: string[]): string | null {
  for (const k of keywords) if (text.includes(k)) return k
  return null
}

const REPO_INSPECTION_HINT = /(inspect|analy|scan|read|review|audit|repo|codebase|architecture|files?)/i
const REPO_READ_TOOLS = ['read_repo_file', 'search_repo', 'list_repo_tree']
const WRITE_TOOL_HINT = /(write|delete|push|create|modify|commit|deploy|promote)/i

const LEVEL_FOR = (score: number): RepoFitLevel =>
  score >= 70 ? 'strong' : score >= 40 ? 'partial' : score >= 20 ? 'weak' : 'none'

/**
 * Compute the repo-fit result. Transparent additive scoring (max 100):
 *   +20 suiteSource repo_aware
 *   +20 scripts: all cited scripts real (or none cited)
 *   +20 routes: all cited routes real (or none cited)
 *   +15 coverage: DS / env / risk signals present are each covered
 *   +15 tool fit: inspection role has read tools, no unexpected write tool
 *   +10 no hallucination warnings
 * Never throws; a null/empty repoMap yields the manifest-only baseline.
 */
export function computeRepoFit(input: RepoFitInput): RepoFitResult {
  const checks: RepoFitCheck[] = []
  const missingCoverage: string[] = []
  const hallucinationWarnings: string[] = []
  let score = 0

  const text = allCasesText(input.cases)
  const repoAware = input.suiteSource === 'repo_aware' && input.repoMap !== null

  // 1. Suite source (+20)
  if (repoAware) {
    score += 20
    checks.push({ id: 'suite-source', label: 'Suite is repo-aware', status: 'pass', evidence: 'repo intelligence grounded the cases' })
  } else {
    checks.push({ id: 'suite-source', label: 'Suite is repo-aware', status: 'fail', evidence: 'manifest-only — no repo grounding' })
  }

  const map = input.repoMap

  // 2. Scripts (+20) — every cited script must be a real repo script.
  const cited = citedScripts(text)
  if (!repoAware || !map) {
    checks.push({ id: 'scripts', label: 'Cited scripts exist', status: 'skip', evidence: 'no repo to validate against' })
  } else {
    const known = new Set(Object.keys(map.scripts ?? {}).map((s) => s.toLowerCase()))
    const absent = cited.filter((s) => !known.has(s))
    if (cited.length === 0) {
      score += 20
      checks.push({ id: 'scripts', label: 'Cited scripts exist', status: 'pass', evidence: 'no script cited' })
    } else if (absent.length === 0) {
      score += 20
      checks.push({ id: 'scripts', label: 'Cited scripts exist', status: 'pass', evidence: `all real: ${cited.join(', ')}` })
    } else {
      absent.forEach((s) => hallucinationWarnings.push(`script_absent:${s}`))
      checks.push({ id: 'scripts', label: 'Cited scripts exist', status: 'fail', evidence: `absent from repo: ${absent.join(', ')}` })
    }
  }

  // 3. Routes (+20) — every cited /api|/admin route must exist.
  const routes = citedRoutes(text)
  if (!repoAware || !map) {
    checks.push({ id: 'routes', label: 'Cited routes exist', status: 'skip', evidence: 'no repo to validate against' })
  } else {
    const known = knownRouteUrls(map)
    const absent = routes.filter((r) => !routeIsKnown(r, known))
    if (routes.length === 0) {
      score += 20
      checks.push({ id: 'routes', label: 'Cited routes exist', status: 'pass', evidence: 'no route cited' })
    } else if (absent.length === 0) {
      score += 20
      checks.push({ id: 'routes', label: 'Cited routes exist', status: 'pass', evidence: `all real: ${routes.join(', ')}` })
    } else {
      absent.forEach((r) => hallucinationWarnings.push(`route_absent:${r}`))
      checks.push({ id: 'routes', label: 'Cited routes exist', status: 'fail', evidence: `absent from repo: ${absent.join(', ')}` })
    }
  }

  // 4. Coverage (+15) — DS / env / risk signals present must each be covered.
  if (!repoAware || !map) {
    checks.push({ id: 'coverage', label: 'Repo signals covered', status: 'skip', evidence: 'no repo signals' })
  } else {
    const expected: { key: string; present: boolean; hit: string | null }[] = [
      { key: 'design_system', present: (map.designSystemSignals ?? []).length > 0, hit: anyCaseHits(text, DS_KEYWORDS) },
      { key: 'secrets', present: (map.envSignals ?? []).length > 0, hit: anyCaseHits(text, SECRET_KEYWORDS) },
      {
        key: 'repo_risks',
        present: (map.riskNotes ?? []).length > 0 || (input.residueCount ?? 0) > 0,
        hit: anyCaseHits(text, RISK_KEYWORDS),
      },
    ]
    const relevant = expected.filter((e) => e.present)
    const covered = relevant.filter((e) => e.hit !== null)
    relevant.filter((e) => e.hit === null).forEach((e) => missingCoverage.push(e.key))
    if (relevant.length === 0) {
      score += 15 // no signal to cover → full credit
      checks.push({ id: 'coverage', label: 'Repo signals covered', status: 'pass', evidence: 'no DS/env/risk signal in repo' })
    } else {
      score += Math.round((covered.length / relevant.length) * 15)
      checks.push({
        id: 'coverage',
        label: 'Repo signals covered',
        status: covered.length === relevant.length ? 'pass' : covered.length === 0 ? 'fail' : 'warn',
        evidence: `${covered.length}/${relevant.length} covered${missingCoverage.length ? ` — missing: ${relevant.filter((e) => e.hit === null).map((e) => e.key).join(', ')}` : ''}`,
      })
    }
  }

  // 5. Tool fit (+15) — an inspection role needs read tools; no stray write tool.
  const tools = input.toolNames.map((t) => t.toLowerCase())
  const claimsInspection = REPO_INSPECTION_HINT.test(`${input.roleText ?? ''} ${input.cases.map((c) => c.name).join(' ')}`)
  const hasReadTool = tools.some((t) => REPO_READ_TOOLS.includes(t))
  const writeTools = tools.filter((t) => WRITE_TOOL_HINT.test(t))
  if (claimsInspection && !hasReadTool) {
    checks.push({ id: 'tool-fit', label: 'Tools fit the repo role', status: 'fail', evidence: 'inspection role but no repo-read tool mounted' })
  } else if (writeTools.length > 0) {
    score += 8
    checks.push({ id: 'tool-fit', label: 'Tools fit the repo role', status: 'warn', evidence: `write-capable tool(s) on a read-only doctrine: ${writeTools.join(', ')}` })
  } else {
    score += 15
    checks.push({
      id: 'tool-fit',
      label: 'Tools fit the repo role',
      status: 'pass',
      evidence: hasReadTool ? `repo-read tools present: ${tools.filter((t) => REPO_READ_TOOLS.includes(t)).join(', ')}` : 'read-only, no write tool',
    })
  }

  // 6. No hallucination (+10)
  if (hallucinationWarnings.length === 0) {
    score += 10
    checks.push({ id: 'no-hallucination', label: 'No invented routes/scripts', status: 'pass' })
  } else {
    checks.push({ id: 'no-hallucination', label: 'No invented routes/scripts', status: 'fail', evidence: hallucinationWarnings.join(', ') })
  }

  score = Math.max(0, Math.min(100, score))
  return {
    score,
    level: LEVEL_FOR(score),
    suiteSource: input.suiteSource,
    checks,
    missingCoverage,
    hallucinationWarnings,
  }
}
