/**
 * The INITIAL CONVERSATION READ of `ProjectBuilderScreen` — the fetch that runs
 * on mount, before any stream exists.
 *
 * Distinct from `project-builder-screen-sse.test.tsx`, which covers the SSE
 * turn (`/builder/message?stream=1`). What is pinned here is the read that
 * gates it: `/builder/conversation`. The mission behind this file reported the
 * screen "stuck on Loading the conversation… forever" after a 401. Mounted for
 * real, that was NOT reproducible — the banner, the wording and Retry were
 * already correct, and the loading frame observed in a browser snapshot was
 * simply the in-flight state captured before the fetch resolved.
 *
 * Two real defects did survive that check, and they are what tests 3 and 6
 * lock down:
 *
 *  · a failed read left the COMPOSER LIVE, so Enter would POST the message
 *    route and open an SSE stream against the session that had just refused
 *    the read — a second failure the operator never asked for;
 *  · `retry()` and `materialize()` wrote state after their `await` with no
 *    unmount guard, and the mount read had no abort at all.
 *
 * Every assertion below is on OBSERVABLE output (rendered text, `disabled`,
 * whether a URL was fetched) rather than on internal state.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectBuilderScreen } from '@/components/console/project-builder-screen'
import type { ProjectBuilderConversationBundle } from '@/lib/agent-mission-control/project-builder-types'

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

/** The composer textarea — the control that must go dead on a failed read. */
function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/describe/i) as HTMLTextAreaElement
}

describe('ProjectBuilderScreen — the initial conversation read', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1 — SUCCESS: loading gives way to the conversation and the composer is usable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()

    // The loading frame is real — it is the in-flight state, not a hang.
    expect(screen.getByText('Loading the conversation…')).toBeTruthy()

    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())
    expect(screen.getByText('completed')).toBeTruthy()
    expect(screen.queryByText('Loading the conversation…')).toBeNull()
    expect(composer().disabled).toBe(false)
  })

  it('2 — 401: an explicit session message replaces the loading state, with Retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    mount()

    await waitFor(() =>
      expect(screen.getByText('Your session has expired — sign in again to use the builder.')).toBeTruthy()
    )

    // The specific 401 wording, NOT the generic outage sentence: the backend
    // answered, it just refused this session.
    expect(screen.queryByText('Conversation is unavailable.')).toBeNull()
    // No lingering loading frame, and no cheerful invitation to type either.
    expect(screen.queryByText('Loading the conversation…')).toBeNull()
    expect(screen.getByText('Conversation could not be loaded')).toBeTruthy()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('3 — 401: NO SSE STREAM can start while the initial read has failed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    mount()

    await waitFor(() => expect(screen.getByText('failed')).toBeTruthy())

    // The composer is dead, so the operator cannot type a turn...
    expect(composer().disabled).toBe(true)

    // ...and even driving the control directly must not reach the stream route.
    fireEvent.change(composer(), { target: { value: 'build me an agent' } })
    const sendButton = screen.getByRole('button', { name: /send/i })
    expect((sendButton as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      fireEvent.click(sendButton)
    })

    const streamCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/builder/message'))
    expect(streamCalls).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('4 — NETWORK ERROR: a rejected fetch is reported, not swallowed into a hang', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mount()

    await waitFor(() => expect(screen.getByText('failed')).toBeTruthy())
    // The thrown Error's own message is surfaced rather than a generic label.
    expect(screen.getByText('Failed to fetch')).toBeTruthy()
    expect(screen.queryByText('Loading the conversation…')).toBeNull()
    expect(composer().disabled).toBe(true)
  })

  it('5 — RETRY: a failed read recovers, the banner clears and the composer comes back', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
      .mockResolvedValueOnce(jsonResponse(emptyBundle()))
    mount()

    await waitFor(() => expect(screen.getByText('failed')).toBeTruthy())

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    })

    await waitFor(() => expect(screen.getByText('Describe the agent you need')).toBeTruthy())
    expect(screen.queryByText('Your session has expired — sign in again to use the builder.')).toBeNull()
    expect(screen.queryByText('Conversation could not be loaded')).toBeNull()
    expect(screen.getByText('completed')).toBeTruthy()
    // The whole point of recovering: sending is possible again.
    expect(composer().disabled).toBe(false)
  })

  it('6 — UNMOUNT: the in-flight read is aborted and no state is written afterwards', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    // A read that never settles on its own — only the unmount abort ends it.
    let rejectFetch!: (reason: unknown) => void
    let capturedSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise((_resolve, reject) => {
        rejectFetch = reject
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })

    const { unmount } = mount()
    expect(screen.getByText('Loading the conversation…')).toBeTruthy()
    expect(capturedSignal?.aborted).toBe(false)

    unmount()

    // The request is actually cancelled, not merely ignored.
    expect(capturedSignal?.aborted).toBe(true)

    // Settling after teardown must not warn about a post-unmount setState.
    await act(async () => {
      rejectFetch(new DOMException('Aborted', 'AbortError'))
      await Promise.resolve()
    })

    const postUnmountWarnings = consoleError.mock.calls.filter(([first]) =>
      String(first).includes('unmounted component') || String(first).includes('not wrapped in act')
    )
    expect(postUnmountWarnings).toEqual([])
  })
})
