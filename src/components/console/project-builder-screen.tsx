'use client'

import { useCallback, useEffect, useState } from 'react'
import { PaperAirplaneIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { StatusDot } from '@/components/ui/status-dot'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { ProjectBuilderConversationBundle, ProjectBuilderMessage } from '@/lib/agent-mission-control/project-builder-types'
import type { ProjectBuilderStreamEvent } from '@/lib/agent-mission-control/project-builder-stream-protocol'
import { consumeSSE, isProjectBuilderTerminal } from '@/lib/agent-mission-control/sse-client'

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
  const [lifecycle, setLifecycle] = useState<'connecting' | 'running' | 'reconciling' | 'completed' | 'failed'>('connecting')
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
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs text-zinc-400">{repoFullName ?? 'Repository not configured'}</p>
          <Heading className="mt-1">{projectName} · Project Builder</Heading>
        </div>
        <StatusDot tone={lifecycle === 'failed' ? 'negative' : lifecycle === 'running' || lifecycle === 'reconciling' ? 'pending' : 'positive'}>
          {lifecycle}
        </StatusDot>
      </div>

      {error ? (
        <div className="rounded-xl border border-[var(--state-danger-solid-line)] bg-zinc-900 px-5 py-4 text-sm text-[var(--state-danger-text)]">
          {error} <Button plain onClick={() => void reload()}>Retry</Button>
        </div>
      ) : null}

      <div className="grid min-h-[calc(100vh-190px)] gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.55fr)]">
        <section className="flex min-h-[620px] flex-col overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-sm">
          <div className="border-b border-white/8 px-5 py-4"><Heading level={2} className="text-sm/6">Architect conversation</Heading></div>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6">
            {bundle?.messages.length ? bundle.messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[78%] rounded-xl bg-white/5 px-4 py-3' : 'max-w-[88%]'}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{message.role}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm/6 text-zinc-200">{message.content}</p>
              </div>
            )) : lifecycle === 'connecting' ? (
              <p className="text-sm text-zinc-400">Loading the conversation…</p>
            ) : (
              <div className="mx-auto max-w-lg py-16 text-center">
                <Heading level={2} className="text-sm/6">Describe the agent you need</Heading>
                <Text className="mt-2">The architect will refine the mission, tools and approval policy before any draft is created.</Text>
              </div>
            )}
            {partial ? <div className="max-w-[88%]"><p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">Architect · streaming</p><p className="mt-2 whitespace-pre-wrap text-sm/6 text-zinc-200">{partial}</p></div> : null}
          </div>
          <div className="border-t border-white/8 bg-zinc-950 p-4">
            <Textarea value={input} onChange={(event) => setInput(event.target.value)} rows={3} placeholder="Describe the mission, constraints and expected outcome…" disabled={lifecycle === 'running' || lifecycle === 'reconciling'} />
            <div className="mt-3 flex justify-end"><Button color="accent" onClick={() => void send()} disabled={!input.trim() || lifecycle === 'running' || lifecycle === 'reconciling'}>Send <PaperAirplaneIcon /></Button></div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-sm">
          <div className="border-b border-white/8 px-5 py-4"><Heading level={2} className="text-sm/6">Evolving specification</Heading></div>
          {!preview ? (
            <div className="px-6 py-14 text-center"><Text>The specification will appear as the architect resolves the mission.</Text></div>
          ) : (
            <div className="divide-y divide-white/8">
              <PreviewBlock label="Name" value={preview.name} />
              <PreviewBlock label="Role" value={preview.role} />
              <PreviewBlock label="Description" value={preview.description} />
              <PreviewBlock label="Approval policy" value={preview.approvalPolicy ?? preview.confirmationPolicy} />
              <PreviewList label="Flow" values={preview.flow} />
              <PreviewList label="Tools" values={preview.tools} />
              <div className="p-5">
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
                {!preview.readyForApproval ? <p className="mt-2 text-center text-[11px] text-zinc-500">Continue the discussion before approval.</p> : null}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function PreviewBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return <div className="p-5"><p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p><p className="mt-2 text-sm/6 text-zinc-200">{value}</p></div>
}

function PreviewList({ label, values }: { label: string; values?: string[] }) {
  if (!values?.length) return null
  return <div className="p-5"><p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p><ul className="mt-3 space-y-2">{values.map((value) => <li key={value} className="text-sm text-zinc-300">— {value}</li>)}</ul></div>
}
