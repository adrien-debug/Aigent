'use client'

import { useEffect, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, ManifestRecap, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/ui/button'
import { Field, Label } from '@/components/ui/fieldset'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { ArchitectMessage, GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'

interface ArchitectChatProps {
  onManifest?: (manifest: GeneratedManifest) => void
  onDraftId?: (draftId: string | null) => void
}

interface ArchitectResponseBody {
  reply: string
  manifest: GeneratedManifest | null
  draftId: string | null
}

/** sessionStorage key for the in-progress architect conversation draft. */
const DRAFT_STORAGE_KEY = 'amc-architect-draft'

interface ArchitectDraft {
  messages: ArchitectMessage[]
  manifest: GeneratedManifest | null
  draftId: string | null
}

function readDraft(): ArchitectDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ArchitectDraft>
    if (!Array.isArray(parsed.messages)) return null
    return { messages: parsed.messages, manifest: parsed.manifest ?? null, draftId: parsed.draftId ?? null }
  } catch {
    return null
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
  } catch {
    // Storage unavailable — nothing to clear.
  }
}

/**
 * Conversational "architect" surface — chat with the model to design a copilot's
 * manifest. Posts the running conversation to `/api/agent-ops/architect` and
 * appends the assistant's reply. Once the model emits a structured manifest,
 * a "Manifest ready" card surfaces a summary with a primary action to hand
 * it off to the caller (typically the copilot-creation flow).
 */
export function ArchitectChat({ onManifest, onDraftId }: ArchitectChatProps) {
  const [messages, setMessages] = useState<ArchitectMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<GeneratedManifest | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [applied, setApplied] = useState(false)

  // Restore an in-progress draft (same tab) so a refresh doesn't lose the
  // conversation. One-shot mount sync with an external store (sessionStorage);
  // a lazy useState initializer would mismatch the server-rendered empty state.
  useEffect(() => {
    const draft = readDraft()
    if (draft && (draft.messages.length > 0 || draft.manifest !== null)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(draft.messages)
      setManifest(draft.manifest)
      setDraftId(draft.draftId)
      onDraftId?.(draft.draftId)
    }
    setHydrated(true)
  }, [])

  // Persist the draft as it evolves; stop (and purge) once the manifest is applied.
  useEffect(() => {
    if (!hydrated) return
    if (applied) {
      clearDraft()
      return
    }
    try {
      if (messages.length > 0 || manifest !== null) {
        window.sessionStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({ messages, manifest, draftId }),
        )
      } else {
        window.sessionStorage.removeItem(DRAFT_STORAGE_KEY)
      }
    } catch {
      // Storage unavailable — the beforeunload guard below still protects the work.
    }
  }, [hydrated, applied, messages, manifest, draftId])

  // Warn before refresh/close/external navigation while there is unsaved work.
  const hasUnsavedWork = messages.length > 0 || manifest !== null
  useEffect(() => {
    if (!hasUnsavedWork) return
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedWork])

  function handleApplyManifest() {
    if (!manifest || applied) return
    setApplied(true)
    clearDraft()
    onManifest?.(manifest)
  }

  async function handleSend() {
    const trimmed = input.trim()
    if (isSending || trimmed.length === 0) return

    const nextMessages: ArchitectMessage[] = [...messages, { role: 'user', content: trimmed }]
    setApplied(false)
    setMessages(nextMessages)
    setInput('')
    setIsSending(true)
    setError(null)

    try {
      const response = await fetch('/api/agent-ops/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, draftId: draftId ?? undefined }),
      })

      if (response.status === 503) {
        setError('Live backend not configured.')
        return
      }

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        setError(body?.error ?? `Architect request failed (${response.status}).`)
        return
      }

      const data = (await response.json()) as ArchitectResponseBody
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
      if (data.manifest) {
        setManifest(data.manifest)
      }
      if (data.draftId) {
        setDraftId(data.draftId)
        onDraftId?.(data.draftId)
      }
    } catch {
      setError('Live backend not configured.')
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleSend()
    }
  }

  return (
    <AgentSectionCard
      title="Architect"
      description="Describe the copilot you want and the architect will draft a manifest with you."
    >
      <div
        role="log"
        aria-live="polite"
        aria-label="Architect conversation"
        className="max-h-96 space-y-3 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Start by describing the copilot you want to build — its purpose, the data it should
            touch, and any guardrails it must respect.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={index}
              className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
            >
              <div
                className={
                  message.role === 'user'
                    ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-accent-600 px-4 py-2 text-sm text-zinc-950'
                    : 'max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 text-sm text-zinc-800 dark:bg-white/5 dark:text-zinc-200'
                }
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            </div>
          ))
        )}
        {isSending ? (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2 text-sm text-zinc-500 dark:bg-white/5 dark:text-zinc-400">
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-4" />
                Thinking…
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <Field>
          <Label>Message</Label>
          <Textarea
            name="architect-input"
            rows={3}
            placeholder="e.g. An agent that triages inbound support tickets and drafts replies…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
          />
        </Field>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button color="accent" onClick={handleSend} disabled={isSending || input.trim().length === 0}>
            {isSending ? 'Sending…' : 'Send'}
          </Button>
          {/* `!text-xs` dropped: `Text` now merges caller-last, so the bare class wins on its
              own. Measured on /admin/agents/new @1440 — 12px/16px, box 212x16, before and
              after. (The v3 prefix form was doubly wrong here: `tailwind-merge` v3 only reads
              the v4 suffix, so `!text-xs` never even entered the merge.) */}
          <Text className="text-xs">Enter to send, Shift+Enter for a new line.</Text>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {manifest ? (
        <div
          role="status"
          aria-live="polite"
          className="mt-4 rounded-lg bg-(--accent-soft) p-4 ring-1 ring-(--accent-line)"
        >
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
            Manifest ready
          </p>

          <ManifestRecap manifest={manifest} />

          <div className="mt-4">
            <Button color="accent" onClick={handleApplyManifest} disabled={applied}>
              {applied ? 'Applied' : 'Use this manifest →'}
            </Button>
          </div>
        </div>
      ) : null}
    </AgentSectionCard>
  )
}
