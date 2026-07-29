import type { ProjectBuilderStreamEvent } from './project-builder-stream-protocol'

export class IncompleteSSEStreamError extends Error {
  constructor(message = 'Stream closed before a terminal event was received.') {
    super(message)
    this.name = 'IncompleteSSEStreamError'
  }
}

export type ConsumeSSEResult<T> = {
  events: number
  malformedFrames: number
  terminalEvent: T | null
}

type ConsumeSSEOptions<T> = {
  isTerminal?: (event: T) => boolean
  requireTerminal?: boolean
  signal?: AbortSignal
}

function dataFromFrame(frame: string): string | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  return data.length > 0 ? data.join('\n') : null
}

export async function consumeSSE<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void,
  options: ConsumeSSEOptions<T> = {}
): Promise<ConsumeSSEResult<T>> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let events = 0
  let malformedFrames = 0
  let terminalEvent: T | null = null

  const consumeFrame = (frame: string) => {
    const raw = dataFromFrame(frame)
    if (raw === null) return
    try {
      const event = JSON.parse(raw) as T
      events += 1
      onEvent(event)
      if (options.isTerminal?.(event)) terminalEvent = event
    } catch {
      malformedFrames += 1
    }
  }

  const onAbort = () => void reader.cancel(options.signal?.reason)
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        consumeFrame(buffer.slice(0, separator))
        buffer = buffer.slice(separator + 2)
        separator = buffer.indexOf('\n\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim().length > 0) consumeFrame(buffer)
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }

  if (options.requireTerminal && terminalEvent === null) {
    throw new IncompleteSSEStreamError()
  }
  return { events, malformedFrames, terminalEvent }
}

export function isProjectBuilderTerminal(
  event: ProjectBuilderStreamEvent
): event is Extract<ProjectBuilderStreamEvent, { type: 'terminal' }> {
  return event.type === 'terminal'
}
