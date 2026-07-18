'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { LangGraphDebugPanel, type LangGraphDebugInfo } from '@/components/agent-ops/langgraph-debug-panel'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

// ---------------------------------------------------------------------------
// The normalized run state the /architect routes return (mirror of
// BuilderRunState in src/lib/agent-mission-control/agent-builder-run.ts).
// ---------------------------------------------------------------------------

interface BuilderEvent {
  kind: 'llm-call' | 'tool-call' | 'guardrail-check' | 'confirmation' | 'output'
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
}
interface ProposedTool {
  name: string
  riskLevel: string
  requiresConfirmation: boolean
  provider?: string
}
interface TestCase {
  name: string
  kind?: string
  expectedBehavior?: string
}
interface ManifestDraft {
  name?: string
  description?: string
  suggestedRuntime?: string
  suggestedModel?: string
  systemPromptSummary?: string
  allowedRoutes?: string[]
  forbiddenActions?: string[]
  confirmationPolicy?: string
  maxStepsPerRun?: number
  maxCostPerRunUsd?: number
}
interface BuilderRunState {
  runId: string
  status: 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'running'
  currentNode: string
  events: BuilderEvent[]
  manifestDraft: ManifestDraft | null
  selectedTools: ProposedTool[]
  testCases: TestCase[]
  risks: string[]
  approvalRequired: boolean
  approvalMessage: string | null
  pendingTool: { name: string; argumentsSummary: string; risk?: string } | null
  finalText: string
  createdCopilotId: string | null
  langgraph?: LangGraphDebugInfo
}

const TOOL_RISK_LEVELS: readonly ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']
function asToolRisk(risk: string | undefined): ToolRiskLevel | undefined {
  return risk !== undefined && (TOOL_RISK_LEVELS as readonly string[]).includes(risk)
    ? (risk as ToolRiskLevel)
    : undefined
}

// The intended node pipeline — shown as a static reference rail so the operator
// always sees where a run is in the flow, even before it starts.
const PIPELINE = [
  'understand_request',
  'draft_manifest',
  'select_tools',
  'create_tests',
  'risk_review',
  'human_approval',
  'create_draft_copilot',
  'final_report',
] as const

const STATUS_LABEL: Record<BuilderRunState['status'], string> = {
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  blocked: 'Blocked',
  failed: 'Failed',
  running: 'Running',
}

const EXAMPLE = 'Create a read-only Portfolio QA Copilot for a portfolio dashboard.'

/**
 * Agent Builder workbench — drive the Agent Builder Copilot from natural
 * language, watch the LangGraph nodes run, review the drafted manifest / tools /
 * tests / risks, and approve (materialize a draft copilot) or reject. Every
 * action hits a REAL route (/architect/run, /architect/resume) — no mock.
 */
