export const PROJECT_BUILDER_HEARTBEAT_MS = 15_000

type EventBase = {
  runId: string
  conversationId: string | null
  sequence: number
}

export type ProjectBuilderStreamEvent =
  | (EventBase & { type: 'connected'; lifecycle: 'running' })
  | (EventBase & { type: 'delta'; lifecycle: 'running'; delta: string })
  | (EventBase & {
      type: 'terminal'
      lifecycle: 'completed'
      messageId: string
      conversationStatus: string
      preview: unknown
      createdCopilotId: string | null
    })
  | (EventBase & {
      type: 'terminal'
      lifecycle: 'failed'
      error: 'architect_message_failed' | 'transport_interrupted' | 'persistence_timeout'
      retryable: boolean
    })

export function encodeProjectBuilderSSE(event: ProjectBuilderStreamEvent): string {
  return `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

export function encodeProjectBuilderHeartbeat(runId: string, sequence: number): string {
  return `: heartbeat run=${runId} sequence=${sequence}\n\n`
}
