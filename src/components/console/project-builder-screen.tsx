'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PaperAirplaneIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Textarea } from '@/components/ui/textarea'
import type {
  ProjectBuilderConversationBundle,
  ProjectBuilderConversationStatus,
  ProjectBuilderMessage,
} from '@/lib/agent-mission-control/project-builder-types'
import type {
  ProjectBuilderStreamEvent,
  ProjectBuilderStreamLifecycle,
} from '@/lib/agent-mission-control/project-builder-stream-protocol'
import { consumeSSE, isProjectBuilderTerminal } from '@/lib/agent-mission-control/sse-client'
import { EmptyState, ErrorState, ScreenHeader, Section } from './screen-primitives'

/**
 * Project Builder — the architect conversation and the specification it builds.
 *
 * THE ONE CLIENT SCREEN of this console, and deliberately so: it streams SSE,
 * holds a draft in local state and posts. Everything else under
 * `src/components/console/` is server-rendered.
 *
 * This mission RESTYLED it and changed no behaviour: the same state, the same
 * `reload` / `send` / `materialize`, the same optimistic user message, the same
 * three-way action block (open created draft · keep discussing + confirm draft ·
 * approve). What changed is the chrome — graphite `Section` panels, hairline
 * separators, the danger role on the error state — plus four specification
 * fields the architect already produced and the rail simply never rendered
 * (system prompt, risk policy, max steps, tests).
 *
 * BOX FIXE, DATA SCROLLE — AT EVERY WIDTH. Each panel carries a REAL height
 * cap, not a floor:
 *  · below `xl` the two panels stack, so each one caps itself in `vh`
 *    (`h-[70vh]` / `h-[60vh]`) with a pixel floor for a short viewport;
 *  · from `xl` they sit side by side inside a grid that is itself bounded
 *    (`xl:h-[calc(100vh-11rem)]`), so each panel hands the height back to the
 *    grid row with `xl:h-auto` and stretches to it.
 *
 * The earlier `min-h-[560px] xl:min-h-0` was a FLOOR, not a cap: below `xl` the
 * row height was `auto`, the panel grew with the transcript, the inner
 * `overflow-y-auto` never had a definite height to scroll against, and the
 * composer — the input the user is here to type into — was pushed off-screen.
 *
 * The scroll only works because every link of the chain is bounded:
 * `Section` (definite `h-*`, `flex flex-col`) → body (`flex-1 min-h-0`,
 * `flex flex-col`) → scroller (`flex-1 min-h-0 overflow-y-auto`), with the
 * composer / approval strip pinned by `shrink-0`. Drop ONE `min-h-0` and the
 * scroller inherits `min-height:auto`, grows to its content, and the panel
 * bursts again.
 *
 * Same trap one level up, and it is why `min-h-[420px]` / `min-h-[360px]` are
 * not decoration: a GRID ITEM also defaults to `min-height:auto`, so a panel
 * with `h-[70vh]` alone would still be shoved past its own height by a long
 * transcript. A definite `min-h-*` replaces that automatic minimum, which
 * makes the panel exactly `max(70vh, 420px)` — a cap the content cannot lift.
 *
 * `Section scroll="sm|md|lg"` is deliberately NOT used here: it bounds the
 * WHOLE body, which in both panels holds the scrolling content *and* a footer
 * strip (composer, approval block) that must stay OUT of the scroll.
 */

/**
 * How long the client waits for ANY SSE frame (not just a terminal one)
 * before treating the stream as dead. The server's own per-completion budget
 * — `OPENAI_TIMEOUT_MS` in `project-builder-conversation.ts` — is 90s, and the
 * architect loop can chain up to `MAX_TOOL_ITERATIONS` scouting round-trips
 * before it lands on prose; each one is still a real network write, so a
 * client watchdog shorter than the server's own per-call timeout would fire
 * on a healthy stream. Matching it means the client never gives up before the
 * server would have.
 */
const SSE_INACTIVITY_TIMEOUT_MS = 90_000

class SSEInactivityTimeoutError extends Error {
  constructor() {
    super('Stream interrupted by inactivity — no event was received in time.')
    this.name = 'SSEInactivityTimeoutError'
  }
}

