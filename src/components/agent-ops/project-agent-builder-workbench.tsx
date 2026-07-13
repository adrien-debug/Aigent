'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

// Mirror of the server shapes (repo-scan.ts / agent-builder-run.ts).
interface RepoScanSummary {
  projectId: string
  repo: string
  branch: string
  stack: string[]
  scripts: Record<string, string>
  routes: string[]
  apiRoutes: string[]
  components: string[]
  tests: string[]
  designSystemSignals: string[]
  riskNotes: string[]
  scannedAt: string
}
interface ProposedTool { name: string; riskLevel: string; requiresConfirmation: boolean }
interface TestCase { name: string; expectedBehavior?: string }
interface ManifestDraft {
  name?: string
  description?: string
  suggestedRuntime?: string
  suggestedModel?: string
  systemPromptSummary?: string
  confirmationPolicy?: string
  maxStepsPerRun?: number
}
interface ReleaseProposal {
  proposedFiles: { path: string; why: string }[]
  risks: string[]
  validationCommands: string[]
  branch: string
  prTitle: string
  prBody: string
  prCreation: 'ships-next'
}
interface BuilderRunState {
  runId: string
  status: 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'running'
  currentNode: string
  events: { title: string; detail: string; status: string }[]
  manifestDraft: ManifestDraft | null
  selectedTools: ProposedTool[]
  testCases: TestCase[]
  risks: string[]
  approvalRequired: boolean
  approvalMessage: string | null
  pendingTool: { name: string; argumentsSummary: string; risk?: string } | null
  finalText: string
  createdCopilotId: string | null
  projectId: string | null
  releaseProposal: ReleaseProposal | null
}

const TOOL_RISK_LEVELS: readonly ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']
function asToolRisk(risk: string | undefined): ToolRiskLevel | undefined {
  return risk !== undefined && (TOOL_RISK_LEVELS as readonly string[]).includes(risk)
    ? (risk as ToolRiskLevel)
    : undefined
}

const EXAMPLE =
  'Create a QA agent for this repo that prepares release checklists, reads package scripts, refuses force-push, and produces PR-ready release notes.'

/**
 * Repo-aware Agent Builder workbench for a Project. Scans the linked GitHub repo
 * (read-only), shows the summary, then drafts an agent CONTEXTUALIZED to the
 * repo — with a release proposal (files, validation commands from the repo's
 * real scripts, PR title/body). Every action hits a REAL route; nothing is
 * pushed to GitHub, nothing is created before approval.
 */
