'use client'

import { useCallback, useEffect, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
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

function severityBadgeColor(severity: string): 'zinc' | 'accent' | 'accentStrong' | 'accentSolid' {
  if (severity === 'blocker') return 'accentSolid'
  if (severity === 'warning') return 'accentStrong'
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
          <Badge className="font-mono text-[11px]" color={p.status === 'missing' ? 'accent' : 'zinc'}>
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
    <div className="flex flex-col gap-6">
      {/* Header Metadata */}
      <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-4">
        <Badge className="w-36 justify-center uppercase tracking-wider text-[10px]" color={statusTone(report.status)}>
          {report.status.replace(/_/g, ' ')}
        </Badge>
        <Badge className="w-36 justify-center uppercase tracking-wider text-[10px]" color="zinc">
          {report.consensus.decision.replace(/_/g, ' ')}
        </Badge>
        <span className="text-xs text-zinc-500 font-mono truncate">{report.runId}</span>
      </div>

      <p className="text-sm text-zinc-800">{report.consensus.summary}</p>

      {/* Participants */}
      <div>
        <p className="text-xs font-semibold text-zinc-900 uppercase tracking-widest mb-3">Participants</p>
        <ParticipantsList participants={report.participants} />
      </div>

      {/* Blockers */}
      {report.consensus.blockers.length > 0 && (
        <div className="rounded-xl bg-(--accent-soft) ring-1 ring-(--accent-line) p-4">
          <p className="text-xs font-bold text-accent-700 uppercase tracking-widest mb-3">Blockers ({report.consensus.blockers.length})</p>
          <ul className="text-sm text-accent-800 space-y-2">
            {report.consensus.blockers.map((f) => (
              <li key={f.id}>• {f.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {report.consensus.warnings.length > 0 && (
        <div className="rounded-xl bg-zinc-50 ring-1 ring-zinc-950/5 p-4">
          <p className="text-xs font-bold text-zinc-900 uppercase tracking-widest mb-3">Warnings ({report.consensus.warnings.length})</p>
          <ul className="text-sm text-zinc-700 space-y-2">
            {report.consensus.warnings.slice(0, 8).map((f) => (
              <li key={f.id}>• {f.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Next Actions */}
      <div>
        <p className="text-xs font-semibold text-zinc-900 uppercase tracking-widest mb-3">Next actions</p>
        <ul className="text-sm text-zinc-700 space-y-2 list-disc pl-5">
          {report.consensus.nextActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      {/* Findings Table */}
      <details className="group">
        <summary className="cursor-pointer py-2 text-xs font-semibold text-zinc-500 uppercase tracking-widest hover:text-zinc-900 focus-visible:text-zinc-900 transition-colors">
          All findings ({report.findings.length})
        </summary>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-950/5 bg-zinc-50/50">
          <div className="grid grid-cols-[100px_140px_minmax(0,1fr)] items-center gap-x-4 border-b border-zinc-950/5 bg-zinc-100/50 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            <div>Severity</div>
            <div>Source</div>
            <div>Message</div>
          </div>
          <ul className="max-h-64 overflow-y-auto divide-y divide-zinc-950/5">
            {report.findings.map((f) => (
              <li key={f.id} className="grid grid-cols-[100px_140px_minmax(0,1fr)] items-start gap-x-4 px-4 py-3 text-sm">
                <div>
                  <Badge className="w-full justify-center" color={severityBadgeColor(f.severity)}>{f.severity}</Badge>
                </div>
                <span className="truncate font-medium text-zinc-900" title={f.role}>{f.role}</span>
                <span className="min-w-0 break-words text-zinc-600">{f.title}</span>
              </li>
            ))}
          </ul>
        </div>
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
    if (phase === 'running' || phase === 'loading') return
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
  }, [projectId, objective, report, phase])

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
        <Field disabled={phase === 'loading'}>
          <Label>Objective</Label>
          <Textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={2}
            resizable={false}
            className="text-sm"
            placeholder={DEFAULT_OBJECTIVE}
          />
        </Field>

        {phase === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner />
            Loading latest mission…
          </div>
        )}

        {hydrateWarning && phase !== 'running' && (
          <p role="status" aria-live="polite" className="text-xs text-zinc-500">
            {hydrateWarning}
          </p>
        )}

        {phase === 'running' && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-zinc-400">
            <Spinner />
            Collecting evidence from repo intelligence, scorecard, sandbox…
          </div>
        )}

        {error && <ErrorBanner message={error} />}

        {showReport && <MissionReportPanel report={report} />}

        {phase === 'idle' && !report && !error && !hydrateWarning && (
          <EmptyState title="No mission run yet" description="Set an objective and run one." className="px-0 py-6" />
        )}
      </div>
    </AgentSectionCard>
  )
}
