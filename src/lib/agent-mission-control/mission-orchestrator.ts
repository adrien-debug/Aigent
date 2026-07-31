/**
 * Agent Mission Control — Multi-Agent Mission Orchestrator (PURE, no I/O).
 *
 * Selects specialized participants for a repo mission, turns existing evidence
 * (repo intelligence, delivery scorecard, sandbox, delivery events) into
 * structured findings per role, and consolidates a mission decision.
 *
 * V1 is evidence-based — it does not spin up LangGraph for every participant.
 * Honest: missing participants become warnings, never fake success.
 */

import type { AgentDeliveryScorecard } from './delivery-scorecard'
import type { DeliveryEvent } from './delivery-events-store'
import type { RepoIntelligence } from './repo-intelligence'
import type { TargetRepoSandboxReport } from './target-repo-sandbox'
import type { Copilot } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MissionStatus =
  | 'draft'
  | 'running'
  | 'needs_attention'
  | 'ready_for_delivery'
  | 'blocked'
  | 'completed'

export type MissionParticipantRole =
  | 'orchestrator'
  | 'repo_inspector'
  | 'security'
  | 'design_system'
  | 'qa_release'
  | 'domain_agent'

export type MissionFindingSeverity = 'info' | 'warning' | 'blocker'

export type MissionDecision =
  | 'continue'
  | 'needs_fix'
  | 'ready_for_delivery_loop'
  | 'blocked'

export type MissionExecutionMode = 'evidence_v1'

export interface MissionParticipant {
  role: MissionParticipantRole
  copilotId: string | null
  copilotName: string | null
  /** assigned = matched copilot or synthetic evidence role; missing = no copilot for optional role */
  status: 'assigned' | 'missing'
}

export interface MissionFinding {
  id: string
  missionRunId: string
  copilotId: string | null
  role: MissionParticipantRole
  severity: MissionFindingSeverity
  title: string
  description: string
  evidence: Record<string, unknown>
  recommendation: string | null
}

export interface MissionConsensus {
  decision: MissionDecision
  status: MissionStatus
  summary: string
  blockers: MissionFinding[]
  warnings: MissionFinding[]
  nextActions: string[]
}

export interface MissionReport {
  runId: string
  projectId: string
  objective: string
  mode: MissionExecutionMode
  status: MissionStatus
  repo: string | null
  branch: string
  participants: MissionParticipant[]
  findings: MissionFinding[]
  consensus: MissionConsensus
  createdAt: string
}

/** Evidence bundle collected server-side before pure finding generation. */
export interface MissionEvidenceBundle {
  repoIntelligence: RepoIntelligence | null
  deliveryEvent: DeliveryEvent | null
  sandboxReport: TargetRepoSandboxReport | null
  scorecard: AgentDeliveryScorecard | null
  projectCopilots: Copilot[]
  domainCopilotId: string | null
}

export interface SelectMissionParticipantsInput {
  objective: string
  projectCopilots: Copilot[]
  repoIntelligence: RepoIntelligence | null
}

// ---------------------------------------------------------------------------
// Participant selection
// ---------------------------------------------------------------------------

const ROLE_LABELS: Record<MissionParticipantRole, string> = {
  orchestrator: 'Orchestrator',
  repo_inspector: 'Repo Inspector',
  security: 'Security Sentinel',
  design_system: 'Design System Guardian',
  qa_release: 'QA & Release',
  domain_agent: 'Domain Agent',
}

const ROLE_MATCHERS: Record<Exclude<MissionParticipantRole, 'orchestrator'>, RegExp[]> = {
  repo_inspector: [/repo[- ]?inspect/i, /inspector/i],
  security: [/\bsecurity\b/i, /security[- ]?sentinel/i],
  design_system: [/design[- ]?system/i, /ds[- ]?guardian/i, /catalyst/i],
  qa_release: [/\bqa\b/i, /qa[- ]?release/i, /quality[- ]?release/i],
  domain_agent: [/btc/i, /alert/i, /levels/i, /trade/i],
}