/**
 * The typed failure the SERVER reports on the stream → a sentence.
 *
 * `project-builder-stream-protocol.ts` declares `error` as a CLOSED union, and
 * the route really pushes it (`{type:'terminal', lifecycle:'failed', error,
 * retryable}`). Nothing read it: the client only looked at `lifecycle`, and
 * because `isProjectBuilderTerminal` answers `true` for a failed terminal too,
 * `consumeSSE` RESOLVED and the four statements after it overwrote 'failed'
 * with 'reconciling' then 'completed'. A server-side architect failure rendered
 * as a green pill, no banner, and a transcript with the user's turn and no
 * reply. This is the mapping that closes that hole; the union is exhaustive, so
 * a new failure value cannot be added without landing here.
 */
function architectFailureMessage(error: string, retryable: boolean): string {
  const cause =
    error === 'architect_message_failed'
      ? 'The architect could not answer this turn.'
      : error === 'transport_interrupted'
        ? 'The architect stream was interrupted before it completed.'
        : error === 'persistence_timeout'
          ? 'The reply could not be persisted before the write timed out.'
          : 'The architect run failed.'
  return retryable ? `${cause} It can be retried.` : `${cause} It cannot be retried as-is.`
}

/** One wording for the conversation read, used by the mount effect and by Retry. */
function conversationFailure(status: number): string {
  // A 401 is NOT "unavailable": the backend answered, and answered that this
  // browser has no session. Reporting it as an outage sent operators looking
  // for a dead service while the dev auth bypass (which covers PAGES but never
  // `/api/agent-ops/**`) was the whole cause.
  if (status === 401 || status === 403) return 'Your session has expired — sign in again to use the builder.'
  if (status === 503) return 'Builder backend is not configured.'
  return 'Conversation is unavailable.'
}

/** Lifecycle → dot role. `connecting` is NOT positive: nothing is proven yet. */
function lifecycleTone(lifecycle: ProjectBuilderStreamLifecycle): StatusDotTone {
  if (lifecycle === 'failed') return 'negative'
  if (lifecycle === 'running' || lifecycle === 'reconciling' || lifecycle === 'reconnecting') {
    return 'pending'
  }
  if (lifecycle === 'completed') return 'positive'
  return 'neutral'
}

/**
 * The conversation's real, persisted stage — `ProjectBuilderConversation.status`,
 * already part of the bundle every read returns. `archived` is not a forward
 * step from `draft_created`; it is drawn as its own terminal stop rather than
 * folded into the line, so a discussion that got shelved does not look like it
 * simply finished further along the happy path.
 */
const CONVERSATION_STEPS: { status: ProjectBuilderConversationStatus; label: string }[] = [
  { status: 'active', label: 'Discussing' },
  { status: 'draft_ready', label: 'Ready for approval' },
  { status: 'draft_created', label: 'Draft created' },
]

/** Dense horizontal stepper over the conversation's real `status` column — no
 *  derived or guessed stage, just that value rendered as steps instead of a
 *  single word. */
