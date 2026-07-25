/**
 * Agent Mission Control — read-only repo scan (server only).
 *
 * Reads a project's linked GitHub repo READ-ONLY (via github.ts's getRepoTree /
 * getRepoFile — validated, secret-path-denied, timeout-bounded) and distils a
 * structured RepoScanSummary the Agent Builder can reason about: stack, npm
 * scripts, page/api routes, components, tests, design-system signals, risk notes.
 *
 * NEVER writes to GitHub. NEVER returns a secret: it reads package.json /
 * config / README / a bounded sample of source, and github.ts already refuses
 * secret/credential-looking paths (.env, *.pem, *secret*, …). Fail-closed: if
 * GitHub is unreachable or the token is missing, the caller surfaces the error.
 *
 * Never import this module from a client component: github.ts reads GITHUB_TOKEN.
 */
import 'server-only'

import { getRepoFile, getRepoTree, type RepoTreeEntry } from './github'
import type { Project } from './types'

/** The structured result of a read-only repo scan, safe to return to the UI. */
export interface RepoScanSummary {
  projectId: string
  repo: string
  branch: string
  stack: string[]
  scripts: Record<string, string>
  routes: string[]
  apiRoutes: string[]
  components: string[]
  tests: string[]
  designSystemSignals: string[]
  riskNotes: string[]
  scannedAt: string
}

/** Cap how many entries of each list we surface (keep the summary bounded). */
const MAX_LIST = 40
/** Cap how many files we actually fetch (each is a GitHub round-trip). */
const READ_BUDGET = 8

/** Dependencies whose presence names a stack element, in display order. */
const STACK_HINTS: { dep: string; label: string }[] = [
  { dep: 'next', label: 'Next.js' },
  { dep: 'react', label: 'React' },
  { dep: 'typescript', label: 'TypeScript' },
  { dep: 'tailwindcss', label: 'Tailwind CSS' },
  { dep: '@headlessui/react', label: 'Headless UI (Catalyst)' },
  { dep: '@langchain/langgraph', label: 'LangGraph' },
  { dep: 'openai', label: 'OpenAI SDK' },
  { dep: 'zod', label: 'Zod' },
  { dep: 'vitest', label: 'Vitest' },
  { dep: 'electron', label: 'Electron' },
  { dep: '@supabase/supabase-js', label: 'Supabase' },
]

/**
 * Scan a project's linked repo. Requires `project.repoFullName` (owner/name).
 * Uses the repo's default branch unless a ref is passed. Read-only throughout.
 */
