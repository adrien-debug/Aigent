'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
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

/**
 * The repo-intelligence surface for a Project. On mount it hits GET
 * …/repo/intelligence, which auto-scans READ-ONLY when the cache is missing or
 * stale (>24h / new commit) and returns the structured map + agentic footprint +
 * residue findings + agent recommendations. A manual "Retry scan" forces a fresh
 * scan (POST). Everything is read-only; nothing here writes GitHub or creates
 * an agent — recommendations deep-link into the conversational builder.
 */
export function ProjectRepoIntelligence({
  projectId,
  repoFullName,
}: {
  projectId: string
  repoFullName: string | null
}) {
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

  // Auto-scan on open — exactly once (guard against StrictMode double-mount).
  useEffect(() => {
    if (!repoFullName || startedRef.current) return
    startedRef.current = true
    void scan(false)
  }, [repoFullName, scan])

  if (phase === 'no-repo') {
    return (
      <AgentSectionCard title="Repo intelligence" description="This project has no linked GitHub repo yet.">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Link a repo to this project to enable the automatic read-only scan (stack, routes, agentic footprint, residue,
          and agent recommendations).
        </p>
      </AgentSectionCard>
    )
  }

  const intel = data?.intelligence ?? null

  return (
    <div className="space-y-6">
      <AgentSectionCard
        title="Repo intelligence"
        description={
          <span>
            <span className="font-mono">{repoFullName}</span>
            {data?.scannedAt ? ` · last scanned ${new Date(data.scannedAt).toLocaleString()}` : ''}
            {data?.rescanned ? ' · freshly scanned' : data && !data.rescanned ? ` · cached (${data.staleness})` : ''}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {phase === 'scanning' ? (
              <span className="inline-flex items-center gap-2 text-xs text-zinc-500">
                <Spinner className="size-4" /> Scanning repo…
              </span>
            ) : null}
            <Button outline disabled={phase === 'scanning'} onClick={() => scan(true)}>
              {phase === 'scanning' ? 'Scanning…' : 'Retry scan'}
            </Button>
          </div>
        }
      >
        {phase === 'error' ? (
          <ErrorBanner message={error ?? 'Scan failed.'} />
        ) : phase === 'scanning' && !intel ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Reading the repo tree and key files read-only — this takes a moment.
          </p>
        ) : intel ? (
          <RepoMapView map={intel.map} />
        ) : null}
      </AgentSectionCard>

      {intel ? (
        <>
          <AgenticFootprintView footprint={intel.footprint} />
          <ResidueView findings={intel.residue} />
          <RecommendationsView projectId={projectId} recommendations={intel.recommendations} />
        </>
      ) : null}
    </div>
  )
}

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
      description="Existing agent logic detected in the repo — clean or stale."
      actions={<Badge color={footprint.hasAgenticCode ? 'accent' : 'zinc'}>{footprint.hasAgenticCode ? 'Agentic code present' : 'No agentic code'}</Badge>}
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
        <Field label={`Manifests (${footprint.manifests.length}) · prompts (${footprint.prompts.length})`}>
          <span className="text-sm text-zinc-800 dark:text-zinc-200">
            {footprint.manifests.length} manifests, {footprint.prompts.length} prompts
          </span>
        </Field>
        <Field label={`Evals (${footprint.evals.length}) · runners (${footprint.runners.length})`}>
          <span className="text-sm text-zinc-800 dark:text-zinc-200">
            {footprint.evals.length} eval/judge/benchmark, {footprint.runners.length} runners
          </span>
        </Field>
        <Field label={`Agentic routes (${footprint.routes.length})`}>
          <span className="text-sm text-zinc-800 dark:text-zinc-200">{footprint.routes.length} routes</span>
        </Field>
        {footprint.risks.length > 0 ? (
          <div className="sm:col-span-2">
            <Field label="Risks">
              <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                {footprint.risks.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
              </ul>
            </Field>
          </div>
        ) : null}
      </dl>
    </AgentSectionCard>
  )
}

const SEVERITY_ORDER: Record<ResidueFinding['severity'], number> = { high: 0, medium: 1, low: 2 }

function ResidueView({ findings }: { findings: ResidueFinding[] }) {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return (
    <AgentSectionCard
      title="Residue & dead code"
      description="Signalled, never removed — review and act manually."
      actions={<Badge color={findings.length === 0 ? 'accent' : 'zinc'}>{findings.length === 0 ? 'Clean' : `${findings.length} finding(s)`}</Badge>}
    >
      {findings.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No residue or dead-code signals detected.</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((f, i) => (
            <li key={`${f.path}-${i}`} className="rounded-lg bg-zinc-950/[0.03] p-3 ring-1 ring-zinc-950/5 dark:bg-white/[0.03] dark:ring-white/10">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={f.severity === 'high' ? 'accent' : 'zinc'}>{f.severity}</Badge>
                <span className="text-xs text-zinc-500">{f.type.replace(/_/g, ' ')}</span>
                <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">{f.path}</span>
              </div>
              <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">{f.evidence}</p>
              <p className="mt-1 text-xs text-zinc-500">→ {f.recommendedAction}</p>
            </li>
          ))}
        </ul>
      )}
    </AgentSectionCard>
  )
}

const PRIORITY_ORDER: Record<AgentRecommendation['priority'], number> = { high: 0, medium: 1, low: 2 }

function RecommendationsView({
  projectId,
  recommendations,
}: {
  projectId: string
  recommendations: AgentRecommendation[]
}) {
  const sorted = [...recommendations].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
  return (
    <AgentSectionCard
      title="Recommended agents"
      description="Agents that would be useful for this repo, ranked by priority. Open the builder to discuss and draft one — nothing is created here."
      actions={
        <Button color="accent" href={`/admin/projects/${projectId}/builder`}>
          Open Agent Builder
        </Button>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No agent is clearly justified by this repo yet — the builder can still draft one on request.
        </p>
      ) : (
        <ul className="space-y-4">
          {sorted.map((rec) => (
            <li key={rec.id} className="rounded-lg ring-1 ring-zinc-950/5 dark:ring-white/10">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-950/5 px-4 py-2.5 dark:border-white/10">
                <div className="flex items-center gap-2">
                  <Badge color={rec.priority === 'high' ? 'accent' : 'zinc'}>{rec.priority}</Badge>
                  <span className="text-sm font-medium text-zinc-950 dark:text-white">{rec.title}</span>
                </div>
                <Link
                  href={`/admin/projects/${projectId}/builder?seed=${encodeURIComponent(rec.title)}`}
                  className="text-xs font-medium text-accent-700 hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-300"
                >
                  Discuss in builder →
                </Link>
              </div>
              <div className="space-y-2 px-4 py-3">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{rec.why}</p>
                <p className="text-xs text-zinc-500">Role: {rec.proposedRole}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-500">
                  <span>Tools: {rec.toolsNeeded.join(', ')}</span>
                  <span>Tests: {rec.testsNeeded.join('; ')}</span>
                </div>
                <p className="text-xs text-zinc-500">Value: {rec.releaseValue}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AgentSectionCard>
  )
}
