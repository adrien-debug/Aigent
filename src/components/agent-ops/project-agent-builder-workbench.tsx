'use client'

import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { LangGraphDebugPanel, type LangGraphDebugInfo } from '@/components/agent-ops/langgraph-debug-panel'
import { MarkdownLite } from '@/components/agent-ops/markdown-lite'
import { ProjectBuilderPreviewPanel } from '@/components/agent-ops/project-builder-preview-panel'
import {
  ProjectRepoIntelligenceActions,
  useProjectRepoIntelligence,
} from '@/components/agent-ops/project-repo-intelligence'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import type { AgentRecommendation } from '@/lib/agent-mission-control/repo-intelligence'
import type {
  AgentPreview,
  ProjectBuilderConversation,
  ProjectBuilderConversationBundle,
  ProjectBuilderMessage,
} from '@/lib/agent-mission-control/project-builder-types'

interface BuilderRunState {
  runId: string
  status: 'awaiting_approval' | 'completed' | 'blocked' | 'failed' | 'running'
  currentNode: string
  approvalMessage: string | null
  pendingTool: { name: string; argumentsSummary: string; risk?: string } | null
  langgraph?: LangGraphDebugInfo
}

const EXAMPLE =
  'I want an agent that watches the design system and flags oversized cards/buttons. What would you recommend for this repo?'

/** Shared avatar-badge shell for the assistant ("A") glyph — chat log + streaming row. */
const assistantAvatarBadgeClass =
  'flex size-6 items-center justify-center rounded-md bg-zinc-100 text-[10px] font-medium text-zinc-600 ring-1 ring-zinc-950/10 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-white/10'

function recommendationDiscussMessage(rec: AgentRecommendation): string {
  return (
    `Discutons de cette recommandation : "${rec.title}".\n\n` +
    `Contexte scan : ${rec.why}\nRôle proposé : ${rec.proposedRole}\n\n` +
    `Explique les options (dont une variante prudente), challenge mes hypothèses — pas de draft pour l'instant.`
  )
}

function seedFromTitle(title: string): string {
  return (
    `I'm interested in a "${title}" agent for this repo. ` +
    `What would you recommend given the stack and footprint? Compare a cautious read-only option vs a stronger variant. ` +
    `Discuss only — no draft yet.`
  )
}

function visibleMessages(messages: ProjectBuilderMessage[]): ProjectBuilderMessage[] {
  return messages.filter((m) => m.role !== 'system')
}

/** One SSE frame as sent by the builder/message route while streaming. */
type BuilderStreamEvent =
  | { delta: string }
  | {
      done: true
      preview: AgentPreview | null
      conversationStatus: ProjectBuilderConversation['status']
      createdCopilotId: string | null
      messageId: string | null
    }
  | { error: string }

/**
 * Read an SSE body (`data: {...}\n\n` frames) and invoke `onEvent` for each
 * parsed JSON payload as it arrives. Malformed frames are skipped rather than
 * throwing, since a single bad frame should not abort an otherwise-good
 * stream. Returns once the stream closes.
 */
async function consumeSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: BuilderStreamEvent) => void
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sepIndex = buffer.indexOf('\n\n')
    while (sepIndex !== -1) {
      const frame = buffer.slice(0, sepIndex)
      buffer = buffer.slice(sepIndex + 2)
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (line) {
        const raw = line.slice(5).trim()
        try {
          onEvent(JSON.parse(raw) as BuilderStreamEvent)
        } catch {
          // Skip malformed frame — do not abort the whole stream over it.
        }
      }
      sepIndex = buffer.indexOf('\n\n')
    }
  }
}

/**
 * Chat-first Project Builder with persistent backend conversation thread.
 */
