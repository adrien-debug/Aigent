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
import {
  evaluateSandbox,
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
): Promise<TargetRepoSandboxReport | null> {
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
    return evaluateSandbox({
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
    })
  }

  // Resolve the target repo's head commit (best-effort — null on rate limit).
  // Branch is the repo default the artifacts were read from.
  const branch = 'main'
  let commit: string | null = null
  try {
    commit = await getRepoHeadSha(repo)
  } catch {
    commit = null
  }

  const dir = `agents/${slug}`
  const [registryText, manifestText, handlerText, readmeText, pkgText] = await Promise.all([
    readOrNull(repo, 'agents/_registry.json'),
    readOrNull(repo, `${dir}/manifest.json`),
    readOrNull(repo, `${dir}/handler.ts`),
    readOrNull(repo, `${dir}/README.md`),
    readOrNull(repo, 'package.json'),
  ])

  // Secret-scan ONLY the delivered agent artifacts (never the whole repo).
  const artifactTexts: Record<string, string> = {}
  if (registryText !== null) artifactTexts['agents/_registry.json'] = registryText
  if (manifestText !== null) artifactTexts[`${dir}/manifest.json`] = manifestText
  if (handlerText !== null) artifactTexts[`${dir}/handler.ts`] = handlerText
  if (readmeText !== null) artifactTexts[`${dir}/README.md`] = readmeText

  return evaluateSandbox({
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
    targetScripts: parsePackageScripts(pkgText),
    artifactTexts,
    createdAt: opts.createdAt,
  })
}
