'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { LangGraphDebugPanel, type LangGraphDebugInfo } from '@/components/agent-ops/langgraph-debug-panel'
import { ProjectBuilderPreviewPanel } from '@/components/agent-ops/project-builder-preview-panel'
import { ProjectBuilderSuggestionsDrawer } from '@/components/agent-ops/project-builder-suggestions-drawer'
import {
  ProjectRepoIntelligenceCompact,
  useProjectRepoIntelligence,
} from '@/components/agent-ops/project-repo-intelligence'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import type { AgentRecommendation } from '@/lib/agent-mission-control/repo-intelligence'
import type { ToolRiskLevel } from '@/lib/agent-mission-control/types'

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
  langgraph?: LangGraphDebugInfo
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const TOOL_RISK_LEVELS: readonly ToolRiskLevel[] = ['low', 'medium', 'high', 'critical']
function asToolRisk(risk: string | undefined): ToolRiskLevel | undefined {
  return risk !== undefined && (TOOL_RISK_LEVELS as readonly string[]).includes(risk)
    ? (risk as ToolRiskLevel)
    : undefined
}

const EXAMPLE =
  'I want an agent that watches the design system and flags oversized cards/buttons. What would you recommend for this repo?'

function buildArchitectInput(messages: ChatMessage[], latest: string): string {
  if (messages.length === 0) return latest
  const history = messages
    .slice(-8)
    .map((m) => `${m.role === 'user' ? 'Operator' : 'Architect'}: ${m.content}`)
    .join('\n\n')
  return (
    `You are the repo-aware Agent Builder architect for this project. Discuss options, challenge assumptions, ` +
    `compare trade-offs, and reference repo context. Only prepare a draft spec when the operator explicitly asks ` +
    `(e.g. "prepare the draft", "ok create draft"). Never imply anything was created without human approval.\n\n` +
    `Conversation so far:\n${history}\n\nOperator: ${latest}\n\nArchitect:`
  )
}

function recommendationSeed(rec: AgentRecommendation): string {
  return (
    `I'd like to explore "${rec.title}" for this repo.\n\n` +
    `Context from the scan: ${rec.why}\n` +
    `Proposed role: ${rec.proposedRole}\n\n` +
    `Walk me through options (including a more cautious variant), challenge my assumptions, and explain why this agent would help. ` +
    `Do not prepare a draft yet — I want to discuss first.`
  )
}

function seedFromTitle(title: string): string {
  return (
    `I'm interested in a "${title}" agent for this repo. ` +
    `What would you recommend given the stack and footprint? Compare a cautious read-only option vs a stronger variant. ` +
    `Discuss only — no draft yet.`
  )
}

/**
 * Chat-first Project Builder — repo intelligence is contextual, suggestions live
 * in a drawer, preview is secondary. Same backend routes; nothing created before approval.
 */
