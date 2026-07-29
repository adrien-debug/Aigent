'use client'

import { useCallback, useEffect, useState } from 'react'
import { PaperAirplaneIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Textarea } from '@/components/ui/textarea'
import type { ProjectBuilderConversationBundle, ProjectBuilderMessage } from '@/lib/agent-mission-control/project-builder-types'
import type { ProjectBuilderStreamEvent } from '@/lib/agent-mission-control/project-builder-stream-protocol'
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

type BuilderLifecycle = 'connecting' | 'running' | 'reconciling' | 'completed' | 'failed'

/** Lifecycle → dot role. `connecting` is NOT positive: nothing is proven yet. */
function lifecycleTone(lifecycle: BuilderLifecycle): StatusDotTone {
  if (lifecycle === 'failed') return 'negative'
  if (lifecycle === 'running' || lifecycle === 'reconciling') return 'pending'
  if (lifecycle === 'completed') return 'positive'
  return 'neutral'
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
  const [lifecycle, setLifecycle] = useState<BuilderLifecycle>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)

  const reload = useCallback(async () => {
    const response = await fetch(`/api/agent-ops/projects/${projectId}/builder/conversation`)
    if (!response.ok) throw new Error(response.status === 503 ? 'Builder backend is not configured.' : 'Conversation is unavailable.')
    setBundle(await response.json() as ProjectBuilderConversationBundle)
  }, [projectId])

  useEffect(() => {
    let active = true
    fetch(`/api/agent-ops/projects/${projectId}/builder/conversation`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(response.status === 503 ? 'Builder backend is not configured.' : 'Conversation is unavailable.')
        }
        return response.json() as Promise<ProjectBuilderConversationBundle>
      })
      .then((nextBundle) => {
        if (!active) return
        setBundle(nextBundle)
        setLifecycle('completed')
      })
      .catch((reason: unknown) => {
        if (!active) return
        setLifecycle('failed')
        setError(reason instanceof Error ? reason.message : 'Conversation is unavailable.')
      })
    return () => {
      active = false
    }
  }, [projectId])

  async function send() {
    const content = input.trim()
    if (!content || lifecycle === 'running') return
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

    try {
      const response = await fetch(`/api/agent-ops/projects/${projectId}/builder/message?stream=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ content }),
      })
      if (!response.ok || !response.body) throw new Error('The architect stream could not start.')
      await consumeSSE<ProjectBuilderStreamEvent>(response.body, (event) => {
        if (event.type === 'delta') setPartial((value) => value + event.delta)
        if (event.type === 'terminal') setLifecycle(event.lifecycle)
      }, { isTerminal: isProjectBuilderTerminal, requireTerminal: true })
      setLifecycle('reconciling')
      await reload()
      setPartial('')
      setLifecycle('completed')
    } catch (reason) {
      setLifecycle('failed')
      setError(reason instanceof Error ? reason.message : 'The stream was interrupted before completion.')
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
      setBundle(payload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Draft materialization failed.')
    } finally {
      setApproving(false)
    }
  }

  const preview = bundle?.conversation.latestPreview
  const composerBusy = lifecycle === 'running' || lifecycle === 'reconciling'

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

      {error ? (
        <ErrorState
          title={error}
          actions={
            <Button outline onClick={() => void reload()}>
              Retry
            </Button>
          }
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:h-[calc(100vh-11rem)] xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.55fr)]">
        <Section
          title="Architect conversation"
          description="The mission, its tools and its approval policy are settled here"
          className="h-[70vh] min-h-[420px] xl:h-auto xl:min-h-0"
          bodyClassName="flex min-h-0 flex-1 flex-col"
        >
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
                <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">{message.role}</p>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px]/6 text-zinc-200">{message.content}</p>
              </div>
            )) : lifecycle === 'connecting' ? (
              <EmptyState title="Loading the conversation…" />
            ) : (
              <EmptyState
                title="Describe the agent you need"
                description="The architect will refine the mission, tools and approval policy before any draft is created."
              />
            )}
            {partial ? (
              <div className="max-w-[88%]">
                {/* `zinc-400`, NOT the accent. The accent is this console's
                    proven/success hue (`StatusDot` tone `positive`), and a
                    half-arrived answer is proven nothing — the same reason
                    `lifecycleTone` maps `running` to `pending`, not `positive`.
                    One step brighter than the settled `zinc-500` role labels
                    below, so the live block still reads as the live one. */}
                <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-400">
                  architect · streaming
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px]/6 text-zinc-200">{partial}</p>
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
                {!preview.readyForApproval ? <p className="mt-2 text-center text-[11px]/4 text-zinc-500">Continue the discussion before approval.</p> : null}
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
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13px]/6 text-zinc-200">{value}</p>
    </div>
  )
}

/** Same rule, for the list-shaped fields. */
function PreviewList({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0">
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <ul className="mt-1.5 space-y-1.5">
        {values.map((value) => (
          <li key={value} className="flex gap-2 text-[12px]/5 text-zinc-300">
            {/* Neutral zinc, NOT the accent. A list bullet is punctuation, not a
                status and not an action: ten green dots in a rail that also holds
                the one accent CTA spend the accent on nothing and stop the button
                from reading as the primary thing on screen. */}
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-zinc-600" />
            <span className="min-w-0">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
