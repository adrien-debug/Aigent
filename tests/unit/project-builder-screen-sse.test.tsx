/**
 * The SSE chain of the ONE client screen in this console — `ProjectBuilderScreen`
 * — end to end, mounted for real (not just the protocol-level `consumeSSE`
 * tests in `project-builder-stream-protocol.test.ts`). Four things the mission
 * names explicitly, each pinned to an OBSERVABLE UI change, not an internal
 * state read:
 *
 *  1. CONNECTION — the initial mount fetch resolves and the empty-conversation
 *     state renders; the pill moves off "connecting".
 *  2. AN EVENT ACTUALLY CHANGING THE UI — a `delta` frame's text appears in the
 *     "architect · streaming" block WHILE the stream is still open, proving the
 *     component reacts per-frame rather than only after the stream closes.
 *  3. RECONNECTION — after a failed turn, clicking Retry re-fetches the
 *     conversation and the error banner clears (this app's vocabulary for
 *     re-establishing state after a drop; there is no live-socket reconnect to
 *     test because the transport is a one-shot POST, not a persistent socket).
 *  4. A VISIBLE DISCONNECTION — the stream closes with NO terminal frame
 *     (`IncompleteSSEStreamError`) and the operator sees a danger-role banner,
 *     not a silently stuck "running" pill.
 *
 * The stream is driven by a controller held open across `await act()` boundaries
 * so events arrive one at a time, the way a real network stream does — a single
 * pre-built ReadableStream with everything enqueued before the read loop starts
 * would not prove the second point.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectBuilderScreen } from '@/components/console/project-builder-screen'
import { encodeProjectBuilderSSE, type ProjectBuilderStreamEvent } from '@/lib/agent-mission-control/project-builder-stream-protocol'
import type { ProjectBuilderConversationBundle } from '@/lib/agent-mission-control/project-builder-types'

/** A stream whose chunks are pushed by the TEST, one at a time — never all
 *  enqueued up front, so "an event changes the UI while the stream is still
 *  open" is actually exercised rather than assumed. */