export function ProjectAgentBuilderWorkbench({
  projectId,
  projectName,
  repoFullName,
  initialScan,
  seedInput,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  initialScan: RepoScanSummary | null
  seedInput?: string
}) {
  const router = useRouter()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const intelligenceState = useProjectRepoIntelligence(projectId, repoFullName)
  const { intel } = intelligenceState

  const [scan, setScan] = useState<RepoScanSummary | null>(initialScan)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState(seedInput ? seedFromTitle(seedInput) : '')
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<BuilderRunState | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [showDebug, setShowDebug] = useState(false)

  const seedAppliedRef = useRef(false)
  useEffect(() => {
    if (!seedInput || seedAppliedRef.current) return
    seedAppliedRef.current = true
    setInput(seedFromTitle(seedInput))
    inputRef.current?.focus()
  }, [seedInput])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, running, state?.status])

  const handleDiscussRecommendation = useCallback((rec: AgentRecommendation) => {
    const text = recommendationSeed(rec)
    setInput(text)
    setSuggestionsOpen(false)
    inputRef.current?.focus()
  }, [])

  async function handleSend() {
    const trimmed = input.trim()
    if (running || trimmed.length === 0) return

    const userMessage: ChatMessage = { role: 'user', content: trimmed }
    const nextMessages = [...messages, userMessage]
    setMessages(nextMessages)
    setInput('')
    setRunning(true)
    setError(null)

    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput: buildArchitectInput(messages, trimmed),
          scan: scan ?? undefined,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Run failed (${res.status}).`)
        setMessages((prev) => prev.slice(0, -1))
        setInput(trimmed)
        return
      }
      if (data.scan) setScan(data.scan as RepoScanSummary)
      const runState = data as BuilderRunState
      setState(runState)

      const reply =
        runState.finalText?.trim() ||
        runState.approvalMessage?.trim() ||
        (runState.status === 'awaiting_approval'
          ? "I've prepared a draft spec for your review — approve below when you're ready to materialize it (nothing is created until then)."
          : 'Architect responded — see preview for details.')

      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setError('Live backend not reachable.')
      setMessages((prev) => prev.slice(0, -1))
      setInput(trimmed)
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
      if (approved) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.createdCopilotId
              ? `Draft prepared and saved for ${projectName}. Open it from the preview panel — still not in production.`
              : 'Draft approved.',
          },
        ])
        router.refresh()
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: 'Understood — draft rejected. We can iterate on the spec.' }])
      }
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setDeciding(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  const awaiting = state?.status === 'awaiting_approval'
  const draft = state?.manifestDraft ?? null
  const recCount = intel?.recommendations.length ?? 0

  return (
    <div className="flex min-h-[min(72vh,900px)] flex-col gap-4">
      {/* Compact header row — repo status + suggestions entry (no body jump) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProjectRepoIntelligenceCompact
          projectId={projectId}
          repoFullName={repoFullName}
          onDiscussRecommendation={handleDiscussRecommendation}
          intelligenceState={intelligenceState}
        />
        {recCount > 0 ? (
          <Button outline onClick={() => setSuggestionsOpen(true)} className="shrink-0 lg:hidden">
            Suggestions ({recCount})
          </Button>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        {/* Chat — main focus */}
        <section
          aria-label="Agent Builder architect chat"
          className="flex min-h-[420px] min-w-0 flex-col rounded-xl ring-1 ring-zinc-950/5 dark:ring-white/10 lg:min-h-[560px]"
        >
          <div className="border-b border-zinc-950/5 px-4 py-3 dark:border-white/10">
            <p className="text-sm font-medium text-zinc-950 dark:text-white">Architect chat</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Discuss the repo, compare options, challenge the spec — prepare draft only after explicit approval.
            </p>
          </div>

          <div
            role="log"
            aria-live="polite"
            aria-label="Builder conversation"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 ? (
              <div className="space-y-3 text-sm text-zinc-500 dark:text-zinc-400">
                <p>
                  Ask about the repo, request agent ideas, compare options, or say{' '}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">“prepare the draft”</span> when ready.
                </p>
                <p className="text-xs">
                  Examples: “What do you think of this repo?”, “Recommend read-only tools only”, “Compare option A vs B”.
                </p>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={index}
                  className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      message.role === 'user'
                        ? 'max-w-[92%] rounded-2xl rounded-br-sm bg-accent-600 px-4 py-2.5 text-sm text-white sm:max-w-[85%]'
                        : 'max-w-[92%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2.5 text-sm text-zinc-800 dark:bg-white/5 dark:text-zinc-200 sm:max-w-[85%]'
                    }
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))
            )}

            {running ? (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2.5 text-sm text-zinc-500 dark:bg-white/5">
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="size-4" />
                    Architect is thinking…
                  </span>
                </div>
              </div>
            ) : null}

            {awaiting ? (
              <div
                role="alert"
                className="rounded-xl bg-[var(--accent-soft)] p-4 ring-1 ring-[var(--accent-line)]"
              >
                <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                  Approval required — preview only, not created
                </p>
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {state?.approvalMessage ?? 'Approve to prepare the draft after review, or reject to keep discussing.'}
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
                        Preparing draft…
                      </>
                    ) : (
                      'Approve — prepare draft after review'
                    )}
                  </Button>
                  <Button plain onClick={() => handleDecision(false)} disabled={deciding}>
                    Keep discussing
                  </Button>
                </div>
              </div>
            ) : null}

            <div ref={chatEndRef} />
          </div>

          <div className="border-t border-zinc-950/5 p-4 dark:border-white/10">
            <Textarea
              ref={inputRef}
              name="project-builder-chat"
              rows={3}
              placeholder={EXAMPLE}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={running || deciding}
              aria-label="Message to Agent Builder"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button color="accent" onClick={() => void handleSend()} disabled={running || deciding || input.trim().length === 0}>
                {running ? 'Sending…' : 'Send'}
              </Button>
              <Button plain onClick={() => setInput(EXAMPLE)} disabled={running}>
                Example prompt
              </Button>
              {recCount > 0 ? (
                <Button plain onClick={() => setSuggestionsOpen(true)} disabled={running}>
                  Suggestions ({recCount})
                </Button>
              ) : null}
              <Text className="!mt-0 !text-xs">Enter to send · Shift+Enter for newline</Text>
            </div>
            {error ? (
              <div className="mt-3">
                <ErrorBanner message={error} />
              </div>
            ) : null}
          </div>
        </section>

        {/* Preview — secondary */}
        <aside className="min-h-[280px] min-w-0 lg:min-h-0">
          <ProjectBuilderPreviewPanel
            draft={draft}
            selectedTools={state?.selectedTools ?? []}
            testCases={state?.testCases ?? []}
            risks={state?.risks ?? []}
            status={state ? `${state.status} · ${state.currentNode}` : null}
            createdCopilotId={state?.createdCopilotId ?? null}
            projectName={projectName}
          />
        </aside>
      </div>

      {state?.langgraph && showDebug ? (
        <LangGraphDebugPanel info={state.langgraph} status={state.status} />
      ) : null}
      {state?.langgraph ? (
        <div className="flex justify-end">
          <Button plain onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? 'Hide' : 'Show'} LangGraph debug
          </Button>
        </div>
      ) : null}

      <ProjectBuilderSuggestionsDrawer
        open={suggestionsOpen}
        onClose={() => setSuggestionsOpen(false)}
        recommendations={intel?.recommendations ?? []}
        onDiscuss={handleDiscussRecommendation}
      />
    </div>
  )
}