export function AgentBuilderWorkbench() {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<BuilderRunState | null>(null)

  async function handleRun() {
    if (running || input.trim().length === 0) return
    setRunning(true)
    setError(null)
    setState(null)
    try {
      const res = await fetch('/api/agent-ops/architect/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userInput: input }),
      })
      if (res.status === 503) {
        setError('Live backend not configured.')
        return
      }
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Run failed (${res.status}).`)
        return
      }
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
      const res = await fetch('/api/agent-ops/architect/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: state.runId, approved }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // A 502 with a state body still carries the run outcome — surface both.
        if (data && typeof data === 'object' && 'status' in data) setState(data as BuilderRunState)
        setError(data?.persistError ?? data?.error ?? `Decision failed (${res.status}).`)
        return
      }
      setState(data as BuilderRunState)
      if (approved) router.refresh() // a new draft copilot may now exist
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setDeciding(false)
    }
  }

  const awaiting = state?.status === 'awaiting_approval'
  const draft = state?.manifestDraft ?? null

  return (
    <div className="space-y-6">
      {/* 1 — Request input */}
      <AgentSectionCard
        title="Describe the copilot to build"
        description="Agent Builder drafts a new copilot from your description — safely, with human approval before anything is created."
      >
        <Field>
          <Label>Agent request</Label>
          <Textarea
            name="builder-input"
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
                Running Agent Builder…
              </>
            ) : (
              'Run Agent Builder'
            )}
          </Button>
          <Button plain onClick={() => setInput(EXAMPLE)} disabled={running}>
            Use example
          </Button>
          {running ? (
            <Text className="!mt-0" role="status" aria-live="polite">
              Driving the LangGraph nodes on a live model…
            </Text>
          ) : null}
        </div>
        {error ? <ErrorBanner message={error} /> : null}
      </AgentSectionCard>

      {/* 2 — Node timeline */}
      <AgentSectionCard
        title="LangGraph timeline"
        description={
          state
            ? `Run ${state.runId.slice(0, 12)}… · ${STATUS_LABEL[state.status]} · node: ${state.currentNode}`
            : 'The intended node pipeline. Run the builder to watch each node execute.'
        }
      >
        {/* Static pipeline rail — always visible so the flow is legible up front. */}
        <ol className="flex flex-wrap gap-2">
          {PIPELINE.map((node) => {
            const reached =
              state != null &&
              (state.events.length > 0 || node === 'understand_request') &&
              pipelineReached(node, state)
            return (
              <li
                key={node}
                className={
                  'rounded-md px-2 py-1 font-mono text-xs ring-1 ' +
                  (reached
                    ? 'bg-[var(--accent-soft)] text-accent-700 ring-[var(--accent-line)] dark:text-accent-300'
                    : 'text-zinc-500 ring-zinc-950/10 dark:text-zinc-400 dark:ring-white/10')
                }
              >
                {node}
              </li>
            )
          })}
        </ol>

        {/* Live events — the actual steps the graph emitted this run. */}
        {state && state.events.length > 0 ? (
          <ul
            role="status"
            aria-live="polite"
            className="mt-5 space-y-2 border-t border-zinc-950/5 pt-4 dark:border-white/5"
          >
            {state.events.map((ev, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={
                    'mt-1.5 size-1.5 shrink-0 rounded-full ' +
                    (ev.status === 'blocked'
                      ? 'bg-accent-500'
                      : ev.status === 'error'
                        ? 'bg-accent-700'
                        : 'bg-zinc-400 dark:bg-zinc-500')
                  }
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-950 dark:text-white">{ev.title}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{ev.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </AgentSectionCard>

      {/* LangGraph debug — where this run runs (graph / thread / assistant / server) */}
      {state?.langgraph ? <LangGraphDebugPanel info={state.langgraph} status={state.status} /> : null}

      {/* 3 — Approval gate (human-in-the-loop) */}
      {awaiting ? (
        <div
          role="alert"
          className="rounded-xl bg-[var(--accent-soft)] p-5 ring-1 ring-[var(--accent-line)]"
        >
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
            Human approval required — nothing created yet
          </p>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
            {state?.approvalMessage ?? 'The builder paused before drafting the copilot. Approve to create the draft, or reject.'}
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
              {deciding ? (
                <>
                  <Spinner />
                  Rejecting…
                </>
              ) : (
                'Reject'
              )}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 4 — Created-copilot receipt */}
      {state?.createdCopilotId ? (
        <div role="status" aria-live="polite" className="rounded-xl bg-zinc-950 p-5 ring-1 ring-white/10">
          <p className="text-xs font-medium tracking-wide text-accent-300 uppercase">Draft copilot created</p>
          <p className="mt-2 text-sm text-zinc-300">
            A new draft copilot is now on the validation bench (not production, not assigned).
          </p>
          <Link
            href={`/admin/agents/${state.createdCopilotId}`}
            className="mt-3 inline-flex min-h-11 items-center rounded-md text-sm font-medium text-accent-400 hover:text-accent-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Open the drafted copilot →
          </Link>
        </div>
      ) : null}

      {/* 5 — Draft panels: manifest / tools / tests / risks */}
      {draft || (state && state.selectedTools.length > 0) ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <AgentSectionCard title="Manifest draft" description="The proposed copilot identity + contract.">
            {draft ? (
              <dl className="space-y-3 text-sm">
                <Row label="Name" value={draft.name} />
                <Row label="Description" value={draft.description} />
                <Row label="Runtime" value={draft.suggestedRuntime} mono />
                <Row label="Model" value={draft.suggestedModel} mono />
                <Row label="Confirmation policy" value={draft.confirmationPolicy} mono />
                <Row label="System prompt" value={draft.systemPromptSummary} />
                {typeof draft.maxStepsPerRun === 'number' ? (
                  <Row label="Max steps / run" value={String(draft.maxStepsPerRun)} mono />
                ) : null}
              </dl>
            ) : (
              <Text>No manifest drafted yet.</Text>
            )}
          </AgentSectionCard>

          <AgentSectionCard title="Proposed tools" description="Read-only first; every write tool is flagged and gated.">
            {state && state.selectedTools.length > 0 ? (
              <ul className="space-y-2">
                {state.selectedTools.map((t) => (
                  <li key={t.name} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <ToolBadge name={t.name} risk={asToolRisk(t.riskLevel)} />
                    {t.requiresConfirmation ? (
                      <span className="text-xs text-accent-700 dark:text-accent-300">requires confirmation</span>
                    ) : (
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">read-only</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <Text>No tools proposed yet.</Text>
            )}
          </AgentSectionCard>

          <AgentSectionCard title="Proposed tests" description="A starter behaviour + safety suite for the draft.">
            {state && state.testCases.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {state.testCases.map((c, i) => (
                  <li key={i} className="border-b border-zinc-950/5 pb-2 last:border-0 dark:border-white/5">
                    <p className="font-medium text-zinc-950 dark:text-white">{c.name}</p>
                    {c.expectedBehavior ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.expectedBehavior}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Text>No tests proposed yet.</Text>
            )}
          </AgentSectionCard>

          <AgentSectionCard title="Risk review" description="Forbidden actions + any write/risky tool the draft carries.">
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

      {/* 6 — Final text (a refusal, or the closing report) */}
      {state && !awaiting && state.finalText ? (
        <AgentSectionCard title="Agent Builder response" description={STATUS_LABEL[state.status]}>
          <p
            role={state.status === 'failed' || state.status === 'blocked' ? 'alert' : 'status'}
            aria-live={state.status === 'failed' || state.status === 'blocked' ? 'assertive' : 'polite'}
            className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300"
          >
            {state.finalText}
          </p>
        </AgentSectionCard>
      ) : null}
    </div>
  )
}

/** Static description-list row (label + value), value optional. */
function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs' : '')}>{value}</dd>
    </div>
  )
}

/**
 * Best-effort "has this pipeline node been reached this run?" for the rail
 * highlight. Maps the graph's observed events onto the logical pipeline: the
 * request is always understood once a run exists; draft/tools/tests light up
 * once a draft was produced; the approval node lights up when awaiting or past
 * it; create_draft/final light up on a completed run with a created copilot.
 */
function pipelineReached(node: (typeof PIPELINE)[number], state: BuilderRunState): boolean {
  const hasDraft = state.manifestDraft != null || state.selectedTools.length > 0
  switch (node) {
    case 'understand_request':
      return true
    case 'draft_manifest':
    case 'select_tools':
    case 'create_tests':
    case 'risk_review':
      return hasDraft || state.approvalRequired
    case 'human_approval':
      return state.approvalRequired || state.status === 'completed' || state.status === 'blocked'
    case 'create_draft_copilot':
      return state.createdCopilotId != null
    case 'final_report':
      return state.status === 'completed' || state.status === 'blocked' || state.status === 'failed'
    default:
      return false
  }
}
