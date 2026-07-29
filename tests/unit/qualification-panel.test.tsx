/**
 * QualificationPanel — the client panel exposing qualification / shadow /
 * replay on the agent detail screen (AIGENT-CONSOLE-SHADOW-REPLAY-B-001).
 *
 * All network calls are mocked — this suite never drives a real Shadow,
 * Replay or qualification sweep (those are costed, real LangGraph runs).
 * What is pinned here:
 *   1. a valid candidate version renders the targeted version and its evidence
 *   2. no candidate version disables every action with a stated reason
 *   3. a route error surfaces as text, not a silent blank panel
 *   4. a BLOCKED shadow result renders "Blocked", distinct from failed/completed
 *   5. a COMPLETED (live_langgraph) result renders "Completed" with real provenance
 *   6. an absent evidence source ("unread"/never-run) renders "Not run", never a
 *      fabricated zero or a false "Completed"
 *   7. no setState-after-unmount warning when the component unmounts mid-fetch
 *   8. the confirm step: a single click never fires the network call, only the
 *      second (confirm) click does — no accidental costed run
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { QualificationPanel } from '@/components/console/qualification-panel'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockThreeReads({
  qualification,
  shadow,
  replay,
}: {
  qualification: unknown
  shadow: unknown
  replay: unknown
}) {
  return (url: string) => {
    if (url.includes('/qualification')) return Promise.resolve(jsonResponse(qualification))
    if (url.includes('/shadow')) return Promise.resolve(jsonResponse({ ok: true, experiment: shadow }))
    if (url.includes('/replay')) return Promise.resolve(jsonResponse({ ok: true, comparison: replay }))
    return Promise.resolve(jsonResponse({}, 404))
  }
}

const notStartedReadiness = {
  readiness: {
    state: 'not_started',
    promotable: false,
    nextAction: 'Qualification not started — start it to evaluate this candidate version.',
    blockers: [],
    candidateVersionId: 'ver-1',
    runId: null,
    steps: [],
  },
}

describe('QualificationPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1 — valid version: renders the targeted version and evidence panels', async () => {
    fetchMock.mockImplementation(
      mockThreeReads({ qualification: notStartedReadiness, shadow: null, replay: null }),
    )
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )

    await waitFor(() => expect(screen.getByText(/Targets version v0\.2\.0-draft \(draft\)/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Run qualification' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run shadow' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run replay' })).toBeTruthy()
  })

  it('2 — no candidate version: actions are disabled with a stated reason', async () => {
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId={null}
        candidateVersionLabel={null}
        candidateVersionStage={null}
      />,
    )

    expect(screen.getByText('No candidate version.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('3 — route error: surfaces as text, not a silent blank panel', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: 'boom' }, 502)))
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )

    await waitFor(() =>
      expect(screen.getByText(/Evidence could not be loaded/)).toBeTruthy(),
    )
  })

  it('4 — BLOCKED: a would-mutate shadow result renders Blocked, not Failed/Completed', async () => {
    fetchMock.mockImplementation(
      mockThreeReads({
        qualification: notStartedReadiness,
        shadow: {
          id: 'shadow-1',
          status: 'completed',
          verdict: 'FAIL',
          executionMode: 'live_langgraph',
          sampledRunCount: 3,
          wouldMutateCount: 2,
          startedAt: new Date().toISOString(),
          endsAt: new Date().toISOString(),
        },
        replay: null,
      }),
    )
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )

    await waitFor(() => expect(screen.getByText('Blocked')).toBeTruthy())
    expect(screen.getByText(/Mutations blocked:/)).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.queryByText('Completed')).toBeNull()
    expect(screen.queryByText('Failed')).toBeNull()
  })

  it('5 — COMPLETED: a live_langgraph PASS renders Completed with real provenance', async () => {
    fetchMock.mockImplementation(
      mockThreeReads({
        qualification: notStartedReadiness,
        shadow: null,
        replay: {
          id: 'replay-1',
          status: 'matched',
          verdict: 'EQUIVALENT',
          executionMode: 'live_langgraph',
          caseCount: 5,
          createdAt: new Date().toISOString(),
        },
      }),
    )
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )

    await waitFor(() => expect(screen.getByText('Completed')).toBeTruthy())
    expect(screen.getByText('live_langgraph')).toBeTruthy()
    expect(screen.queryByText(/simulated/)).toBeNull()
  })

  it('6 — source unavailable: never-run evidence renders "Not run", never a fabricated result', async () => {
    fetchMock.mockImplementation(
      mockThreeReads({ qualification: notStartedReadiness, shadow: null, replay: null }),
    )
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )

    await waitFor(() => expect(screen.getAllByText('Not run').length).toBe(2))
    expect(screen.queryByText('Completed')).toBeNull()
    expect(screen.queryByText('Blocked')).toBeNull()
  })

  it('7 — unmount mid-fetch: no post-unmount setState warning', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let resolveQual!: (v: Response) => void
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/qualification')) {
        return new Promise<Response>((resolve) => {
          resolveQual = resolve
        })
      }
      return Promise.resolve(jsonResponse({ ok: true, experiment: null, comparison: null }))
    })

    const { unmount } = render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )

    // The panel defers its first read by one microtask (avoids a
    // set-state-in-effect lint violation) — let it actually start the fetch
    // before unmounting, or `resolveQual` is never assigned.
    await act(async () => {
      await Promise.resolve()
    })

    unmount()
    await act(async () => {
      resolveQual(jsonResponse(notStartedReadiness))
      await Promise.resolve()
    })

    const postUnmountWarnings = consoleError.mock.calls.filter(([first]) =>
      String(first).includes('unmounted component') || String(first).includes('not wrapped in act'),
    )
    expect(postUnmountWarnings).toEqual([])
  })

  it('8 — confirm gate: a single click never fires the network call; the second (confirm) click does', async () => {
    fetchMock.mockImplementation(
      mockThreeReads({ qualification: notStartedReadiness, shadow: null, replay: null }),
    )
    render(
      <QualificationPanel
        copilotId="cop-1"
        candidateVersionId="ver-1"
        candidateVersionLabel="v0.2.0-draft"
        candidateVersionStage="draft"
      />,
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run shadow' })).toBeTruthy())

    const readCallsBefore = fetchMock.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Run shadow' }))
    // Arming the confirm must not have fired a POST.
    expect(fetchMock.mock.calls.length).toBe(readCallsBefore)
    expect(
      fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'),
    ).toBe(false)

    const confirmButton = screen.getByRole('button', { name: 'Confirm — launch live shadow' })
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, experimentId: 'shadow-2', verdict: 'PASS' }))
    await act(async () => {
      fireEvent.click(confirmButton)
      await Promise.resolve()
    })

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes('/shadow') && (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    )
  })
})
