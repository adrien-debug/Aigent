'use client'

import { useState } from 'react'

import { ErrorBanner, ManifestSummaryCard, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Text } from '@/components/catalyst/text'
import { Textarea } from '@/components/catalyst/textarea'
import type { ArchitectMessage, GeneratedManifest } from '@/lib/agent-mission-control/authoring-types'

interface ArchitectChatProps {
  onManifest?: (manifest: GeneratedManifest) => void
}

interface ArchitectResponseBody {
  reply: string
  manifest: GeneratedManifest | null
}

/**
 * Conversational "architect" surface — chat with the model to design a copilot's
 * manifest. Posts the running conversation to `/api/agent-ops/architect` and
 * appends the assistant's reply. Once the model emits a structured manifest,
 * a "Manifest ready" card surfaces a summary with a primary action to hand
 * it off to the caller (typically the copilot-creation flow).
 */
export function ArchitectChat({ onManifest }: ArchitectChatProps) {
  const [messages, setMessages] = useState<ArchitectMessage[]>([])
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<GeneratedManifest | null>(null)

  async function handleSend() {
    const trimmed = input.trim()
    if (isSending || trimmed.length === 0) return

    const nextMessages: ArchitectMessage[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(nextMessages)
    setInput('')
    setIsSending(true)
    setError(null)

    try {
      const response = await fetch('/api/agent-ops/architect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages }),
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
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 px-6 py-4 dark:border-white/5">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">Architect</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Describe the copilot you want and the architect will draft a manifest with you.
        </p>
      </div>

      <div className="px-6 py-5">
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
                      ? 'max-w-[85%] rounded-2xl rounded-br-sm bg-accent-600 px-4 py-2 text-sm text-white'
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
          <div className="mt-3 flex items-center gap-3">
            <Button color="accent" onClick={handleSend} disabled={isSending || input.trim().length === 0}>
              {isSending ? 'Sending…' : 'Send'}
            </Button>
            <Text className="!mt-0 !text-xs">Enter to send, Shift+Enter for a new line.</Text>
          </div>
        </div>

        {error ? <ErrorBanner message={error} /> : null}

        {manifest ? (
          <div className="mt-4 rounded-lg bg-accent-500/5 p-4 ring-1 ring-accent-500/20">
            <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
              Manifest ready
            </p>

            <ManifestSummaryCard manifest={manifest} />

            <div className="mt-4">
              <Button color="accent" onClick={() => onManifest?.(manifest)}>
                Use this manifest →
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
