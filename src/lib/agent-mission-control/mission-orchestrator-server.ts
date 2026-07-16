/**
 * Agent Mission Control — Mission orchestrator server (I/O only).
 *
 * Collects existing evidence, runs the pure orchestrator, persists mission run
 * + findings. READ-ONLY: never writes to GitHub, never merges, never opens PRs.
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { getCopilots, getProject } from './data'
import { getDeliveryScorecard } from './delivery-scorecard-server'
import { getLatestDeliveryEvent } from './delivery-events-store'
import { persistMissionFindings } from './mission-findings-store'
import {
  assembleMissionReport,
  buildMissionFindings,
  selectMissionParticipants,
  type MissionEvidenceBundle,
  type MissionExecutionMode,
  type MissionReport,
} from './mission-orchestrator'
import { participantCopilotIds, persistMissionRun } from './mission-runs-store'
import { loadRepoIntelligence } from './repo-intelligence-store'
import { getLatestSandboxReport } from './sandbox-reports-store'

export interface RunMissionInput {
  projectId: string
  objective: string
  mode?: MissionExecutionMode
  branch?: string
}

export interface RunMissionResult {
  report: MissionReport
  persisted: boolean
}

async function resolveDomainCopilotId(
  projectCopilots: { id: string; name: string; slug: string }[],
  objective: string
): Promise<string | null> {
  const match = projectCopilots.find((c) => /btc|alert|sentinel/i.test(`${c.name} ${c.slug}`))
  if (match) return match.id
  if (/\bbtc\b|bitcoin|alert/i.test(objective)) {
    const all = await getCopilots()
    const bench = all.find((c) => /btc|alert|sentinel/i.test(`${c.name} ${c.slug}`))
    return bench?.id ?? null
  }
  return null
}

async function collectEvidence(
  projectId: string,
  projectCopilots: { id: string; name: string; slug: string; projectId: string | null }[],
  objective: string
): Promise<MissionEvidenceBundle> {
  const domainCopilotId = await resolveDomainCopilotId(projectCopilots, objective)
  const scorecardCopilotId = domainCopilotId ?? projectCopilots[0]?.id ?? null

  const [storedIntel, deliveryEvent, sandboxReport, scorecard] = await Promise.all([
    loadRepoIntelligence(projectId).catch(() => ({ intelligence: null, scannedAt: null, sha: null })),
    domainCopilotId
      ? getLatestDeliveryEvent(domainCopilotId).catch(() => null)
      : Promise.resolve(null),
    domainCopilotId ? getLatestSandboxReport(domainCopilotId).catch(() => null) : Promise.resolve(null),
    scorecardCopilotId
      ? getDeliveryScorecard(scorecardCopilotId, { target: 'auto' }).catch(() => null)
      : Promise.resolve(null),
  ])

  return {
    repoIntelligence: storedIntel.intelligence,
    deliveryEvent,
    sandboxReport,
    scorecard,
    projectCopilots: projectCopilots as MissionEvidenceBundle['projectCopilots'],
    domainCopilotId,
  }
}

/** Run one evidence-based mission. Never touches GitHub. */
export async function runMission(input: RunMissionInput): Promise<RunMissionResult | null> {
  const project = await getProject(input.projectId)
  if (!project) return null

  const allCopilots = await getCopilots()
  const projectCopilots = allCopilots.filter((c) => c.projectId === input.projectId)
  const mode: MissionExecutionMode = input.mode ?? 'evidence_v1'
  const branch = input.branch ?? 'main'
  const runId = `mission_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const createdAt = new Date().toISOString()

  const evidence = await collectEvidence(input.projectId, projectCopilots, input.objective)
  const participants = selectMissionParticipants({
    objective: input.objective,
    projectCopilots,
    repoIntelligence: evidence.repoIntelligence,
  })

  const findings = buildMissionFindings(runId, participants, evidence)
  const report = assembleMissionReport({
    runId,
    projectId: input.projectId,
    objective: input.objective,
    mode,
    repo: project.repoFullName ?? null,
    branch,
    participants,
    findings,
    createdAt,
  })

  let persisted = false
  try {
    await persistMissionRun({
      id: runId,
      projectId: input.projectId,
      objective: input.objective,
      status: report.status,
      participantCopilotIds: participantCopilotIds(participants),
      repo: project.repoFullName ?? null,
      branch,
      decision: report.consensus.decision,
      summary: report.consensus.summary,
      report,
      createdAt,
      updatedAt: createdAt,
    })
    await persistMissionFindings(findings)
    persisted = true
  } catch {
    persisted = false
  }

  return { report, persisted }
}

export { getLatestMissionRun, getMissionRun } from './mission-runs-store'
export { getMissionFindings } from './mission-findings-store'
