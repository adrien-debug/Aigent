/**
 * Agent Mission Control — Target Repo Sandbox collector (server only).
 *
 * The READ-ONLY I/O half of the sandbox evaluation. Resolves the copilot →
 * project → linked GitHub repo, READS the delivered `agents/<slug>/…` artifacts
 * + the target repo's `package.json` scripts via the existing github.ts helpers
 * (GitHub Contents API — no clone, no network git, no write), then hands the
 * already-read text to the PURE `evaluateSandbox`.
 *
 * Strictly read-only: never clones with write access, never commits, never
 * pushes, never touches the target repo's branches. If GitHub is unreachable or
 * the agent was never pushed, the report says so honestly (a blocker), it does
 * not fabricate. Never import from a client component (reads GITHUB_TOKEN).
 */
import 'server-only'

import { getCopilot, getProject } from './data'
import { getRepoFile, getRepoHeadSha } from './github'
import { getDeliveryScorecard } from './delivery-scorecard-server'
import { runTargetRepoSandbox } from './target-repo-sandbox-runner'
import {
  evaluateSandbox,
  type SandboxExecutionMode,
  type SandboxInstallMode,
  type TargetRepoSandboxReport,
} from './target-repo-sandbox'

/** Read a repo file, returning null when it does not exist (404) instead of throwing. */
async function readOrNull(repo: string, path: string, ref?: string): Promise<string | null> {
  try {
    const file = await getRepoFile(repo, path, ref)
    return file.text
  } catch {
    return null
  }
}

/** Extract the `scripts` map from a package.json blob; null when absent/unparseable. */
function parsePackageScripts(pkgText: string | null): Record<string, string> | null {
  if (pkgText === null) return null
  try {
    const pkg = JSON.parse(pkgText) as { scripts?: Record<string, string> }
    return pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  } catch {
    return null
  }
}

export interface SandboxCollectOptions {
  /** Deterministic ids/timestamps supplied by the caller (route) — module stays pure of Date/random. */
  runId: string
  createdAt: string
  /** dry_run (default, no execution) or execute (clone + run scripts). */
  mode?: SandboxExecutionMode
  /** In execute mode: skip (default) or auto (install deps per lockfile). */
  installMode?: SandboxInstallMode
  /** Keep the disposable clone for debug (default false). */
  keepSandbox?: boolean
  /** Override the branch to read/clone (e.g. a PR delivery branch). Default: main. */
  targetBranch?: string
}

/**
 * A TargetRepoSandboxReport plus resolution context the collector already paid
 * for. Purely additive over the report — callers that only want the report can
 * keep treating the value as a `TargetRepoSandboxReport`.
 */
export interface CollectedTargetRepoSandbox extends TargetRepoSandboxReport {
  /** The copilot's project id resolved during collection — spares callers a second `getCopilot`. */
  projectId: string | null
}

/**
 * Collect + evaluate a target-repo sandbox report for a copilot. Read-only.
 * `null` only when the copilot is not found. When the copilot has no linked
 * project repo, or the agent was never pushed, the returned report carries the
 * appropriate blocker rather than throwing.
 */
