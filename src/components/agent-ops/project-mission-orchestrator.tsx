'use client'

import { useCallback, useEffect, useState } from 'react'

import { AgentSectionCard, eyebrowClass } from '@/components/agent-ops/surface-card'
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

/** Exported for the surface-hierarchy test, which renders it in isolation. */
export function MissionReportPanel({ report }: { report: MissionReport }) {
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

      <p className="text-sm leading-6 text-zinc-300">{report.consensus.summary}</p>

      {/* Participants */}
      <div>
        <p className={eyebrowClass}>Participants</p>
        <div className="mt-3">
          <ParticipantsList participants={report.participants} />
        </div>
      </div>

      {/* Blockers — a compact accent band, not a card. The accent hairline is
          the whole signal; wrapping it in a filled panel made a third plane
          inside a section that is already raised. */}
      {report.consensus.blockers.length > 0 && (
        <div className="border-l-2 border-[var(--accent-line-strong)] pl-4">
          <p className={eyebrowClass}>Blockers ({report.consensus.blockers.length})</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-6 text-zinc-300">
            {report.consensus.blockers.map((f) => (
              <li key={f.id}>{f.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings — same band treatment. The previous `bg-zinc-50` panel was a
          LIGHT surface rendered on a dark screen. */}
      {report.consensus.warnings.length > 0 && (
        <div className="border-l-2 border-white/10 pl-4">
          <p className={eyebrowClass}>Warnings ({report.consensus.warnings.length})</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-6 text-zinc-400">
            {report.consensus.warnings.slice(0, 8).map((f) => (
              <li key={f.id}>{f.title}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Next Actions — no framing at all, per the target architecture. */}
      <div>
        <p className={eyebrowClass}>Next actions</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm leading-6 text-zinc-300">
          {report.consensus.nextActions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </div>

      {/* Findings Table */}
      <details className="group">
        <summary className="cursor-pointer py-2 text-xs font-semibold text-zinc-500 uppercase tracking-widest hover:text-zinc-900 dark:hover:text-white focus-visible:text-zinc-900 dark:focus-visible:text-white transition-colors">
          All findings ({report.findings.length})
        </summary>
        {/* A disclosure list, not a card: no rounded wrapper, no second
            background, and no inner scroll — the page scrolls, the panel does
            not. Only the header row is sunken, which is the one legitimate
            depth step inside an already-raised section. */}
        <div className="mt-3">
          {/* The sunken TOKEN, not `surfaceItemClass` — that helper is a full
              rounded card (rounded-xl + ring), which would put a third plane
              back inside an already-raised section. */}
          <div className="grid grid-cols-[100px_140px_minmax(0,1fr)] items-center gap-x-4 rounded-t-lg bg-[var(--color-surface-sunken)] px-4 py-2">
            <div className={eyebrowClass}>Severity</div>
            <div className={eyebrowClass}>Source</div>
            <div className={eyebrowClass}>Message</div>
          </div>
          <ul className="divide-y divide-white/5">
            {report.findings.map((f) => (
              <li key={f.id} className="grid grid-cols-[100px_140px_minmax(0,1fr)] items-start gap-x-4 px-4 py-3 text-sm">
                <div>
                  <Badge className="w-full justify-center" color={severityBadgeColor(f.severity)}>{f.severity}</Badge>
                </div>
                <span className="truncate font-medium text-zinc-200" title={f.role}>{f.role}</span>
                <span className="min-w-0 break-words text-zinc-400">{f.title}</span>
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
