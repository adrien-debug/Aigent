/**
 * Agent Mission Control — Sandbox report persistence (server only).
 *
 * Thin store over the `sandbox_reports` table (migration 0014): persist a
 * TargetRepoSandboxReport and read back the latest one for a copilot. The report
 * JSON is already sanitized upstream (secret VALUES masked by the runner /
 * sanitizeOutput), so nothing sensitive is stored. Never import from a client
 * component (reads the service-role key).
 */
import 'server-only'

import { pgrest } from './postgrest'
import { parseSandboxReport, type TargetRepoSandboxReport } from './target-repo-sandbox'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

/**
 * Persist a report. `projectId` is optional context. The row's flat columns
 * mirror the report's core fields (for cheap filtering/sorting); the full
 * verdict lives in `report` jsonb. Fail-soft is the caller's choice — this
 * throws on a hard PostgREST error so a route can log + return generically.
 */
export async function persistSandboxReport(
  report: TargetRepoSandboxReport,
  projectId: string | null
): Promise<void> {
  await pgrest('POST', 'sandbox_reports', {
    id: report.runId,
    copilot_id: report.copilotId ?? null,
    version_id: report.versionId ?? null,
    project_id: projectId,
    run_id: report.runId,
    target_repo: report.repo,
    target_branch: report.branch,
    target_commit: report.commit,
    execution_mode: report.executionMode,
    install_mode: report.installMode,
    status: report.status,
    sandbox_fit_score: report.sandboxFitScore,
    repo_fit_score: report.repoFitScore,
    report,
    created_at: report.createdAt,
  })
}

/**
 * Read the latest persisted report for a copilot (newest by created_at), or null
 * when none exists. No network run — a pure DB read.
 */
export async function getLatestSandboxReport(copilotId: string): Promise<TargetRepoSandboxReport | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `sandbox_reports?${eq('copilot_id', copilotId)}&select=report&order=created_at.desc&limit=1`
  )
  const raw = rows[0]?.report
  if (!raw) return null
  try {
    return parseSandboxReport(raw)
  } catch {
    // A stored row that fails validation (older/corrupt) is treated as absent
    // rather than crashing the reader.
    return null
  }
}