export async function collectTargetRepoSandbox(
  copilotId: string,
  opts: SandboxCollectOptions
): Promise<CollectedTargetRepoSandbox | null> {
  const copilot = await getCopilot(copilotId)
  if (!copilot) return null

  const slug = copilot.slug
  const project = copilot.projectId ? await getProject(copilot.projectId) : undefined
  const repo = project?.repoFullName ?? null

  // Aigent-side repo-fit (control-plane score) for cross-reference in the report.
  let repoFitScore: number | null = null
  try {
    const card = await getDeliveryScorecard(copilotId)
    repoFitScore = card?.evidence.repoFit?.score ?? null
  } catch {
    repoFitScore = null
  }

  // No linked repo → the agent cannot have been delivered anywhere. Honest
  // failed report (evaluateSandbox raises agent_not_pushed_to_target_repo from
  // the null registry), never a throw.
  if (!repo) {
    return {
      ...evaluateSandbox({
        runId: opts.runId,
        agentSlug: slug,
        copilotId,
        versionId: copilot.productionVersionId ?? copilot.latestVersionId,
        repo: 'none',
        branch: 'none',
        commit: null,
        repoFitScore,
        registryText: null,
        manifestText: null,
        handlerPresent: false,
        readmePresent: false,
        targetScripts: null,
        artifactTexts: {},
        createdAt: opts.createdAt,
      }),
      projectId: copilot.projectId ?? null,
    }
  }

  // Resolve the target head commit for the branch under evaluation (a PR
  // delivery branch when overridden, else the default). Best-effort — null on
  // rate limit. Artifacts are read from the SAME branch/ref.
  const branch = opts.targetBranch ?? 'main'
  let commit: string | null = null
  try {
    commit = await getRepoHeadSha(repo, branch)
  } catch {
    commit = null
  }

  const dir = `agents/${slug}`
  const [registryText, manifestText, handlerText, readmeText, pkgText] = await Promise.all([
    readOrNull(repo, 'agents/_registry.json', branch),
    readOrNull(repo, `${dir}/manifest.json`, branch),
    readOrNull(repo, `${dir}/handler.ts`, branch),
    readOrNull(repo, `${dir}/README.md`, branch),
    readOrNull(repo, 'package.json', branch),
  ])

  // Secret-scan ONLY the delivered agent artifacts (never the whole repo).
  const artifactTexts: Record<string, string> = {}
  if (registryText !== null) artifactTexts['agents/_registry.json'] = registryText
  if (manifestText !== null) artifactTexts[`${dir}/manifest.json`] = manifestText
  if (handlerText !== null) artifactTexts[`${dir}/handler.ts`] = handlerText
  if (readmeText !== null) artifactTexts[`${dir}/README.md`] = readmeText

  const mode: SandboxExecutionMode = opts.mode ?? 'dry_run'
  const installMode: SandboxInstallMode = opts.installMode ?? 'skip'

  // Execute mode: clone the repo (disposable) and run its gate scripts. Only
  // when the agent was actually delivered (registry present) — no point cloning
  // to run scripts if the delivery itself is broken. Fail-soft: a clone/runner
  // failure degrades to a dry-run report rather than throwing.
  let scriptResults: Record<string, import('./target-repo-sandbox').ScriptExecResult> | undefined
  let coveredByVerify: string[] | undefined
  let sandboxPath: string | undefined
  let executionMode: SandboxExecutionMode = 'dry_run'
  let runnerScripts: Record<string, string> | null = null

  if (mode === 'execute' && registryText !== null) {
    try {
      const run = await runTargetRepoSandbox({
        runId: opts.runId,
        repo,
        branch,
        installMode,
        keepSandbox: opts.keepSandbox ?? false,
      })
      scriptResults = run.scriptResults
      coveredByVerify = run.coveredByVerify
      runnerScripts = run.targetScripts
      executionMode = 'execute'
      if (opts.keepSandbox) sandboxPath = run.sandboxPath
    } catch (err) {
      console.error('[target-sandbox] execute run failed, degrading to dry_run', err instanceof Error ? err.message : err)
    }
  }

  return {
    ...evaluateSandbox({
      runId: opts.runId,
      agentSlug: slug,
      copilotId,
      versionId: copilot.productionVersionId ?? copilot.latestVersionId,
      repo,
      branch,
      commit,
      repoFitScore,
      registryText,
      manifestText,
      handlerPresent: handlerText !== null,
      readmePresent: readmeText !== null,
      // Prefer the scripts seen in the CLONE (execute) over the API-read one.
      targetScripts: runnerScripts ?? parsePackageScripts(pkgText),
      artifactTexts,
      createdAt: opts.createdAt,
      executionMode,
      installMode,
      sandboxKept: opts.keepSandbox ?? false,
      sandboxPath,
      scriptResults,
      coveredByVerify,
    }),
    projectId: copilot.projectId ?? null,
  }
}
