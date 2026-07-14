'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
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

type Phase = 'idle' | 'scanning' | 'ready' | 'error' | 'no-repo'

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
        setError('Live backend not configured.')
        setPhase('error')
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
 * Compact repo-intelligence strip — scan status + actions, no recommendation wall.
 */
export function ProjectRepoIntelligenceCompact(
  props: {
    projectId: string
    repoFullName: string | null
    onDiscussRecommendation?: (rec: AgentRecommendation) => void
    showBuilderLink?: boolean
    intelligenceState?: ReturnType<typeof useProjectRepoIntelligence>
  }
) {
  if (props.intelligenceState) {
    return <ProjectRepoIntelligenceCompactView {...props} state={props.intelligenceState} />
  }
  return <ProjectRepoIntelligenceCompactWithFetch {...props} />
}

function ProjectRepoIntelligenceCompactWithFetch(
  props: Omit<Parameters<typeof ProjectRepoIntelligenceCompactView>[0], 'state'>
) {
  const state = useProjectRepoIntelligence(props.projectId, props.repoFullName)
  return <ProjectRepoIntelligenceCompactView {...props} state={state} />
}

function ProjectRepoIntelligenceCompactView({
  projectId,
  repoFullName,
  onDiscussRecommendation,
  showBuilderLink = false,
  state,
}: {
  projectId: string
  repoFullName: string | null
  onDiscussRecommendation?: (rec: AgentRecommendation) => void
  showBuilderLink?: boolean
  state: ReturnType<typeof useProjectRepoIntelligence>
}) {
  const { phase, error, scan, intel, summaryLine, scannedAtLabel } = state
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [repoMapOpen, setRepoMapOpen] = useState(false)

  if (!repoFullName) {
    return (
      <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Link a GitHub repo to enable read-only intelligence and Builder suggestions.
        </p>
      </div>
    )
  }

  const recCount = intel?.recommendations.length ?? 0

  return (
    <>
      <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {phase === 'scanning' ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                  <Spinner className="size-3.5" />
                  Scanning repo…
                </span>
              ) : (
                <span className="text-xs font-medium text-accent-700 dark:text-accent-300">
                  Repo scanned · {scannedAtLabel}
                </span>
              )}
              {intel ? (
                <Badge color="zinc" className="!text-[10px]">
                  {intel.footprint.hasAgenticCode ? 'agentic code' : 'no agentic code'}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 truncate font-mono text-xs text-zinc-500">{repoFullName}</p>
            {summaryLine ? (
              <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{summaryLine}</p>
            ) : phase === 'scanning' ? (
              <p className="mt-1 text-xs text-zinc-500">Reading tree and key files read-only…</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {showBuilderLink ? (
              <Button color="accent" href={`/admin/projects/${projectId}/builder`}>
                Discuss with Builder
              </Button>
            ) : null}
            <Button outline disabled={!intel} onClick={() => setRepoMapOpen(true)}>
              View repo map
            </Button>
            <Button
              outline
              disabled={!intel || recCount === 0}
              onClick={() => setSuggestionsOpen(true)}
            >
              Suggestions{recCount > 0 ? ` (${recCount})` : ''}
            </Button>
            <Button outline disabled={phase === 'scanning'} onClick={() => scan(true)}>
              Retry scan
            </Button>
          </div>
        </div>
        {phase === 'error' ? (
          <div className="mt-3">
            <ErrorBanner message={error ?? 'Scan failed.'} />
          </div>
        ) : null}
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
 * Project overview — compact intelligence only (no recommendation wall in the body).
 */
export function ProjectRepoIntelligence({
  projectId,
  repoFullName,
}: {
  projectId: string
  repoFullName: string | null
}) {
  return (
    <ProjectRepoIntelligenceCompact projectId={projectId} repoFullName={repoFullName} showBuilderLink />
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
              className="rounded-lg bg-zinc-950/[0.03] p-2.5 text-xs ring-1 ring-zinc-950/5 dark:bg-white/[0.03] dark:ring-white/10"
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