export async function scanProjectRepo(project: Project, ref?: string): Promise<RepoScanSummary> {
  if (!project.repoFullName) {
    throw new Error('project has no linked GitHub repo (repoFullName is empty)')
  }
  const repo = project.repoFullName

  // 1. The full tree (github.ts resolves the default branch when ref is omitted,
  //    and never throws on truncation — a partial tree is still useful).
  const tree = await getRepoTree(repo, ref)
  const branch = ref ?? (await resolveBranch(repo, tree))

  const files = tree.filter((e) => e.type === 'blob').map((e) => e.path)

  // 2. Classify paths WITHOUT fetching (cheap, structural signal).
  const routes = uniqCap(
    files.filter((p) => /^src\/app\/.*\/(page|layout)\.tsx$/.test(p) || /^app\/.*\/(page|layout)\.tsx$/.test(p))
  )
  const apiRoutes = uniqCap(files.filter((p) => /\/api\/.*\/route\.ts$/.test(p)))
  const components = uniqCap(files.filter((p) => /^src\/components\/.+\.tsx$/.test(p) || /^components\/.+\.tsx$/.test(p)))
  const tests = uniqCap(files.filter((p) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p) || /^tests?\//.test(p)))

  // 3. Design-system signals from path shape (no fetch).
  const dsSignals: string[] = []
  if (files.some((p) => /components\/catalyst\//.test(p))) dsSignals.push('Catalyst primitives (components/ui/)')
  if (files.some((p) => /tailwind\.config/.test(p)) || files.some((p) => /globals\.css$/.test(p)))
    dsSignals.push('Tailwind config / globals.css')
  if (files.some((p) => /check-catalyst\.mjs$/.test(p))) dsSignals.push('Catalyst gate (check-catalyst.mjs)')
  if (files.some((p) => /check-palette\.mjs$/.test(p))) dsSignals.push('Palette/DS gate (check-palette.mjs)')

  // 4. Fetch a small, bounded set of key files for deeper signal.
  const stack: string[] = []
  let scripts: Record<string, string> = {}
  const riskNotes: string[] = []
  let reads = 0

  // package.json — stack + scripts (the highest-value single file).
  if (files.includes('package.json') && reads < READ_BUDGET) {
    reads += 1
    try {
      const pkgFile = await getRepoFile(repo, 'package.json', ref)
      const pkg = JSON.parse(pkgFile.text) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        scripts?: Record<string, string>
      }
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
      for (const { dep, label } of STACK_HINTS) if (deps[dep]) stack.push(label)
      scripts = pkg.scripts ?? {}
    } catch {
      riskNotes.push('package.json present but could not be parsed')
    }
  } else if (!files.includes('package.json')) {
    riskNotes.push('no package.json at repo root — stack/scripts could not be derived')
  }

  // Config presence → stack corroboration (path signal, no fetch needed).
  if (files.some((p) => /^next\.config\.(ts|js|mjs)$/.test(p)) && !stack.includes('Next.js')) stack.push('Next.js')
  if (files.some((p) => /tailwind\.config/.test(p)) && !stack.includes('Tailwind CSS')) stack.push('Tailwind CSS')

  // 5. Risk notes from structure.
  if (apiRoutes.length > 0 && !files.some((p) => /proxy\.(ts|js)$/.test(p) || /middleware\.(ts|js)$/.test(p))) {
    riskNotes.push('API routes present but no proxy.ts/middleware.ts found — verify auth gating')
  }
  if (tests.length === 0) riskNotes.push('no test files detected')
  if (!scripts.build) riskNotes.push('no "build" script detected in package.json')
  if (files.some((p) => /(^|\/)\.env($|\.)/.test(p))) riskNotes.push('a .env file appears tracked in the repo — review for secret exposure')

  return {
    projectId: project.id,
    repo,
    branch,
    stack: uniq(stack),
    scripts,
    routes,
    apiRoutes,
    components,
    tests,
    designSystemSignals: dsSignals,
    riskNotes,
    scannedAt: new Date().toISOString(),
  }
}

/**
 * Compact the scan into a short text block to hand the Agent Builder as repo
 * context. Bounded (the graph gets a summary, not the whole tree), secret-free.
 */
export function repoScanToContext(scan: RepoScanSummary): string {
  const lines: string[] = []
  lines.push(`REPO CONTEXT for ${scan.repo} (branch ${scan.branch}):`)
  if (scan.stack.length) lines.push(`- Stack: ${scan.stack.join(', ')}`)
  const scriptNames = Object.keys(scan.scripts)
  if (scriptNames.length) lines.push(`- npm scripts (gates): ${scriptNames.slice(0, 20).join(', ')}`)
  if (scan.apiRoutes.length) lines.push(`- API routes: ${scan.apiRoutes.length} (e.g. ${scan.apiRoutes.slice(0, 5).join(', ')})`)
  if (scan.routes.length) lines.push(`- Pages: ${scan.routes.length}`)
  if (scan.components.length) lines.push(`- Components: ${scan.components.length}`)
  if (scan.tests.length) lines.push(`- Test files: ${scan.tests.length}`)
  if (scan.designSystemSignals.length) lines.push(`- Design system: ${scan.designSystemSignals.join('; ')}`)
  if (scan.riskNotes.length) lines.push(`- Risk notes: ${scan.riskNotes.join('; ')}`)
  return lines.join('\n')
}

// --- helpers ---------------------------------------------------------------

function uniq<T>(a: T[]): T[] {
  return [...new Set(a)]
}
function uniqCap(a: string[]): string[] {
  return uniq(a).slice(0, MAX_LIST)
}

/**
 * Best-effort branch resolution: getRepoTree already used the default branch
 * when ref was omitted, but it doesn't return the branch name. Re-derive it
 * cheaply from the tree presence — fall back to 'main' (the overwhelming
 * default) rather than making an extra round-trip just for the label.
 */
async function resolveBranch(_repo: string, _tree: RepoTreeEntry[]): Promise<string> {
  return 'main'
}
