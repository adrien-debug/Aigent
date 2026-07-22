'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'

import { AgentSectionCard, surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { ProjectBuilderSuggestionsDrawer } from '@/components/agent-ops/project-builder-suggestions-drawer'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from '@/components/catalyst/dialog'
import type {
  AgentRecommendation,
  AgenticFootprint,
  RepoIntelligence,
  RepoMap,
  ResidueFinding,
} from '@/lib/agent-mission-control/repo-intelligence'

interface IntelligenceResponse {
  ok: boolean
  hasRepo: boolean
  rescanned: boolean
  staleness: string
  scannedAt: string | null
  intelligence: RepoIntelligence | null
  error?: string
}

/**
 * Scan phases. Every one is REACHABLE from `scan()` below — nothing here is a
 * state the fetch cannot produce.
 *
 * `auth-required` and `unavailable` are split out of `error` because they are
 * the two failures an operator acts on differently (log back in vs. wait for the
 * backend), and because the strip used to test `phase === 'scanning'` alone:
 * every other phase — including a real 401 — fell into the SUCCESS branch and
 * rendered "Repo scanned · not scanned yet" in accent green, 12px above the
 * "Authentication required" banner.
 */
type Phase = 'idle' | 'scanning' | 'ready' | 'error' | 'auth-required' | 'unavailable' | 'no-repo'

function formatScanAge(scannedAt: string | null): string {
  if (!scannedAt) return 'not scanned yet'
  const ms = Date.now() - Date.parse(scannedAt)
  if (!Number.isFinite(ms) || ms < 0) return 'recently'
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return new Date(scannedAt).toLocaleDateString()
}

/**
 * What the strip says in every non-success phase. Each line states the phase
 * AND its consequence ("not scanned"), so no failure can be mistaken for a
 * scan that simply happened a while ago.
 *
 * Rendered in zinc: the mono-accent system has no danger role yet, and using
 * the accent — the success hue — for a failure is the defect this fixes. Once
 * `--state-danger-*` lands in `globals.css`, the failure phases move onto it.
 */
const PHASE_STATUS_LABELS: Record<Phase, string> = {
  idle: 'Not scanned yet',
  scanning: 'Scanning repo…',
  ready: 'Repo scanned',
  error: 'Scan failed — repo not scanned',
  'auth-required': 'Authentication required — repo not scanned',
  unavailable: 'Repo intelligence unavailable — repo not scanned',
  'no-repo': 'No repo resolved for this project — nothing to scan',
}

/** Phases that owe the operator a banner, not just a status line. */
const FAILED_PHASES: ReadonlySet<Phase> = new Set<Phase>(['error', 'auth-required', 'unavailable'])

function intelSummaryLine(intel: RepoIntelligence): string {
  const { map } = intel
  const stack = map.stack.slice(0, 4).join(' · ') || 'unknown stack'
  return `${stack} · ${map.apiRoutes.length} API routes · ${map.components.length} components`
}

/**
 * Shared repo-intelligence fetch — auto-scan once on mount (read-only, cached server-side).
 */
export function useProjectRepoIntelligence(projectId: string, repoFullName: string | null) {
  const [phase, setPhase] = useState<Phase>(repoFullName ? 'idle' : 'no-repo')
  const [data, setData] = useState<IntelligenceResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  const scan = useCallback(
    async (force: boolean) => {
      setPhase('scanning')
      setError(null)
      try {
        const res = await fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/repo/intelligence`, {
          method: force ? 'POST' : 'GET',
        })
        const payload = (await res.json().catch(() => null)) as IntelligenceResponse | null
        if (!res.ok || !payload?.ok) {
          // 401/403 come from the auth proxy, before the route runs at all, and
          // 503 is the route's own "live backend not configured" — neither is a
          // failed scan, and neither may leave the strip claiming a scan.
          if (res.status === 401 || res.status === 403) {
            setError('Authentication required — sign in again to scan this repo.')
            setPhase('auth-required')
            return
          }
          if (res.status === 503) {
            setError(payload?.error ?? 'Repo intelligence backend not configured.')
            setPhase('unavailable')
            return
          }
          setError(payload?.error ?? `Scan failed (${res.status}).`)
          setPhase('error')
          return
        }
        if (!payload.hasRepo) {
          setPhase('no-repo')
          return
        }
        setData(payload)
        setPhase('ready')
      } catch {
        // The request never completed: nothing was read, so nothing is known.
        setError('Repo intelligence unreachable — the request did not complete.')
        setPhase('unavailable')
      }
    },
    [projectId]
  )

  useEffect(() => {
    if (!repoFullName || startedRef.current) return
    startedRef.current = true
    void scan(false)
  }, [repoFullName, scan])

  return {
    phase,
    data,
    error,
    scan,
    intel: data?.intelligence ?? null,
    summaryLine: data?.intelligence ? intelSummaryLine(data.intelligence) : null,
    scannedAtLabel: formatScanAge(data?.scannedAt ?? null),
  }
}

/**
 * Action bar for repo intelligence — View repo map / Suggestions / Retry scan
 * + their dialogs. Split out from the compact strip so a caller (e.g. the
 * Builder workbench) can render the status strip at the top of a panel and
 * this actions bar at the bottom, without duplicating scan state.
 */
export function ProjectRepoIntelligenceActions({
  projectId,
  repoFullName,
  onDiscussRecommendation,
  intelligenceState,
  className,
}: {
  projectId: string
  repoFullName: string | null
  onDiscussRecommendation?: (rec: AgentRecommendation) => void
  intelligenceState: ReturnType<typeof useProjectRepoIntelligence>
  className?: string
}) {
  const { phase, scan, intel } = intelligenceState
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [repoMapOpen, setRepoMapOpen] = useState(false)

  if (!repoFullName) return null

  const recCount = intel?.recommendations.length ?? 0

  return (
    <>
      <div className={clsx('flex flex-wrap items-center justify-end gap-2', className)}>
        <Button outline disabled={!intel} onClick={() => setRepoMapOpen(true)}>
          View repo map
        </Button>
        <Button outline disabled={!intel || recCount === 0} onClick={() => setSuggestionsOpen(true)}>
          Suggestions{recCount > 0 ? ` (${recCount})` : ''}
        </Button>
        <Button outline disabled={phase === 'scanning'} onClick={() => scan(true)}>
          {phase === 'scanning' ? (
            <>
              <Spinner className="size-3.5" />
              Scanning…
            </>
          ) : (
            'Retry scan'
          )}
        </Button>
      </div>

      <ProjectBuilderSuggestionsDrawer
        open={suggestionsOpen}
        onClose={() => setSuggestionsOpen(false)}
        recommendations={intel?.recommendations ?? []}
        onDiscuss={
          onDiscussRecommendation ??
          ((rec) => {
            window.location.href = `/admin/projects/${projectId}/builder?seed=${encodeURIComponent(rec.title)}`
          })
        }
      />

      <Dialog open={repoMapOpen} onClose={() => setRepoMapOpen(false)} size="4xl">
        <DialogTitle>Repo map</DialogTitle>
        <DialogDescription>
          Read-only structural map for <span className="font-mono">{repoFullName}</span> — bounded scan, not exhaustive.
        </DialogDescription>
        <DialogBody className="max-h-[min(75vh,720px)] space-y-6 overflow-y-auto">
          {intel ? (
            <>
              <RepoMapView map={intel.map} />
              <AgenticFootprintView footprint={intel.footprint} />
              <ResidueView findings={intel.residue} />
            </>
          ) : (
            <p className="text-sm text-zinc-500">Scan in progress…</p>
          )}
        </DialogBody>
        <DialogActions>
          <Button plain onClick={() => setRepoMapOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

/**
 * Project overview — repo-intelligence footer strip of the ProjectHeader:
 * scan status on the left, ALL actions (Discuss with Builder + repo map /
 * suggestions / retry) on the right. No own card — the header hosts it.
 */
export function ProjectRepoIntelligence({
  projectId,
  repoFullName,
}: {
  projectId: string
  repoFullName: string | null
}) {
  const intelligenceState = useProjectRepoIntelligence(projectId, repoFullName)
  const { phase, error, intel, summaryLine, scannedAtLabel } = intelligenceState

  if (!repoFullName) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Link a GitHub repo to enable read-only intelligence and Builder suggestions.
      </p>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2" aria-live="polite">
            {/* Success is rendered for `ready` and NOTHING else. The accent hue
                and the scan age are claims about a scan that completed; every
                other phase states what actually happened, in zinc. */}
            {phase === 'scanning' ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                <Spinner className="size-3.5" />
                Scanning repo…
              </span>
            ) : phase === 'ready' ? (
              <span className="text-xs font-medium text-accent-700 dark:text-accent-300">
                Repo scanned · {scannedAtLabel}
              </span>
            ) : (
              <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {PHASE_STATUS_LABELS[phase]}
              </span>
            )}
            {phase === 'ready' && intel ? (
              <Badge color="zinc" className="!text-[10px]">
                {intel.footprint.hasAgenticCode ? 'agentic code' : 'no agentic code'}
              </Badge>
            ) : null}
          </div>
          {/* The summary describes the LAST successful scan; under a failed
              rescan it would read as the current state of the repo. */}
          {phase === 'ready' && summaryLine ? (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{summaryLine}</p>
          ) : phase === 'scanning' ? (
            <p className="mt-1 text-xs text-zinc-500">Reading tree and key files read-only…</p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ProjectRepoIntelligenceActions
            projectId={projectId}
            repoFullName={repoFullName}
            intelligenceState={intelligenceState}
          />
          <Button color="accent" href={`/admin/projects/${projectId}/builder`}>
            Discuss with Builder
          </Button>
        </div>
      </div>
      {FAILED_PHASES.has(phase) ? (
        <div className="mt-3">
          <ErrorBanner message={error ?? PHASE_STATUS_LABELS[phase]} />
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Detail views (used inside repo-map dialog)
// ---------------------------------------------------------------------------

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <span className="text-sm text-zinc-500">{empty}</span>
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <Badge key={item} color="zinc">
          {item}
        </Badge>
      ))}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-1.5">{children}</dd>
    </div>
  )
}

function RepoMapView({ map }: { map: RepoMap }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
      <Field label="Stack">
        <Chips items={map.stack} empty="unknown" />
      </Field>
      <Field label="Package manager">
        <span className="text-sm text-zinc-800 dark:text-zinc-200">{map.packageManager ?? 'unknown'}</span>
      </Field>
      <Field label="Scripts">
        <Chips items={Object.keys(map.scripts)} empty="none" />
      </Field>
      <Field label="Design system">
        <Chips items={map.designSystemSignals} empty="no signals" />
      </Field>
      <Field label={`App routes (${map.appRoutes.length})`}>
        <span className="text-sm text-zinc-800 dark:text-zinc-200">{map.appRoutes.length} pages/layouts</span>
      </Field>
      <Field label={`API routes (${map.apiRoutes.length})`}>
        <span className="text-sm text-zinc-800 dark:text-zinc-200">{map.apiRoutes.length} handlers</span>
      </Field>
      <Field label={`Components (${map.components.length}) · lib (${map.libModules.length})`}>
        <span className="text-sm text-zinc-800 dark:text-zinc-200">
          {map.components.length} components, {map.libModules.length} lib modules
        </span>
      </Field>
      <Field label={`Tests (${map.tests.length}) · docs (${map.docs.length})`}>
        <span className="text-sm text-zinc-800 dark:text-zinc-200">
          {map.tests.length} test files, {map.docs.length} docs
        </span>
      </Field>
      <Field label="Env signals">
        <Chips items={map.envSignals} empty="none referenced" />
      </Field>
      <Field label="Risk notes">
        {map.riskNotes.length === 0 ? (
          <span className="text-sm text-zinc-500">none</span>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            {map.riskNotes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        )}
      </Field>
    </dl>
  )
}

function AgenticFootprintView({ footprint }: { footprint: AgenticFootprint }) {
  return (
    <AgentSectionCard
      title="Agentic footprint"
      description="Existing agent logic detected in the repo."
      actions={
        <Badge color={footprint.hasAgenticCode ? 'accent' : 'zinc'}>
          {footprint.hasAgenticCode ? 'Present' : 'None'}
        </Badge>
      }
    >
      <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        <Field label="Frameworks">
          <Chips items={footprint.frameworks} empty="none" />
        </Field>
        <Field label={`Graphs (${footprint.graphs.length})`}>
          <Chips items={footprint.graphs.slice(0, 6)} empty="none" />
        </Field>
        <Field label={`Tools (${footprint.tools.length})`}>
          <Chips items={footprint.tools.slice(0, 6)} empty="none" />
        </Field>
      </dl>
    </AgentSectionCard>
  )
}

const SEVERITY_ORDER: Record<ResidueFinding['severity'], number> = { high: 0, medium: 1, low: 2 }

function ResidueView({ findings }: { findings: ResidueFinding[] }) {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return (
    <AgentSectionCard
      title="Residue signals"
      description="Signalled only — review manually."
      actions={<Badge color={findings.length === 0 ? 'accent' : 'zinc'}>{findings.length} finding(s)</Badge>}
    >
      {findings.length === 0 ? (
        <p className="text-sm text-zinc-500">No residue signals detected.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.slice(0, 8).map((f, i) => (
            <li
              key={`${f.path}-${i}`}
              className={clsx(surfaceInsetClass, 'p-2.5 text-xs')}
            >
              <span className="font-mono text-zinc-700 dark:text-zinc-300">{f.path}</span>
              <span className="text-zinc-500"> — {f.evidence}</span>
            </li>
          ))}
        </ul>
      )}
    </AgentSectionCard>
  )
}
