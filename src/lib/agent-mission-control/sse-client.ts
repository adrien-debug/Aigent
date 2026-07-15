/**
 * Shared client-side SSE reader.
 *
 * Extracted verbatim from the inline `consumeSSE` in
 * `project-agent-builder-workbench.tsx` (the project-builder streaming client)
 * so a second streaming surface — the tests "Run tests" button — can reuse the
 * exact same frame-parsing behaviour instead of re-implementing it. The
 * workbench keeps its own local copy (nothing there changes); this module is a
 * shared, generic version for new callers.
 *
 * Reads an SSE body (`data: {...}\n\n` frames) and invokes `onEvent` for each
 * parsed JSON payload as it arrives. Malformed frames are skipped rather than
 * throwing, since a single bad frame should not abort an otherwise-good stream.
 * Returns once the stream closes. The event shape is caller-defined via the
 * generic `T` — the reader only knows how to split frames and JSON.parse them.
 */
export async function consumeSSE<T>(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: T) => void
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
          onEvent(JSON.parse(raw) as T)
        } catch {
          // Skip malformed frame — do not abort the whole stream over it.
        }
      }
      sepIndex = buffer.indexOf('\n\n')
    }
  }
}