export function ProjectAgentBuilderWorkbench({
  projectId,
  projectName,
  repoFullName,
  initialScan,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  initialScan: RepoScanSummary | null
}) {
  const router = useRouter()
  const [scan, setScan] = useState<RepoScanSummary | null>(initialScan)
  const [scanning, setScanning] = useState(false)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<BuilderRunState | null>(null)

  async function handleScan() {
    if (scanning) return
    setScanning(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/repo/scan`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Scan failed (${res.status}).`)
        return
      }
      setScan(data.scan as RepoScanSummary)
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setScanning(false)
    }
  }

  async function handleRun() {
    if (running || input.trim().length === 0) return
    setRunning(true)
    setError(null)
    setState(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput: input, scan: scan ?? undefined }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Run failed (${res.status}).`)
        return
      }
      if (data.scan) setScan(data.scan as RepoScanSummary)
      setState(data as BuilderRunState)
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setRunning(false)
    }
  }

  async function handleDecision(approved: boolean) {
    if (deciding || !state?.runId) return
    setDeciding(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: state.runId, approved }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        if (data && typeof data === 'object' && 'status' in data) setState(data as BuilderRunState)
        setError(data?.persistError ?? data?.error ?? `Decision failed (${res.status}).`)
        return
      }
      setState(data as BuilderRunState)
      if (approved) router.refresh()
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setDeciding(false)
    }
  }

  const awaiting = state?.status === 'awaiting_approval'
  const draft = state?.manifestDraft ?? null
  const release = state?.releaseProposal ?? null

  return (
    <div className="space-y-6">
      {/* Repo card + scan */}
      <AgentSectionCard
        title="Linked repository"
        description={repoFullName ? `${projectName} → ${repoFullName}` : `${projectName} — no linked repo`}
        actions={
          repoFullName ? (
            <Button color="accent" onClick={handleScan} disabled={scanning}>
              {scanning ? (
                <>
                  <Spinner />
                  Scanning…
                </>
              ) : scan ? (
                'Re-scan repo'
              ) : (
                'Scan repo'
              )}
            </Button>
          ) : undefined
        }
      >
        {scan ? (
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Row label="Repo" value={`${scan.repo} @ ${scan.branch}`} mono />
            <Row label="Stack" value={scan.stack.join(', ') || '—'} />
            <Row label="Scripts (gates)" value={Object.keys(scan.scripts).join(', ') || '—'} mono />
            <Row label="API routes" value={String(scan.apiRoutes.length)} />
            <Row label="Pages" value={String(scan.routes.length)} />
            <Row label="Components" value={String(scan.components.length)} />
            <Row label="Test files" value={String(scan.tests.length)} />
            <Row label="Design system" value={scan.designSystemSignals.join('; ') || '—'} />
            {scan.riskNotes.length > 0 ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Risk notes</dt>
                <dd className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{scan.riskNotes.join(' · ')}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <Text>{repoFullName ? 'Run a read-only scan to summarise the repo for the builder.' : 'This project has no linked GitHub repo.'}</Text>
        )}
      </AgentSectionCard>

      {/* Request input */}
      <AgentSectionCard
        title="Describe the agent to build for this repo"
        description="Agent Builder uses the repo scan to draft a repo-aware agent — with human approval before anything is created."
      >
        <Field>
          <Label>Agent request</Label>
          <Textarea
            name="project-builder-input"
            rows={4}
            placeholder={EXAMPLE}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
          />
        </Field>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button color="accent" onClick={handleRun} disabled={running || input.trim().length === 0}>
            {running ? (
              <>
                <Spinner />
                Running Project Agent Builder…
              </>
            ) : (
              'Run Project Agent Builder'
            )}
          </Button>
          <Button plain onClick={() => setInput(EXAMPLE)} disabled={running}>
            Use example
          </Button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </AgentSectionCard>

      {/* Timeline */}
      {state ? (
        <AgentSectionCard
          title="LangGraph timeline"
          description={`Run ${state.runId.slice(0, 12)}… · ${state.status} · node: ${state.currentNode}`}
        >
          {state.events.length > 0 ? (
            <ul className="space-y-2">
              {state.events.map((ev, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className={
                      'mt-1.5 size-1.5 shrink-0 rounded-full ' +
                      (ev.status === 'blocked' ? 'bg-accent-500' : ev.status === 'error' ? 'bg-accent-700' : 'bg-zinc-400 dark:bg-zinc-500')
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-950 dark:text-white">{ev.title}</p>
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{ev.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Text>No events yet.</Text>
          )}
        </AgentSectionCard>
      ) : null}

      {/* Approval gate */}
      {awaiting ? (
        <div role="alert" className="rounded-xl bg-[var(--copper-soft)] p-5 ring-1 ring-[var(--copper-line)]">
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
            Human approval required — nothing created yet
          </p>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
            {state?.approvalMessage ?? 'Approve to create the repo-aware draft, or reject.'}
          </p>
          {state?.pendingTool ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <ToolBadge name={state.pendingTool.name} risk={asToolRisk(state.pendingTool.risk)} />
              <code className="line-clamp-2 max-w-full rounded-md bg-zinc-950/5 px-1.5 py-0.5 font-mono text-xs break-words text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
                {state.pendingTool.argumentsSummary}
              </code>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button color="accent" onClick={() => handleDecision(true)} disabled={deciding}>
              {deciding ? (
                <>
                  <Spinner />
                  Creating draft…
                </>
              ) : (
                'Approve & create draft'
              )}
            </Button>
            <Button plain onClick={() => handleDecision(false)} disabled={deciding}>
              Reject
            </Button>
          </div>
        </div>
      ) : null}

      {/* Created receipt */}
      {state?.createdCopilotId ? (
        <div className="rounded-xl bg-zinc-950 p-5 ring-1 ring-white/10">
          <p className="text-xs font-medium tracking-wide text-accent-300 uppercase">Draft agent created for this project</p>
          <p className="mt-2 text-sm text-zinc-300">
            A repo-aware draft agent is now attached to {projectName} (status draft, not production).
          </p>
          <Link
            href={`/admin/agents/${state.createdCopilotId}`}
            className="mt-3 inline-flex text-sm font-medium text-accent-400 hover:text-accent-300"
          >
            Open the drafted agent →
          </Link>
        </div>
      ) : null}

      {/* Draft panels */}
      {draft ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <AgentSectionCard title="Manifest draft" description="The proposed repo-aware agent.">
            <dl className="space-y-3 text-sm">
              <Row label="Name" value={draft.name} />
              <Row label="Description" value={draft.description} />
              <Row label="Runtime" value={draft.suggestedRuntime} mono />
              <Row label="Model" value={draft.suggestedModel} mono />
              <Row label="System prompt" value={draft.systemPromptSummary} />
            </dl>
          </AgentSectionCard>

          <AgentSectionCard title="Proposed tools" description="Read-only first; write tools flagged + gated.">
            {state && state.selectedTools.length > 0 ? (
              <ul className="space-y-2">
                {state.selectedTools.map((t) => (
                  <li key={t.name} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ToolBadge name={t.name} risk={asToolRisk(t.riskLevel)} />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t.requiresConfirmation ? 'requires confirmation' : 'read-only'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Text>No tools proposed yet.</Text>
            )}
          </AgentSectionCard>

          <AgentSectionCard title="Proposed tests" description="Starter behaviour + safety suite.">
            {state && state.testCases.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {state.testCases.map((c, i) => (
                  <li key={i} className="border-b border-zinc-950/5 pb-2 last:border-0 dark:border-white/5">
                    <p className="font-medium text-zinc-950 dark:text-white">{c.name}</p>
                    {c.expectedBehavior ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.expectedBehavior}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Text>No tests proposed yet.</Text>
            )}
          </AgentSectionCard>

          <AgentSectionCard title="Risk review" description="Forbidden actions + any write/risky tool.">
            {state && state.risks.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {state.risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent-500" />
                    <span className="text-zinc-700 dark:text-zinc-300">{r}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Text>No risks flagged.</Text>
            )}
          </AgentSectionCard>
        </div>
      ) : null}

      {/* Release proposal */}
      {release ? (
        <AgentSectionCard
          title="Release proposal"
          description="What shipping this agent would add — no code is pushed. PR creation ships next."
        >
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Proposed files</p>
              <ul className="mt-1.5 space-y-1">
                {release.proposedFiles.map((f) => (
                  <li key={f.path}>
                    <code className="font-mono text-xs text-zinc-950 dark:text-white">{f.path}</code>
                    <span className="text-zinc-500 dark:text-zinc-400"> — {f.why}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Validation commands</p>
              <ul className="mt-1.5 flex flex-wrap gap-2">
                {release.validationCommands.map((c) => (
                  <li key={c} className="rounded-md bg-zinc-950/5 px-2 py-1 font-mono text-xs dark:bg-white/5">{c}</li>
                ))}
              </ul>
            </div>
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <Row label="Proposed branch" value={release.branch} mono />
              <Row label="PR title" value={release.prTitle} />
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">PR body</p>
              <pre className="mt-1.5 overflow-x-auto rounded-lg bg-zinc-950/5 p-3 text-xs whitespace-pre-wrap text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
                {release.prBody}
              </pre>
            </div>
            <div className="rounded-lg bg-[var(--copper-soft)] px-3 py-2 ring-1 ring-[var(--copper-line)]">
              <p className="text-xs text-accent-700 dark:text-accent-300">
                Create PR ships next — no direct push to main. This proposal is a plan awaiting explicit approval.
              </p>
            </div>
          </div>
        </AgentSectionCard>
      ) : null}

      {/* Final text */}
      {state && !awaiting && state.finalText ? (
        <AgentSectionCard title="Agent Builder response" description={state.status}>
          <p className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{state.finalText}</p>
        </AgentSectionCard>
      ) : null}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs break-all' : '')}>{value}</dd>
    </div>
  )
}