export function ProjectAgentBuilderWorkbench({
  projectId,
  projectName,
  repoFullName,
  seedInput,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  initialScan?: unknown
  seedInput?: string
}) {
  const router = useRouter()
  const chatLogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const intelligenceState = useProjectRepoIntelligence(projectId, repoFullName)

  const [conversation, setConversation] = useState<ProjectBuilderConversation | null>(null)
  const [messages, setMessages] = useState<ProjectBuilderMessage[]>([])
  const [preview, setPreview] = useState<AgentPreview | null>(null)
  const [createdCopilotId, setCreatedCopilotId] = useState<string | null>(null)
  const [input, setInput] = useState(seedInput ? seedFromTitle(seedInput) : '')
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [selectingOption, setSelectingOption] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runState, setRunState] = useState<BuilderRunState | null>(null)
  const [showDebug, setShowDebug] = useState(false)
  /** Assistant reply currently growing token-by-token; null when nothing is streaming. */
  const [streamingContent, setStreamingContent] = useState<string | null>(null)

  const applyBundle = useCallback((bundle: ProjectBuilderConversationBundle) => {
    setConversation(bundle.conversation)
    setMessages(bundle.messages)
    setPreview(bundle.conversation.latestPreview)
    setCreatedCopilotId(bundle.createdCopilotId)
    // Rehydrate the run state from the bundle: on a page reload while a run is
    // paused at its HITL interrupt, this is what lets the UI show "Confirm
    // draft" instead of a stale "Approve — create draft". null clears any local
    // run state (thread died / no run in progress) so the button set is correct.
    setRunState((bundle.runState as BuilderRunState | null) ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/conversation`)
        const data = await res.json().catch(() => null)
        if (!res.ok) {
          if (!cancelled) setError(data?.error ?? `Failed to load conversation (${res.status}).`)
          return
        }
        if (!cancelled) applyBundle(data as ProjectBuilderConversationBundle)
      } catch {
        if (!cancelled) setError('Live backend not reachable.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, applyBundle])

  const seedAppliedRef = useRef(false)
  useEffect(() => {
    if (!seedInput || seedAppliedRef.current || loading) return
    seedAppliedRef.current = true
    setInput(seedFromTitle(seedInput))
    inputRef.current?.focus()
  }, [seedInput, loading])

  useEffect(() => {
    // Scroll only the chat log's own scroll container to its bottom — never
    // scrollIntoView, which walks up to the window and yanks the whole page
    // down on every message. The box has a fixed height; its content scrolls.
    const el = chatLogRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, running, runState?.status, streamingContent])

  /** Non-streaming fallback: the original one-shot JSON round-trip. */
  const sendMessageJSON = useCallback(
    async (content: string) => {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Message failed (${res.status}).`)
        return
      }
      applyBundle(data as ProjectBuilderConversationBundle)
    },
    [projectId, applyBundle]
  )

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim()
      if (running || trimmed.length === 0) return

      setRunning(true)
      setError(null)
      setStreamingContent('')

      try {
        const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ content: trimmed }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          setError(data?.error ?? `Message failed (${res.status}).`)
          return
        }

        const isStream = (res.headers.get('content-type') ?? '').includes('text/event-stream')
        if (!isStream || !res.body) {
          // Server (or an intermediary) did not honor the stream request —
          // fall back to reading the response as the classic JSON bundle.
          const data = await res.json().catch(() => null)
          if (data) applyBundle(data as ProjectBuilderConversationBundle)
          return
        }

        let streamError: string | null = null
        await consumeSSE(res.body, (event) => {
          if ('delta' in event) {
            setStreamingContent((prev) => (prev ?? '') + event.delta)
          } else if ('error' in event) {
            streamError = event.error
          } else if ('done' in event) {
            // Reconcile via a full reload of the conversation bundle so the
            // persisted message list (with real ids/timestamps) replaces the
            // locally-streamed text, keeping a single source of truth.
          }
        })

        if (streamError) {
          setError(streamError)
          return
        }

        // Pull the persisted bundle now that the backend has written the
        // final assistant message + preview patch — same data the JSON path
        // would have returned in one shot.
        const bundleRes = await fetch(`/api/agent-ops/projects/${projectId}/builder/conversation`)
        const bundleData = await bundleRes.json().catch(() => null)
        if (bundleRes.ok && bundleData) {
          applyBundle(bundleData as ProjectBuilderConversationBundle)
        }
      } catch {
        // Streaming path failed outright (network hiccup, browser without
        // ReadableStream support, aborted fetch) — retry once via the plain
        // JSON endpoint so the message is not silently lost.
        try {
          await sendMessageJSON(trimmed)
        } catch {
          setError('Live backend not reachable.')
        }
      } finally {
        setStreamingContent(null)
        setRunning(false)
      }
    },
    [projectId, running, applyBundle, sendMessageJSON]
  )

  const handleDiscussRecommendation = useCallback(
    async (rec: AgentRecommendation) => {
      setInput('')
      await sendMessage(recommendationDiscussMessage(rec))
    },
    [sendMessage]
  )

  async function handleSend() {
    const trimmed = input.trim()
    if (trimmed.length === 0) return
    setInput('')
    await sendMessage(trimmed)
  }

  async function handleSelectOption(optionId: string) {
    if (selectingOption) return
    setSelectingOption(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/preview/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optionId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Select failed (${res.status}).`)
        return
      }
      applyBundle(data as ProjectBuilderConversationBundle)
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setSelectingOption(false)
    }
  }

  async function handleCreateDraft() {
    if (creatingDraft || deciding) return
    setCreatingDraft(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/create-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? `Create draft failed (${res.status}).`)
        return
      }
      applyBundle(data as ProjectBuilderConversationBundle)
      if (data.runState) setRunState(data.runState as BuilderRunState)
    } catch {
      setError('Live backend not reachable.')
    } finally {
      setCreatingDraft(false)
    }
  }

  async function handleDecision(approved: boolean) {
    if (deciding) return
    setDeciding(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/builder/create-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.persistError ?? data?.error ?? data?.assistantError ?? `Decision failed (${res.status}).`)
        if (data?.runState) setRunState(data.runState as BuilderRunState)
        return
      }
      applyBundle(data as ProjectBuilderConversationBundle)
      if (data.runState) setRunState(data.runState as BuilderRunState)
      if (approved && data.createdCopilotId) {
        setRunState(null)
        router.refresh()
      } else if (!approved) {
        setRunState(null)
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

  const chatMessages = visibleMessages(messages)
  const awaiting = runState?.status === 'awaiting_approval'
  const draftBlocked = conversation?.status === 'draft_created'
  const draftReady = Boolean(preview?.readyForApproval && !createdCopilotId && !draftBlocked)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Repo bandeau lives at the TOP, full-width — the sole entry point for
          repo map / suggestions, ahead of the chat (Project Builder 3-zone
          contract). */}
      <div className="shrink-0">
        <ProjectRepoIntelligenceActions
          projectId={projectId}
          repoFullName={repoFullName}
          onDiscussRecommendation={(rec) => void handleDiscussRecommendation(rec)}
          intelligenceState={intelligenceState}
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(20rem,1fr)_minmax(20rem,1fr)] gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-1">
        <section
          aria-label="Agent Builder architect chat"
          className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl ring-1 ring-white/[0.04] overflow-hidden shadow-sm"
        >
          <div className="relative bg-(--accent-soft) px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-[10px] font-medium tracking-wider text-zinc-500 uppercase">Architect chat</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Persistent thread — discuss the repo, compare options, create draft only after explicit approval.
              </p>
            </div>
          </div>

          <div
            ref={chatLogRef}
            role="log"
            aria-live="polite"
            aria-label="Builder conversation"
            className="no-scrollbar relative min-h-0 flex-1 overflow-y-auto bg-[var(--color-surface-secondary)]"
          >
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-zinc-500">
                <Spinner className="size-4" />
                Loading conversation…
              </div>
            ) : chatMessages.length === 0 ? (
              <div className="space-y-3 p-4 text-sm text-zinc-500 dark:text-zinc-400">
                <p>
                  Ask about the repo, request agent ideas, compare options, or say{' '}
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">“prepare the draft”</span> when ready.
                </p>
                <p className="text-xs">
                  Examples: “Que penses-tu du repo ?”, “Compare option A vs B”, “Montre-moi le graph”.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-950/5 dark:divide-white/5">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className="group relative flex gap-4 px-4 py-5 hover:bg-[var(--color-surface-interactive)] transition-colors"
                  >
                    <div className="flex-none pt-0.5" aria-hidden="true">
                      {message.role === 'user' ? (
                        <div className="flex size-6 items-center justify-center rounded-md bg-(--accent-soft) text-[10px] font-medium text-accent-700 ring-1 ring-(--accent-line) dark:text-accent-300">
                          U
                        </div>
                      ) : (
                        <div className={assistantAvatarBadgeClass}>
                          A
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                          {message.role === 'user' ? 'You' : 'Architect'}
                        </span>
                      </div>
                      <div
                        className={clsx(
                          'text-sm leading-relaxed',
                          message.role === 'user' ? 'text-accent-400' : 'text-white'
                        )}
                      >
                        <MarkdownLite content={message.content} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {running ? (
              <div className="border-t border-zinc-950/5 dark:border-white/5">
                <div className="flex gap-4 px-4 py-5">
                  <div className="flex-none pt-0.5" aria-hidden="true">
                    <div className={assistantAvatarBadgeClass}>
                      A
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">Architect</span>
                    </div>
                    {streamingContent ? (
                      <div className="text-sm leading-relaxed text-white">
                        <MarkdownLite content={streamingContent} />
                        <span
                          aria-hidden="true"
                          className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-accent-500"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Spinner className="size-4" />
                        Thinking…
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="bg-[var(--color-surface-primary)] p-4 pt-3 flex flex-col gap-3">
            <Textarea
              ref={inputRef}
              name="project-builder-chat"
              rows={3}
              placeholder={EXAMPLE}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading || running || deciding || draftBlocked}
              aria-label="Message to Agent Builder"
            />
            <div className="mt-3 flex items-center justify-between">
              <Text className="mt-0! text-xs! text-zinc-500">Enter to send · Shift+Enter for newline</Text>
              <div className="flex items-center gap-2">
                <Button plain onClick={() => setInput(EXAMPLE)} disabled={running || draftBlocked}>
                  Example
                </Button>
                <Button
                  color="accent"
                  onClick={() => void handleSend()}
                  disabled={loading || running || deciding || draftBlocked || input.trim().length === 0}
                >
                  {running ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </div>
            {error ? (
              <div className="mt-3">
                <ErrorBanner message={error} />
              </div>
            ) : null}
          </div>
        </section>

        <aside className="h-full min-h-0 min-w-0 overflow-hidden">
          <ProjectBuilderPreviewPanel
            preview={preview}
            conversationStatus={conversation?.status ?? null}
            createdCopilotId={createdCopilotId}
            projectName={projectName}
            selectingOption={selectingOption}
            onSelectOption={(id) => void handleSelectOption(id)}
            onCreateDraft={() => void handleCreateDraft()}
            creatingDraft={creatingDraft}
            draftReady={draftReady}
            awaitingApproval={awaiting}
            approvalMessage={runState?.approvalMessage}
            pendingTool={runState?.pendingTool ?? null}
            onApprove={() => void handleDecision(true)}
            onReject={() => void handleDecision(false)}
            deciding={deciding}
          />
        </aside>
      </div>

      {runState?.langgraph && showDebug ? (
        <LangGraphDebugPanel info={runState.langgraph} status={runState.status} />
      ) : null}
      {runState?.langgraph ? (
        <div className="flex justify-end">
          <Button plain onClick={() => setShowDebug((v) => !v)}>
            {showDebug ? 'Hide' : 'Show'} LangGraph debug
          </Button>
        </div>
      ) : null}
    </div>
  )
}
