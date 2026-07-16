'use client'

import { useCallback, useEffect, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Textarea } from '@/components/catalyst/textarea'
import {
  latestMissionUrl,
  MISSION_DATA_UNAVAILABLE,
  parseLatestMissionResponse,
  type LatestMissionApiResponse,
} from '@/lib/agent-mission-control/mission-latest-client'
import type { MissionParticipant, MissionReport } from '@/lib/agent-mission-control/mission-orchestrator'

interface MissionResponse {
  ok: boolean
  persisted?: boolean
  report?: MissionReport
  error?: string
}

type Phase = 'loading' | 'idle' | 'running' | 'ready' | 'error'

const DEFAULT_OBJECTIVE = 'Validate agent delivery readiness for this project'

function severityBadgeColor(severity: string): 'zinc' | 'accent' | 'accentStrong' {
  if (severity === 'blocker') return 'accentStrong'
  if (severity === 'warning') return 'accent'
  return 'zinc'
}

function statusTone(status: string): 'accent' | 'zinc' {
  return status === 'completed' || status === 'ready_for_delivery' ? 'accent' : 'zinc'
}

function ParticipantsList({ participants }: { participants: MissionParticipant[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {participants.map((p) => (
        <li key={p.role}>
          <Badge color={p.status === 'missing' ? 'accent' : 'zinc'}>
            {p.copilotName ?? p.role}
            {p.status === 'missing' ? ' (evidence-only)' : ''}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function MissionReportPanel({ report }: { report: MissionReport }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge color={statusTone(report.status)}>{report.status.replace(/_/g, ' ')}</Badge>
        <Badge color="zinc">{report.consensus.decision.replace(/_/g, ' ')}</Badge>
        <span className="text-xs text-zinc-500 font-mono">{report.runId}</span>
      </div>

      <p className="text-sm text-zinc-300">{report.consensus.summary}</p>

      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Participants</p>
        <ParticipantsList participants={report.participants} />
      </div>

      {report.consensus.blockers.length > 0 && (
        <div className={`${surfaceInsetClass} ring-1 ring-accent-500/30`}>
          <p className="text-xs font-medium text-accent-300 mb-2">Blockers ({report.consensus.blockers.length})</p>
          <ul className="text-sm text-zinc-300 space-y-1">
            {report.consensus.blockers.map((f) => (
              <li key={f.id}>• {f.title}</li>
            ))}
          </ul>
        </div>
      )}

      {report.consensus.warnings.length > 0 && (
        <div className={`${surfaceInsetClass} ring-1 ring-white/10`}>
          <p className="text-xs font-medium text-zinc-300 mb-2">Warnings ({report.consensus.warnings.length})</p>
          <ul className="text-sm text-zinc-300 space-y-1">
            {report.consensus.warnings.slice(0, 8).map((f) => (
              <li key={f.id}>• {f.title}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2">Next actions</p>
        <ul className="text-sm text-zinc-400 space-y-1 list-disc pl-4">
          {report.consensus.nextActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer hover:text-zinc-300">All findings ({report.findings.length})</summary>
        <ul className="mt-2 space-y-2 max-h-48 overflow-y-auto">
          {report.findings.map((f) => (
            <li key={f.id} className="flex gap-2">
              <Badge color={severityBadgeColor(f.severity)}>{f.severity}</Badge>
              <span className="text-zinc-400">{f.role}: {f.title}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

export function ProjectMissionOrchestrator({
  projectId,
  defaultObjective,
}: {
  projectId: string
  defaultObjective?: string
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [objective, setObjective] = useState(defaultObjective ?? DEFAULT_OBJECTIVE)
  const [report, setReport] = useState<MissionReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hydrateWarning, setHydrateWarning] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadLatestMission() {
      try {
        const res = await fetch(latestMissionUrl(projectId))
        const payload = (await res.json().catch(() => null)) as LatestMissionApiResponse | null
        if (cancelled) return

        if (!res.ok) {
          setHydrateWarning(MISSION_DATA_UNAVAILABLE)
          setPhase('idle')
          return
        }

        const hydrated = parseLatestMissionResponse(payload)
        if (hydrated.objective) {
          setObjective(hydrated.objective)
        }
        if (hydrated.phase === 'ready') {
          setReport(hydrated.report)
          setPhase('ready')
        } else {
          setPhase('idle')
        }
      } catch {
        if (!cancelled) {
          setHydrateWarning(MISSION_DATA_UNAVAILABLE)
          setPhase('idle')
        }
      }
    }

    void loadLatestMission()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const runMission = useCallback(async () => {
    setPhase('running')
    setError(null)
    setHydrateWarning(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/missions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objective, mode: 'evidence_v1', branch: 'main' }),
      })
      const payload = (await res.json().catch(() => null)) as MissionResponse | null
      if (!res.ok || !payload?.ok || !payload.report) {
        setError(payload?.error ?? `Mission failed (${res.status}).`)
        setPhase(report ? 'ready' : 'idle')
        return
      }
      setReport(payload.report)
      setPhase('ready')
    } catch {
      setError('Live backend not configured.')
      setPhase(report ? 'ready' : 'idle')
    }
  }, [projectId, objective, report])

  const showReport = report && (phase === 'ready' || phase === 'error')

  return (
    <AgentSectionCard
      title="Mission Orchestrator"
      description="Multi-agent evidence mission — selects participants, consolidates findings, outputs a delivery decision."
      actions={
        <Button type="button" color="accent" disabled={phase === 'running' || phase === 'loading'} onClick={() => void runMission()}>
          {phase === 'running' ? 'Running…' : 'Run Mission'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-widest">Objective</span>
          <Textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            resizable={false}
            className="text-sm"
            placeholder={DEFAULT_OBJECTIVE}
            disabled={phase === 'loading'}
          />
        </label>

        {phase === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner />
            Loading latest mission…
          </div>
        )}

        {hydrateWarning && phase !== 'running' && (
          <p className="text-xs text-zinc-500">{hydrateWarning}</p>
        )}

        {phase === 'running' && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Spinner />
            Collecting evidence from repo intelligence, scorecard, sandbox…
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        {showReport && <MissionReportPanel report={report} />}
      </div>
    </AgentSectionCard>
  )
}