function matchesCopilot(copilot: Copilot, patterns: RegExp[]): boolean {
  const hay = `${copilot.name} ${copilot.slug} ${copilot.tags.join(' ')}`
  return patterns.some((p) => p.test(hay))
}

function pickCopilot(copilots: Copilot[], patterns: RegExp[]): Copilot | null {
  const production = copilots.filter((c) => c.productionVersionId)
  const pool = production.length > 0 ? production : copilots
  return pool.find((c) => matchesCopilot(c, patterns)) ?? null
}

function objectiveMentionsBtc(objective: string): boolean {
  return /\bbtc\b|bitcoin|alert.*level|levels.*sentinel/i.test(objective)
}

function objectiveMentionsDomain(objective: string): boolean {
  return objectiveMentionsBtc(objective) || /\bdomain\b|agent delivery|merged delivery/i.test(objective)
}

/** Select mission participants from repo intelligence + project copilots + objective. */
export function selectMissionParticipants(input: SelectMissionParticipantsInput): MissionParticipant[] {
  const { objective, projectCopilots, repoIntelligence } = input
  const dsSignals = repoIntelligence?.map.designSystemSignals ?? []
  const includeDs = dsSignals.length > 0

  const roles: Exclude<MissionParticipantRole, 'orchestrator'>[] = [
    'repo_inspector',
    'security',
    ...(includeDs ? (['design_system'] as const) : []),
    'qa_release',
    ...(objectiveMentionsDomain(objective) ? (['domain_agent'] as const) : []),
  ]

  const participants: MissionParticipant[] = [
    {
      role: 'orchestrator',
      copilotId: null,
      copilotName: 'Mission Orchestrator',
      status: 'assigned',
    },
  ]

  for (const role of roles) {
    const patterns = ROLE_MATCHERS[role]
    let copilot = pickCopilot(projectCopilots, patterns)

    if (role === 'domain_agent' && !copilot && objectiveMentionsBtc(objective)) {
      copilot =
        projectCopilots.find((c) => /btc|alert|sentinel/i.test(`${c.name} ${c.slug}`)) ?? null
    }

    participants.push({
      role,
      copilotId: copilot?.id ?? null,
      copilotName: copilot?.name ?? ROLE_LABELS[role],
      status: copilot ? 'assigned' : 'missing',
    })
  }

  return participants
}

// ---------------------------------------------------------------------------
// Finding builders (evidence V1)
// ---------------------------------------------------------------------------

function fid(runId: string, role: string, n: number): string {
  return `finding_${runId}_${role}_${n}`
}

function missingParticipantFinding(
  runId: string,
  role: MissionParticipantRole,
  n: number
): MissionFinding {
  return {
    id: fid(runId, role, n),
    missionRunId: runId,
    copilotId: null,
    role,
    severity: 'warning',
    title: `Participant missing: ${ROLE_LABELS[role]}`,
    description: `No dedicated copilot matched for ${ROLE_LABELS[role]}. Findings for this role use evidence-only synthesis.`,
    evidence: { kind: 'participant_missing' },
    recommendation: 'Assign or create a specialized copilot for fuller live execution in a later iteration.',
  }
}