function controlledStream() {
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
    },
  })
  return {
    stream,
    push(event: ProjectBuilderStreamEvent) {
      controllerRef.enqueue(encoder.encode(encodeProjectBuilderSSE(event)))
    },
    close() {
      controllerRef.close()
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function emptyBundle(): ProjectBuilderConversationBundle {
  return {
    conversation: {
      id: 'pbconv-1',
      projectId: 'proj-1',
      status: 'active',
      langgraphThreadId: null,
      latestPreview: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    messages: [],
    repoSummary: null,
    createdCopilotId: null,
    runState: null,
  }
}

function mount() {
  return render(
    <ProjectBuilderScreen projectId="proj-1" projectName="TradeAgent" repoFullName="adrien-debug/TradeAgent" />
  )
}

describe('ProjectBuilderScreen — the SSE chain, mounted end to end', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('1 — CONNECTION: the mount fetch resolves and the pill leaves "connecting"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()

    // Before the fetch resolves, the pill is still "connecting" — the loading
    // empty state, not the "describe the agent" one.
    expect(screen.getByText('Loading the conversation…')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())
    expect(screen.getByText('completed')).toBeTruthy()
    // The read now carries an abort signal (cancelled on unmount / superseded
    // by Retry), so the call is asserted by URL plus the presence of a signal.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/projects/proj-1/builder/conversation',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('2 — AN EVENT ACTUALLY CHANGES THE UI: a delta frame appears on screen while the stream is still open', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()
    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

    const upstream = controlledStream()
    fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))

    fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    // `connected` moves the pill to "running" — proven BEFORE any delta.
    await act(async () => {
      upstream.push({ type: 'connected', lifecycle: 'running', runId: 'run-1', conversationId: 'pbconv-1', sequence: 1 })
    })
    await waitFor(() => expect(screen.getByText('running')).toBeTruthy())

    // The delta's own text reaches the screen while nothing has closed yet.
    await act(async () => {
      upstream.push({
        type: 'delta',
        lifecycle: 'running',
        runId: 'run-1',
        conversationId: 'pbconv-1',
        sequence: 2,
        delta: 'Checking the repository for existing risk tooling…',
      })
    })
    await waitFor(() =>
      expect(screen.getByText('Checking the repository for existing risk tooling…')).toBeTruthy()
    )
    // Still "running": the terminal has not arrived, so completion must not be
    // claimed early.
    expect(screen.getByText('running')).toBeTruthy()

    // Close the turn and hand back the updated bundle for the post-stream reload.
    const updatedBundle: ProjectBuilderConversationBundle = {
      ...emptyBundle(),
      messages: [
        {
          id: 'm-user-1',
          conversationId: 'pbconv-1',
          role: 'user',
          content: 'Build a risk monitor',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'm-assistant-1',
          conversationId: 'pbconv-1',
          role: 'assistant',
          content: 'Checking the repository for existing risk tooling… Done.',
          createdAt: new Date().toISOString(),
        },
      ],
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(updatedBundle))
    await act(async () => {
      upstream.push({
        type: 'terminal',
        lifecycle: 'completed',
        runId: 'run-1',
        conversationId: 'pbconv-1',
        sequence: 3,
        messageId: 'm-assistant-1',
        conversationStatus: 'active',
        preview: null,
        createdCopilotId: null,
      })
      upstream.close()
    })

    await waitFor(() => expect(screen.getByText('completed')).toBeTruthy())
    // The reconciled transcript replaces the streaming block — the persisted
    // assistant message is on screen, and the transient "streaming" label is gone.
    expect(screen.getByText('Checking the repository for existing risk tooling… Done.')).toBeTruthy()
    expect(screen.queryByText('architect · streaming')).toBeNull()
  })

  it('a FAILED terminal is reported as a failure, never silently converted into "completed"', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()
    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

    const upstream = controlledStream()
    fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))
    fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    await act(async () => {
      upstream.push({
        type: 'terminal',
        lifecycle: 'failed',
        runId: 'run-1',
        conversationId: 'pbconv-1',
        sequence: 1,
        error: 'architect_message_failed',
        retryable: true,
      })
      upstream.close()
    })

    await waitFor(() => expect(screen.getByText('failed')).toBeTruthy())
    const banner = screen.getByRole('alert')
    expect(within(banner).getByText(/could not answer this turn/)).toBeTruthy()
    expect(within(banner).getByText(/can be retried/)).toBeTruthy()
    // No reload is fired for a failed terminal — the fetch count stops at 2
    // (mount + the POST stream itself).
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('3 — RECONNECTION: Retry re-fetches the conversation and clears the banner', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()
    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

    const upstream = controlledStream()
    fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))
    fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))
    await act(async () => {
      upstream.push({
        type: 'terminal',
        lifecycle: 'failed',
        runId: 'run-1',
        conversationId: 'pbconv-1',
        sequence: 1,
        error: 'transport_interrupted',
        retryable: true,
      })
      upstream.close()
    })
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())

    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByText('completed')).toBeTruthy()
  })

  it('4 — A VISIBLE DISCONNECTION: the stream closes with no terminal frame at all', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()
    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

    const upstream = controlledStream()
    fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))
    fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/ }))

    await act(async () => {
      upstream.push({ type: 'connected', lifecycle: 'running', runId: 'run-1', conversationId: 'pbconv-1', sequence: 1 })
    })
    await waitFor(() => expect(screen.getByText('running')).toBeTruthy())

    // The transport drops mid-turn: the stream closes, no terminal frame ever
    // arrived. `requireTerminal: true` must turn this into a visible failure,
    // not a pill stuck on "running" forever.
    await act(async () => {
      upstream.close()
    })

    await waitFor(() => expect(screen.getByText('failed')).toBeTruthy())
    const banner = screen.getByRole('alert')
    expect(within(banner).getByText(/Stream closed before a terminal event was received/)).toBeTruthy()
    // The half-arrived block must not linger under the danger banner.
    expect(screen.queryByText('architect · streaming')).toBeNull()
  })

  describe('lifecycle — abort on unmount and inactivity watchdog', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('abort on unmount: the in-flight stream is cancelled and no post-unmount setState happens', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
      const { unmount } = mount()
      await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

      const upstream = controlledStream()
      let capturedSignal: AbortSignal | undefined
      fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return Promise.resolve(new Response(upstream.stream, { status: 200 }))
      })

      fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
      fireEvent.click(screen.getByRole('button', { name: /Send/ }))

      await act(async () => {
        upstream.push({ type: 'connected', lifecycle: 'running', runId: 'run-1', conversationId: 'pbconv-1', sequence: 1 })
      })
      await waitFor(() => expect(screen.getByText('running')).toBeTruthy())

      expect(capturedSignal?.aborted).toBe(false)

      // React would warn ("state update on an unmounted component") if a
      // stray setState landed after this; vitest fails the test on console.error.
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      await act(async () => {
        unmount()
      })

      expect(capturedSignal?.aborted).toBe(true)

      // The abort already cancelled the reader (and with it the stream), so
      // there is nothing left to push — the point being verified is that the
      // abort itself produced no post-unmount React update.
      expect(consoleError).not.toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('inactivity watchdog: no event for the full window aborts the stream with an explicit state', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
      mount()
      await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

      const upstream = controlledStream()
      fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))
      fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
      fireEvent.click(screen.getByRole('button', { name: /Send/ }))

      await act(async () => {
        upstream.push({ type: 'connected', lifecycle: 'running', runId: 'run-1', conversationId: 'pbconv-1', sequence: 1 })
      })
      await waitFor(() => expect(screen.getByText('running')).toBeTruthy())

      // No further event ever arrives — advance past the watchdog window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000)
      })

      await waitFor(() => expect(screen.getByText('failed')).toBeTruthy())
      const banner = screen.getByRole('alert')
      expect(within(banner).getByText(/interrupted by inactivity/)).toBeTruthy()
    })

    it('an event before the timeout re-arms the watchdog — no timeout fires', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
      mount()
      await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

      const upstream = controlledStream()
      fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))
      fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
      fireEvent.click(screen.getByRole('button', { name: /Send/ }))

      await act(async () => {
        upstream.push({ type: 'connected', lifecycle: 'running', runId: 'run-1', conversationId: 'pbconv-1', sequence: 1 })
      })
      await waitFor(() => expect(screen.getByText('running')).toBeTruthy())

      // Just under the window, then a delta resets the clock.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80_000)
      })
      await act(async () => {
        upstream.push({
          type: 'delta',
          lifecycle: 'running',
          runId: 'run-1',
          conversationId: 'pbconv-1',
          sequence: 2,
          delta: 'still working…',
        })
      })
      // Another 80s (170s total since connect) — would have fired a naive
      // one-shot timeout, must not fire a re-armed one.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(80_000)
      })

      expect(screen.getByText('running')).toBeTruthy()
      expect(screen.queryByText(/interrupted by inactivity/)).toBeNull()

      // Close it out cleanly so the test doesn't leak a pending stream.
      const updatedBundle = { ...emptyBundle() }
      fetchMock.mockResolvedValueOnce(jsonResponse(updatedBundle))
      await act(async () => {
        upstream.push({
          type: 'terminal',
          lifecycle: 'completed',
          runId: 'run-1',
          conversationId: 'pbconv-1',
          sequence: 3,
          messageId: 'm-1',
          conversationStatus: 'active',
          preview: null,
          createdCopilotId: null,
        })
        upstream.close()
      })
      await waitFor(() => expect(screen.getByText('completed')).toBeTruthy())
    })

    it('a terminal event disarms the watchdog: no residual timer, no late timeout', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
      mount()
      await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())

      const upstream = controlledStream()
      fetchMock.mockResolvedValueOnce(new Response(upstream.stream, { status: 200 }))
      fireEvent.change(screen.getByPlaceholderText(/Describe the mission/), { target: { value: 'Build a risk monitor' } })
      fireEvent.click(screen.getByRole('button', { name: /Send/ }))

      const updatedBundle = { ...emptyBundle() }
      fetchMock.mockResolvedValueOnce(jsonResponse(updatedBundle))
      await act(async () => {
        upstream.push({
          type: 'terminal',
          lifecycle: 'completed',
          runId: 'run-1',
          conversationId: 'pbconv-1',
          sequence: 1,
          messageId: 'm-1',
          conversationStatus: 'active',
          preview: null,
          createdCopilotId: null,
        })
        upstream.close()
      })
      await waitFor(() => expect(screen.getByText('completed')).toBeTruthy())

      // No pending timers left — a terminal disarms the watchdog rather than
      // leaving it to fire later and flip a completed turn back to failed.
      expect(vi.getTimerCount()).toBe(0)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000)
      })
      expect(screen.getByText('completed')).toBeTruthy()
      expect(screen.queryByText(/interrupted by inactivity/)).toBeNull()
    })
  })
})