function ConversationStepper({ status }: { status: ProjectBuilderConversationStatus }) {
  if (status === 'archived') {
    return <p className="px-4 py-2 text-[11px]/4 text-content-subtle">This conversation is archived.</p>
  }
  const activeIndex = CONVERSATION_STEPS.findIndex((step) => step.status === status)
  return (
    <ol className="flex items-center gap-2 border-b border-line px-4 py-2">
      {CONVERSATION_STEPS.map((step, index) => {
        const reached = activeIndex >= 0 && index <= activeIndex
        const current = index === activeIndex
        return (
          <li key={step.status} className="flex items-center gap-2">
            <span
              className={cn(
                'flex items-center gap-1.5 text-[10px]/4 font-semibold uppercase tracking-widest',
                current ? 'text-accent-300' : reached ? 'text-content-muted' : 'text-content-faint'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 rounded-full',
                  current ? 'bg-accent-300' : reached ? 'bg-content-muted' : 'bg-graphite-700'
                )}
              />
              {step.label}
            </span>
            {index < CONVERSATION_STEPS.length - 1 ? (
              <span aria-hidden="true" className="h-px w-4 bg-line" />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/** `HH:MM` (UTC, via `toISOString`) next to a role label — deterministic and
 *  locale-free, so it cannot drift between the server and client render of
 *  this client component the way a `toLocaleString` call could. */
function formatMessageTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(11, 16)
}

export function ProjectBuilderScreen({
  projectId,
  projectName,
  repoFullName,
  seedInput,
}: {
  projectId: string
  projectName: string
  repoFullName: string | null
  seedInput?: string
}) {
  const [bundle, setBundle] = useState<ProjectBuilderConversationBundle | null>(null)
  const [input, setInput] = useState(seedInput ?? '')
  const [partial, setPartial] = useState('')
  const [lifecycle, setLifecycle] = useState<ProjectBuilderStreamLifecycle>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  // Mount-scoped controller for the in-flight SSE stream (if any). Aborted on
  // unmount so a stream outliving the component neither leaks a reader nor
  // triggers a post-unmount `setState`. `send()` replaces it with a fresh
  // controller per turn; the unmount cleanup always aborts whichever one is
  // current at teardown time.
  const streamAbortRef = useRef<AbortController | null>(null)
  // Same contract for the conversation READ (mount fetch and Retry share it):
  // one in-flight request at a time, cancelled on unmount.
  const loadAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      streamAbortRef.current?.abort()
      streamAbortRef.current = null
      loadAbortRef.current?.abort()
      loadAbortRef.current = null
    }
  }, [])

  const reload = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/agent-ops/projects/${projectId}/builder/conversation`, { signal })
    if (!response.ok) throw new Error(conversationFailure(response.status))
    const nextBundle = await response.json() as ProjectBuilderConversationBundle
    if (!mountedRef.current) return
    setBundle(nextBundle)
  }, [projectId])

  /**
   * The Retry control's handler, and the ONLY way `error` is cleared by a
   * retry.
   *
   * It used to be `onClick={() => void reload()}`, and `reload` touches neither
   * `error` nor `lifecycle`. A SUCCESSFUL retry therefore refreshed the bundle
   * under a red banner that never went away, and a FAILED one rejected into
   * `void` — no catch, no log, no state change, so the button was inert in both
   * directions. Clearing first and catching after is what makes it a control.
   */
  const retry = useCallback(() => {
    setError(null)
    setLifecycle('connecting')
    // Retry owns the same controller slot as the mount read, so unmounting
    // mid-retry cancels the request instead of letting it resolve into a dead
    // component. A retry also supersedes an in-flight initial read.
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    reload(controller.signal)
      .then(() => {
        if (!mountedRef.current || controller.signal.aborted) return
        setLifecycle('completed')
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current || controller.signal.aborted) return
        setLifecycle('failed')
        setError(reason instanceof Error ? reason.message : 'Conversation is unavailable.')
      })
      .finally(() => {
        if (loadAbortRef.current === controller) loadAbortRef.current = null
      })
  }, [reload])

  useEffect(() => {
    // `mountedRef` is initialised here rather than only in the mount effect
    // above: under StrictMode the first cleanup would otherwise leave it false
    // for the retained run, and every guarded `setState` would silently no-op.
    mountedRef.current = true
    const controller = new AbortController()
    loadAbortRef.current = controller
    fetch(`/api/agent-ops/projects/${projectId}/builder/conversation`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(conversationFailure(response.status))
        return response.json() as Promise<ProjectBuilderConversationBundle>
      })
      .then((nextBundle) => {
        if (!mountedRef.current || controller.signal.aborted) return
        setBundle(nextBundle)
        setLifecycle('completed')
      })
      .catch((reason: unknown) => {
        // An abort is this component tearing down or a retry superseding the
        // read — not a failure to report. Reporting it would repaint the banner
        // over whatever the newer request is about to say.
        if (!mountedRef.current || controller.signal.aborted) return
        setLifecycle('failed')
        setError(reason instanceof Error ? reason.message : 'Conversation is unavailable.')
      })
    return () => {
      controller.abort()
      if (loadAbortRef.current === controller) loadAbortRef.current = null
    }
  }, [projectId])

  async function send() {
    const content = input.trim()
    if (!content || lifecycle === 'running') return
    // Guarded here as well as on the composer: `disabled` is a UI affordance,
    // not an invariant — this function is reachable from a keyboard handler and
    // from any future caller. No bundle after a failed read means no stream.
    if (bundle === null && lifecycle === 'failed') return
    setInput('')
    setPartial('')
    setError(null)
    setLifecycle('running')
    const optimistic: ProjectBuilderMessage = {
      id: `local-${Date.now()}`,
      conversationId: bundle?.conversation.id ?? 'pending',
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    setBundle((current) => current ? { ...current, messages: [...current.messages, optimistic] } : current)

    // A fresh controller per turn — aborted by unmount cleanup, by the
    // inactivity watchdog, or (implicitly) superseded by the next turn's own
    // controller. `fetch` gets the signal directly so the network request
    // itself is cancelled, not just the local bookkeeping.
    const controller = new AbortController()
    streamAbortRef.current = controller

    // Watchdog: no event (not even `connected`) for `SSE_INACTIVITY_TIMEOUT_MS`
    // aborts the stream and reports an explicit state — never a silently stuck
    // "running" pill. Reset on every frame `consumeSSE` hands back; disarmed on
    // a terminal frame and in the `finally` below (abort included).
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const armWatchdog = () => {
      if (watchdog !== undefined) clearTimeout(watchdog)
      watchdog = setTimeout(() => controller.abort(new SSEInactivityTimeoutError()), SSE_INACTIVITY_TIMEOUT_MS)
    }
    const disarmWatchdog = () => {
      if (watchdog !== undefined) clearTimeout(watchdog)
      watchdog = undefined
    }

    try {
      armWatchdog()
      const response = await fetch(`/api/agent-ops/projects/${projectId}/builder/message?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ content }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error('The architect stream could not start.')
      const { terminalEvent, malformedFrames } = await consumeSSE<ProjectBuilderStreamEvent>(
        response.body,
        (event) => {
          armWatchdog()
          // `connected` is a real handshake, and it is the first moment the
          // server is proven to be answering. `setLifecycle('running')` fires
          // before `fetch` is even called, so without this the pill claimed
          // 'running' whether or not anything ever replied.
          if (event.type === 'connected' && mountedRef.current) setLifecycle('running')
          if (event.type === 'delta' && mountedRef.current) setPartial((value) => value + event.delta)
          if (isProjectBuilderTerminal(event)) disarmWatchdog()
        },
        { isTerminal: isProjectBuilderTerminal, requireTerminal: true, signal: controller.signal }
      )

      if (!mountedRef.current) return

      // A FAILED terminal is a failure, not a slow success. `requireTerminal`
      // is satisfied by it, so `consumeSSE` resolves and nothing below would
      // have stopped the reconcile/complete sequence on its own.
      if (terminalEvent?.type === 'terminal' && terminalEvent.lifecycle === 'failed') {
        setPartial('')
        setLifecycle('failed')
        setError(architectFailureMessage(terminalEvent.error, terminalEvent.retryable))
        return
      }

      setLifecycle('reconciling')
      await reload()
      if (!mountedRef.current) return
      setPartial('')
      setLifecycle('completed')

      // The stream ended on a real terminal, but part of it did not survive
      // transport. The transcript is therefore INCOMPLETE, and saying so is the
      // difference between a truncated answer and a clean one.
      if (malformedFrames > 0) {
        setError(
          `${malformedFrames} stream frame${malformedFrames > 1 ? 's were' : ' was'} lost in transport — the reply above may be incomplete.`
        )
      }
    } catch (reason) {
      if (!mountedRef.current) return
      // The half-arrived block goes with the failure: leaving it on screen under
      // a red banner reads as a reply still arriving.
      setPartial('')
      setLifecycle('failed')
      // `reader.cancel(reason)` (fired by the abort listener in `sse-client`)
      // resolves the pending read with `{done:true}` rather than rejecting, so
      // a watchdog abort surfaces here as `consumeSSE`'s own
      // `IncompleteSSEStreamError` — the watchdog's actual reason lives on
      // `controller.signal.reason`, checked first so "inactivity" is reported
      // instead of the generic "closed before terminal" message.
      const effectiveReason = controller.signal.aborted ? controller.signal.reason : reason
      setError(
        effectiveReason instanceof SSEInactivityTimeoutError
          ? 'Stream interrupted by inactivity — the architect stopped responding.'
          : effectiveReason instanceof Error
            ? effectiveReason.message
            : 'The stream was interrupted before completion.'
      )
    } finally {
      disarmWatchdog()
      if (streamAbortRef.current === controller) streamAbortRef.current = null
    }
  }

  async function materialize(approved?: boolean) {
    setApproving(true)
    setError(null)
    try {
      const response = await fetch(`/api/agent-ops/projects/${projectId}/builder/create-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: approved === undefined ? undefined : JSON.stringify({ approved }),
      })
      const payload = await response.json() as ProjectBuilderConversationBundle & { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Draft materialization failed.')
      // Same rule the SSE path already follows: every `setState` past an `await`
      // is guarded, or unmounting mid-materialization warns and leaks.
      if (!mountedRef.current) return
      setBundle(payload)
    } catch (reason) {
      if (!mountedRef.current) return
      setError(reason instanceof Error ? reason.message : 'Draft materialization failed.')
    } finally {
      if (mountedRef.current) setApproving(false)
    }
  }

  const preview = bundle?.conversation.latestPreview
  /**
   * The initial conversation read never landed, so there is no conversation to
   * append a turn to.
   *
   * `bundle` is the proof: the mount effect and `reload()` are the ONLY writers,
   * and both set it exclusively on a 2xx. A null bundle under a terminal
   * lifecycle therefore means the read failed (401, 503, network) — as opposed
   * to `connecting`, where it is merely still in flight.
   */
  const initialLoadFailed = bundle === null && lifecycle === 'failed'

  // `initialLoadFailed` belongs here, not just on the button: without it a 401
  // left the composer live, and Enter would POST `/builder/message?stream=1`
  // and open an SSE stream against the very session that just refused the read
  // — a second failure the user did not ask for. Retry is the only way forward.
  const composerBusy = lifecycle === 'running' || lifecycle === 'reconciling' || initialLoadFailed

  return (
    <div className="space-y-4">
      <ScreenHeader
        title={`${projectName} · Project Builder`}
        description={repoFullName ?? 'Repository not configured'}
        actions={
          <StatusDot tone={lifecycleTone(lifecycle)} className="max-w-40">
            {lifecycle}
          </StatusDot>
        }
      />

      {/* SESSION EXPIRED / INITIAL LOAD FAILED — one dominant, centered panel.
          The two-panel workspace below still exists in the DOM (the composer's
          own `initialLoadFailed` guard is what actually blocks a stray SSE
          start, and stays testable that way) but is masked with `hidden`: no
          giant dead form competing with the real message. */}
      {initialLoadFailed ? (
        <div className="flex min-h-[50vh] items-center justify-center px-4">
          <ErrorState
            className="w-full max-w-md"
            title={error ?? 'Conversation could not be loaded'}
            description="Nothing can be sent until this read succeeds. Reconnect, or go back to the project."
            actions={
              <>
                <Button outline onClick={retry}>
                  Retry
                </Button>
                <Button href="/admin/projects" outline>
                  Back to Projects
                </Button>
              </>
            }
          />
        </div>
      ) : error ? (
        <ErrorState
          title={error}
          actions={
            <Button outline onClick={retry}>
              Retry
            </Button>
          }
        />
      ) : null}

      <div
        className={cn(
          'grid grid-cols-1 gap-4 xl:h-[calc(100vh-11rem)] xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.55fr)]',
          initialLoadFailed && 'hidden'
        )}
      >
        <Section
          title="Architect conversation"
          description="The mission, its tools and its approval policy are settled here"
          priority="primary"
          className="h-[70vh] min-h-[420px] xl:h-auto xl:min-h-0"
          bodyClassName="flex min-h-0 flex-1 flex-col"
        >
          {bundle ? <ConversationStepper status={bundle.conversation.status} /> : null}
          {/* `overscroll-contain`: on a touch screen, reaching the end of the
              transcript must NOT chain into the page and drag the composer
              away — the panel is the scroll boundary. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
            {bundle?.messages.length ? bundle.messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === 'user'
                    ? 'ml-auto max-w-[78%] rounded-xl border border-line bg-surface-hover px-3.5 py-2.5'
                    : 'max-w-[88%]'
                }
              >
                <div className="flex items-baseline gap-2">
                  <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">{message.role}</p>
                  <p className="text-[10px]/4 tabular-nums text-content-faint">{formatMessageTime(message.createdAt)}</p>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px]/6 text-content">{message.content}</p>
              </div>
            )) : lifecycle === 'connecting' ? (
              <EmptyState title="Loading the conversation…" />
            ) : initialLoadFailed ? (
              // Not "Describe the agent you need": the composer is disabled in
              // this state, so inviting a description would be an instruction
              // the screen refuses to accept. The banner above carries the
              // cause and the Retry control.
              <EmptyState
                title="Conversation could not be loaded"
                description="Nothing can be sent until this read succeeds — use Retry above."
              />
            ) : (
              <EmptyState
                title="Describe the agent you need"
                description="The architect will refine the mission, tools and approval policy before any draft is created."
              />
            )}
            {partial ? (
              <div className="max-w-[88%]">
                {/* `content-muted`, NOT the accent. The accent is this console's
                    proven/success hue (`StatusDot` tone `positive`), and a
                    half-arrived answer is proven nothing — the same reason
                    `lifecycleTone` maps `running` to `pending`, not `positive`.
                    One step brighter than the settled `zinc-500` role labels
                    below, so the live block still reads as the live one. */}
                <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-muted">
                  architect · streaming
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px]/6 text-content">{partial}</p>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-line bg-surface-sunken p-3">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              placeholder="Describe the mission, constraints and expected outcome…"
              disabled={composerBusy}
              className="text-[13px]/6"
            />
            <div className="mt-2.5 flex justify-end">
              <Button color="accent" onClick={() => void send()} disabled={!input.trim() || composerBusy}>
                Send <PaperAirplaneIcon />
              </Button>
            </div>
          </div>
        </Section>

        <Section
          title="Evolving specification"
          description="Rewritten by the architect on every turn"
          className="h-[60vh] min-h-[360px] xl:h-auto xl:min-h-0"
          bodyClassName="flex min-h-0 flex-1 flex-col"
        >
          {!preview ? (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <EmptyState
                title="No specification yet."
                description="It will appear as the architect resolves the mission."
              />
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <PreviewBlock label="Name" value={preview.name} />
                <PreviewBlock label="Role" value={preview.role} />
                <PreviewBlock label="Description" value={preview.description} />
                <PreviewBlock label="System prompt" value={preview.systemPromptSummary} />
                <PreviewBlock label="Approval policy" value={preview.approvalPolicy ?? preview.confirmationPolicy} />
                <PreviewBlock label="Risk policy" value={preview.riskPolicy} />
                <PreviewBlock
                  label="Max steps per run"
                  value={preview.maxStepsPerRun === undefined ? undefined : String(preview.maxStepsPerRun)}
                />
                <PreviewList label="Flow" values={preview.flow} />
                <PreviewList label="Tools" values={preview.tools} />
                <PreviewList label="Tests" values={preview.tests} />
              </div>

              <div className="shrink-0 border-t border-line p-3">
                {bundle?.createdCopilotId ? (
                  <Button href={`/admin/agents/${bundle.createdCopilotId}`} color="accent" className="w-full">Open created draft</Button>
                ) : bundle?.runState?.status === 'awaiting_approval' ? (
                  <div className="flex gap-2">
                    <Button outline className="flex-1" disabled={approving} onClick={() => void materialize(false)}>Keep discussing</Button>
                    <Button color="accent" className="flex-1" disabled={approving} onClick={() => void materialize(true)}>Confirm draft</Button>
                  </div>
                ) : (
                  <Button color="accent" className="w-full" disabled={!preview.readyForApproval || approving} onClick={() => void materialize()}>Approve — create draft</Button>
                )}
                {!preview.readyForApproval ? <p className="mt-2 text-center text-[11px]/4 text-content-subtle">Continue the discussion before approval.</p> : null}
              </div>
            </>
          )}
        </Section>
      </div>
    </div>
  )
}

/** One labelled paragraph of the specification rail. Absent ⇒ the block is not
 *  rendered at all: the architect has not settled that field yet, and an empty
 *  labelled row would read as a settled emptiness. */
function PreviewBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0">
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13px]/6 text-content">{value}</p>
    </div>
  )
}

/** Same rule, for the list-shaped fields. */
function PreviewList({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0">
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">{label}</p>
      <ul className="mt-1.5 space-y-1.5">
        {values.map((value) => (
          <li key={value} className="flex gap-2 text-[12px]/5 text-content-muted">
            {/* Neutral zinc, NOT the accent. A list bullet is punctuation, not a
                status and not an action: ten green dots in a rail that also holds
                the one accent CTA spend the accent on nothing and stop the button
                from reading as the primary thing on screen. */}
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-content-faint" />
            <span className="min-w-0">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