function buildRepoInspectorFindings(
  runId: string,
  evidence: MissionEvidenceBundle,
  participant: MissionParticipant
): MissionFinding[] {
  if (participant.status === 'missing') return [missingParticipantFinding(runId, 'repo_inspector', 0)]

  const findings: MissionFinding[] = []
  const intel = evidence.repoIntelligence
  let n = 0

  if (!intel) {
    findings.push({
      id: fid(runId, 'repo_inspector', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'repo_inspector',
      severity: 'warning',
      title: 'Repo intelligence unavailable',
      description: 'No cached repo intelligence — run a repo scan before delivery decisions.',
      evidence: { kind: 'repo_intelligence_missing' },
      recommendation: 'POST /api/agent-ops/projects/:id/repo/intelligence to refresh the RepoMap.',
    })
    return findings
  }

  const { map, residue } = intel
  findings.push({
    id: fid(runId, 'repo_inspector', n++),
    missionRunId: runId,
    copilotId: participant.copilotId,
    role: 'repo_inspector',
    severity: 'info',
    title: 'Stack & scripts documented',
    description: `Stack: ${map.stack.join(', ') || 'unknown'}. Scripts: ${Object.keys(map.scripts).slice(0, 12).join(', ') || 'none'}.`,
    evidence: {
      stack: map.stack,
      scripts: Object.keys(map.scripts),
      packageManager: map.packageManager,
    },
    recommendation: null,
  })

  findings.push({
    id: fid(runId, 'repo_inspector', n++),
    missionRunId: runId,
    copilotId: participant.copilotId,
    role: 'repo_inspector',
    severity: 'info',
    title: 'API routes inventory',
    description: `${map.apiRoutes.length} API routes detected in RepoMap.`,
    evidence: { apiRoutes: map.apiRoutes.slice(0, 30), appRoutes: map.appRoutes.slice(0, 20) },
    recommendation: null,
  })

  if (residue.length > 0) {
    findings.push({
      id: fid(runId, 'repo_inspector', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'repo_inspector',
      severity: residue.some((r) => r.severity === 'high') ? 'warning' : 'info',
      title: `${residue.length} residue finding(s)`,
      description: 'Residue signals require human review before cleanup — never auto-delete.',
      evidence: { residue: residue.slice(0, 10).map((r) => ({ type: r.type, path: r.path, severity: r.severity })) },
      recommendation: 'Review residue paths manually; do not auto-remove without validation.',
    })
  }

  if (map.riskNotes.length > 0) {
    findings.push({
      id: fid(runId, 'repo_inspector', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'repo_inspector',
      severity: 'warning',
      title: 'Repo risk notes',
      description: map.riskNotes.slice(0, 3).join(' · '),
      evidence: { riskNotes: map.riskNotes },
      recommendation: 'Address repo risk notes before production promotion.',
    })
  }

  const expectedScripts = ['lint', 'test', 'build', 'typecheck']
  const missingScripts = expectedScripts.filter((s) => !map.scripts[s])
  if (missingScripts.length > 0) {
    findings.push({
      id: fid(runId, 'repo_inspector', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'repo_inspector',
      severity: 'info',
      title: 'Missing common validation scripts',
      description: `Scripts not in package.json: ${missingScripts.join(', ')}.`,
      evidence: { missingScripts, availableScripts: Object.keys(map.scripts) },
      recommendation: 'Only cite scripts that exist in the repo when proposing validations.',
    })
  }

  return findings
}

export function buildSecurityFindings(
  runId: string,
  evidence: MissionEvidenceBundle,
  participant: MissionParticipant
): MissionFinding[] {
  if (participant.status === 'missing') return [missingParticipantFinding(runId, 'security', 0)]

  const findings: MissionFinding[] = []
  let n = 0
  const intel = evidence.repoIntelligence
  const scorecard = evidence.scorecard
  const sandbox = evidence.sandboxReport

  const envSignals = intel?.map.envSignals ?? []
  const trackedEnvRisk = intel?.map.riskNotes.some((r) => /\.env|secret|credential|tracked/i.test(r)) ?? false
  if (envSignals.length > 0 || trackedEnvRisk) {
    findings.push({
      id: fid(runId, 'security', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'security',
      severity: 'warning',
      title: trackedEnvRisk ? 'Tracked .env / secret exposure risk' : 'Environment signals detected',
      description: trackedEnvRisk
        ? 'Repo intelligence flags tracked env/secret risk. Never read or display secret values.'
        : `Env signals: ${envSignals.slice(0, 5).join(', ')}.`,
      evidence: { envSignals, riskNotes: intel?.map.riskNotes ?? [] },
      recommendation: 'Review .env tracking, rotate exposed secrets, keep agents read-only on secrets.',
    })
  }

  const unsafe = scorecard?.blockers.find((b) => b.startsWith('unsafe_actions:'))
  const unsafeCount = unsafe ? Number(unsafe.split(':')[1] ?? '1') : null
  if (unsafeCount !== null && unsafeCount > 0) {
    findings.push({
      id: fid(runId, 'security', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'security',
      severity: 'blocker',
      title: `Benchmark unsafe actions: ${unsafeCount}`,
      description: 'Latest benchmark reports unsafe agent actions.',
      evidence: { unsafeActionCount: unsafeCount },
      recommendation: 'Fix agent runtime policy before delivery.',
    })
  } else if (scorecard && !unsafe) {
    findings.push({
      id: fid(runId, 'security', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'security',
      severity: 'info',
      title: 'No unsafe benchmark actions',
      description: 'Latest benchmark unsafe_action_count is 0.',
      evidence: { unsafeActionCount: 0 },
      recommendation: null,
    })
  }

  const secretScan = sandbox?.checks.find((c) => c.id === 'security:secret-scan')
  if (secretScan) {
    findings.push({
      id: fid(runId, 'security', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'security',
      severity: secretScan.status === 'failed' ? 'blocker' : 'info',
      title: 'Sandbox secret scan',
      description: `Secret scan ${secretScan.status}${secretScan.reason ? `: ${secretScan.reason}` : ''}.`,
      evidence: { checkId: secretScan.id, status: secretScan.status },
      recommendation: secretScan.status === 'failed' ? 'Remove secret patterns from delivered artifacts.' : null,
    })
  }

  const writeTools = scorecard?.blockers.filter((b) => b.includes('write') || b.includes('tool')) ?? []
  if (writeTools.length > 0) {
    findings.push({
      id: fid(runId, 'security', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'security',
      severity: 'warning',
      title: 'Tool policy risks',
      description: writeTools.join('; '),
      evidence: { blockers: writeTools },
      recommendation: 'Keep delivery agents read-only unless explicitly approved.',
    })
  }

  if (findings.length === 0) {
    findings.push({
      id: fid(runId, 'security', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'security',
      severity: 'info',
      title: 'No elevated security signals',
      description: 'No tracked secret risks or unsafe actions in current evidence.',
      evidence: {},
      recommendation: null,
    })
  }

  return findings
}

function buildDesignSystemFindings(
  runId: string,
  evidence: MissionEvidenceBundle,
  participant: MissionParticipant
): MissionFinding[] {
  if (participant.status === 'missing') return [missingParticipantFinding(runId, 'design_system', 0)]

  const intel = evidence.repoIntelligence
  const dsSignals = intel?.map.designSystemSignals ?? []
  const scripts = intel?.map.scripts ?? {}
  const findings: MissionFinding[] = []
  let n = 0

  findings.push({
    id: fid(runId, 'design_system', n++),
    missionRunId: runId,
    copilotId: participant.copilotId,
    role: 'design_system',
    severity: 'info',
    title: 'Design system signals',
    description: dsSignals.length > 0 ? dsSignals.join(' · ') : 'No DS signals in RepoMap.',
    evidence: { designSystemSignals: dsSignals },
    recommendation: null,
  })

  const dsScripts = ['check:ds', 'check:catalyst']
  const present = dsScripts.filter((s) => scripts[s])
  const absent = dsScripts.filter((s) => !scripts[s])
  if (absent.length > 0) {
    findings.push({
      id: fid(runId, 'design_system', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'design_system',
      severity: 'info',
      title: 'DS validation scripts absent',
      description: `No ${absent.join('/')} in package.json — agents must not invent these gates.`,
      evidence: { absent, present },
      recommendation: 'When proposing UI, cite only real repo scripts (lint, test, build, check).',
    })
  }

  return findings
}

export function buildQaReleaseFindings(
  runId: string,
  evidence: MissionEvidenceBundle,
  participant: MissionParticipant
): MissionFinding[] {
  if (participant.status === 'missing') return [missingParticipantFinding(runId, 'qa_release', 0)]

  const findings: MissionFinding[] = []
  let n = 0
  const scorecard = evidence.scorecard
  const sandbox = evidence.sandboxReport
  const delivery = evidence.deliveryEvent

  if (scorecard) {
    const testDim = scorecard.dimensions.find((d) => d.id === 'tests')
    findings.push({
      id: fid(runId, 'qa_release', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'qa_release',
      severity: testDim?.status === 'fail' ? 'blocker' : testDim?.status === 'warn' ? 'warning' : 'info',
      title: 'Test pass rate',
      description: testDim?.evidence ?? `Tests dimension: ${testDim?.status ?? 'unknown'}.`,
      evidence: { score: testDim?.score, status: testDim?.status },
      recommendation: testDim?.status === 'fail' ? 'Reach 100% repo-aware tests before delivery.' : null,
    })

    const benchDim = scorecard.dimensions.find((d) => d.id === 'benchmark' || d.id === 'safety')
    findings.push({
      id: fid(runId, 'qa_release', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'qa_release',
      severity: 'info',
      title: 'Benchmark / safety',
      description: benchDim?.evidence ?? `Benchmark: ${benchDim?.status ?? 'unknown'}.`,
      evidence: { score: benchDim?.score, status: benchDim?.status },
      recommendation: null,
    })

    const gateRed = scorecard.blockers.includes('release_gate_red')
    if (gateRed || scorecard.evidence.releaseGatePromotable === false) {
      findings.push({
        id: fid(runId, 'qa_release', n++),
        missionRunId: runId,
        copilotId: participant.copilotId,
        role: 'qa_release',
        severity: 'blocker',
        title: 'Release gate red',
        description: 'Release gate is not promotable for the candidate version.',
        evidence: { releaseGatePromotable: scorecard.evidence.releaseGatePromotable, blockers: scorecard.blockers },
        recommendation: 'Fix release gate checks before entering delivery loop.',
      })
    } else if (scorecard.evidence.releaseGatePromotable === true) {
      findings.push({
        id: fid(runId, 'qa_release', n++),
        missionRunId: runId,
        copilotId: participant.copilotId,
        role: 'qa_release',
        severity: 'info',
        title: 'Release gate green',
        description: 'Release gate promotable.',
        evidence: { releaseGatePromotable: true },
        recommendation: null,
      })
    }
  }

  if (sandbox) {
    findings.push({
      id: fid(runId, 'qa_release', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'qa_release',
      severity: sandbox.status === 'failed' ? 'blocker' : sandbox.status === 'warning' ? 'warning' : 'info',
      title: 'Sandbox verdict',
      description: `Sandbox ${sandbox.executionMode} on ${sandbox.branch}: ${sandbox.status} (${sandbox.sandboxFitScore ?? '—'}/100).`,
      evidence: {
        status: sandbox.status,
        sandboxFitScore: sandbox.sandboxFitScore,
        blockers: sandbox.blockers,
        branch: sandbox.branch,
      },
      recommendation: sandbox.status === 'failed' ? 'Re-run sandbox execute after fixes.' : null,
    })
  }

  if (delivery) {
    findings.push({
      id: fid(runId, 'qa_release', n++),
      missionRunId: runId,
      copilotId: participant.copilotId,
      role: 'qa_release',
      severity: 'info',
      title: `Delivery event: ${delivery.status}`,
      description: delivery.prUrl
        ? `Latest delivery PR #${delivery.prNumber ?? '?'} → ${delivery.targetBranch ?? 'main'}.`
        : `Latest delivery status: ${delivery.status}.`,
      evidence: {
        status: delivery.status,
        prUrl: delivery.prUrl,
        prNumber: delivery.prNumber,
        commitSha: delivery.commitSha,
      },
      recommendation: null,
    })
  }

  return findings
}

function buildDomainAgentFindings(
  runId: string,
  evidence: MissionEvidenceBundle,
  participant: MissionParticipant
): MissionFinding[] {
  if (participant.status === 'missing') return [missingParticipantFinding(runId, 'domain_agent', 0)]

  const findings: MissionFinding[] = []
  let n = 0
  const scorecard = evidence.scorecard
  const domainId = evidence.domainCopilotId ?? participant.copilotId

  if (scorecard) {
    const repoFit = scorecard.evidence.repoFit
    findings.push({
      id: fid(runId, 'domain_agent', n++),
      missionRunId: runId,
      copilotId: domainId,
      role: 'domain_agent',
      severity: repoFit && repoFit.score < 70 ? 'warning' : 'info',
      title: 'Domain repo-fit',
      description: repoFit ? `RepoFitScore ${repoFit.score}/100 (${repoFit.level}).` : 'Repo-fit not computed.',
      evidence: { repoFitScore: repoFit?.score, missingCoverage: repoFit?.missingCoverage ?? [] },
      recommendation: repoFit && repoFit.score < 95 ? 'Improve repo-aware test coverage.' : null,
    })

    findings.push({
      id: fid(runId, 'domain_agent', n++),
      missionRunId: runId,
      copilotId: domainId,
      role: 'domain_agent',
      severity: scorecard.level === 'not_ready' ? 'warning' : 'info',
      title: 'Delivery scorecard',
      description: `Score ${scorecard.score}/100 — level ${scorecard.level}.`,
      evidence: { score: scorecard.score, level: scorecard.level, blockers: scorecard.blockers },
      recommendation: scorecard.level === 'not_ready' ? 'Run improve loop before manual test.' : null,
    })
  }

  if (evidence.deliveryEvent?.status === 'merged_validated') {
    findings.push({
      id: fid(runId, 'domain_agent', n++),
      missionRunId: runId,
      copilotId: domainId,
      role: 'domain_agent',
      severity: 'info',
      title: 'Merged delivery validated',
      description: 'Domain agent delivery merged and post-merge validation recorded.',
      evidence: { deliveryStatus: evidence.deliveryEvent.status, commitSha: evidence.deliveryEvent.commitSha },
      recommendation: 'Manual smoke test: send a real BTCUSDT prompt and verify NO_ALERT/WATCH/ALERT_CANDIDATE.',
    })
  }

  return findings
}

export function buildMissionFindings(
  runId: string,
  participants: MissionParticipant[],
  evidence: MissionEvidenceBundle
): MissionFinding[] {
  const byRole = Object.fromEntries(participants.map((p) => [p.role, p])) as Partial<
    Record<MissionParticipantRole, MissionParticipant>
  >

  const all: MissionFinding[] = []

  if (byRole.repo_inspector) all.push(...buildRepoInspectorFindings(runId, evidence, byRole.repo_inspector))
  if (byRole.security) all.push(...buildSecurityFindings(runId, evidence, byRole.security))
  if (byRole.design_system) all.push(...buildDesignSystemFindings(runId, evidence, byRole.design_system))
  if (byRole.qa_release) all.push(...buildQaReleaseFindings(runId, evidence, byRole.qa_release))
  if (byRole.domain_agent) all.push(...buildDomainAgentFindings(runId, evidence, byRole.domain_agent))

  return all
}

// ---------------------------------------------------------------------------
// Consensus
// ---------------------------------------------------------------------------

export function computeMissionConsensus(findings: MissionFinding[]): MissionConsensus {
  const blockers = findings.filter((f) => f.severity === 'blocker')
  const warnings = findings.filter((f) => f.severity === 'warning')

  const sandboxFailed = blockers.some((f) => f.title === 'Sandbox verdict' || /sandbox.*failed/i.test(f.description))
  const releaseGateRed = blockers.some((f) => f.title === 'Release gate red')
  const unsafeBlocked = blockers.some((f) => /unsafe action/i.test(f.title))
  const mergedValidated = findings.some(
    (f) => f.title === 'Merged delivery validated' || f.evidence.deliveryStatus === 'merged_validated'
  )
  const deliveryReady = findings.some(
    (f) => f.title === 'Delivery scorecard' && typeof f.evidence.level === 'string' && f.evidence.level !== 'not_ready'
  )
  const scorecardExcellent = findings.some(
    (f) => f.title === 'Delivery scorecard' && (f.evidence.level === 'excellent' || f.evidence.level === 'delivery_ready')
  )

  let decision: MissionDecision
  let status: MissionStatus
  const nextActions: string[] = []

  if (mergedValidated && blockers.length === 0) {
    decision = 'continue'
    status = 'completed'
    nextActions.push('Mission complete — domain agent merged and validated.')
    nextActions.push('Optional: manual smoke test in production workspace.')
  } else if (mergedValidated && blockers.length > 0) {
    decision = 'needs_fix'
    status = 'needs_attention'
    nextActions.push('Merged delivery validated but open blockers remain — review before next promotion.')
  } else if (blockers.length > 0 || unsafeBlocked) {
    decision = 'blocked'
    status = 'blocked'
    nextActions.push('Resolve blocker findings before delivery.')
    if (releaseGateRed) nextActions.push('Fix release gate checks.')
    if (sandboxFailed) nextActions.push('Re-run target sandbox execute.')
  } else if (warnings.length > 0 && scorecardExcellent && blockers.length === 0) {
    decision = 'ready_for_delivery_loop'
    status = 'ready_for_delivery'
    nextActions.push('Warnings present but scorecard is delivery-ready — may enter delivery loop.')
    nextActions.push('Review warnings before manual test.')
  } else if (warnings.length > 0 || findings.some((f) => f.evidence.kind === 'participant_missing')) {
    decision = 'needs_fix'
    status = 'needs_attention'
    nextActions.push('Address warnings or assign missing participants.')
  } else if (deliveryReady) {
    decision = 'ready_for_delivery_loop'
    status = 'ready_for_delivery'
    nextActions.push('Evidence green — proceed to delivery loop when objective requires shipping.')
  } else {
    decision = 'continue'
    status = 'needs_attention'
    nextActions.push('Collect more evidence (tests, sandbox, delivery) before delivery loop.')
  }

  const summary =
    status === 'completed'
      ? 'Mission completed — merged delivery validated with no blockers.'
      : status === 'blocked'
        ? `${blockers.length} blocker(s) — mission blocked.`
        : status === 'ready_for_delivery'
          ? `Ready for delivery loop (${warnings.length} warning(s)).`
          : `${warnings.length} warning(s), ${blockers.length} blocker(s) — needs attention.`

  return { decision, status, summary, blockers, warnings, nextActions }
}

/** Assemble the full mission report (pure). */
export function assembleMissionReport(input: {
  runId: string
  projectId: string
  objective: string
  mode: MissionExecutionMode
  repo: string | null
  branch: string
  participants: MissionParticipant[]
  findings: MissionFinding[]
  createdAt: string
}): MissionReport {
  const consensus = computeMissionConsensus(input.findings)
  return {
    runId: input.runId,
    projectId: input.projectId,
    objective: input.objective,
    mode: input.mode,
    status: consensus.status,
    repo: input.repo,
    branch: input.branch,
    participants: input.participants,
    findings: input.findings,
    consensus,
    createdAt: input.createdAt,
  }
}
