/**
 * `AgentActionsPanel` — the console's first writing surface (run / test /
 * benchmark). Covers exactly what the mission asked for:
 *
 *  1. executable agent → live buttons render
 *  2. non-executable agent → buttons are replaced by the blocker reasons,
 *     never a dead/disabled button pretending to be live
 *  3. success → the result renders from the route's own response
 *  4. error → the route's `{ error }` message renders, not a generic string
 *  5. double click → exactly ONE fetch fires (the in-flight guard)
 *  6. unmount mid-request → no React "state update on an unmounted
 *     component" warning, i.e. no setState after unmount
 *
 * Every test mocks `fetch` — no real billed call is ever made here.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentActionsPanel } from '@/components/console/agent-actions'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('AgentActionsPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    // React logs unmounted-setState warnings via console.error — assert none fired.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1 — non-executable: renders the blocker reasons, no live action button', () => {
    render(
      <AgentActionsPanel
        copilotId="copilot-1"
        executable={false}
        blockers={[{ code: 'status', label: 'Status is draft, not active' }]}
        testSuiteId={null}
        benchmarkSuiteId={null}
      />
    )

    expect(screen.getByText('Actions blocked')).toBeInTheDocument()
    expect(screen.getByText('Status is draft, not active')).toBeInTheDocument()
    expect(screen.queryByText('Run agent')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2 — executable: the run button is armed, then confirmed, then fires exactly one request', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ok: true, runId: 'run-1', status: 'completed' })
    )

    render(
      <AgentActionsPanel
        copilotId="copilot-1"
        executable
        blockers={[]}
        testSuiteId={null}
        benchmarkSuiteId={null}
      />
    )

    fireEvent.click(screen.getByText('Run agent'))
    expect(screen.getByText(/Confirm/)).toBeInTheDocument()
    // Not fired yet — arming is not confirming.
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(/Confirm/))

    await waitFor(() => expect(screen.getByText(/Run completed/)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/agent-ops/copilots/copilot-1/run')
    expect(init.method).toBe('POST')
  })

  it('3 — error: the route error message renders', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'copilot is not executable' }, 409))

    render(
      <AgentActionsPanel
        copilotId="copilot-1"
        executable
        blockers={[]}
        testSuiteId="suite-1"
        benchmarkSuiteId={null}
      />
    )

    fireEvent.click(screen.getByText('Run tests'))
    fireEvent.click(screen.getByText(/Confirm/))

    await waitFor(() => expect(screen.getByText('copilot is not executable')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('4 — double click on Confirm fires exactly one request', async () => {
    let resolveFetch!: (value: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    )

    render(
      <AgentActionsPanel
        copilotId="copilot-1"
        executable
        blockers={[]}
        testSuiteId={null}
        benchmarkSuiteId="bench-1"
      />
    )

    fireEvent.click(screen.getByText('Run benchmark'))
    const confirmButton = screen.getByText(/Confirm/)
    fireEvent.click(confirmButton)
    // A second click lands while the first call is still in flight (button
    // now reads "Benchmarking…", so re-query it — same underlying trigger).
    fireEvent.click(screen.getByText('Benchmarking…'))
    fireEvent.click(screen.getByText('Benchmarking…'))

    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, benchmarkRun: { id: 'bench-run-1', status: 'completed' } }))
    })

    await waitFor(() => expect(screen.getByText(/Benchmark completed/)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('5 — unmount mid-request: no state update after unmount', async () => {
    let resolveFetch!: (value: Response) => void
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve
      })
    )

    const { unmount } = render(
      <AgentActionsPanel
        copilotId="copilot-1"
        executable
        blockers={[]}
        testSuiteId={null}
        benchmarkSuiteId={null}
      />
    )

    fireEvent.click(screen.getByText('Run agent'))
    fireEvent.click(screen.getByText(/Confirm/))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, runId: 'run-2', status: 'completed' }))
      // Let the resolved promise's .then/.finally microtasks flush.
      await Promise.resolve()
      await Promise.resolve()
    })

    const unmountedStateWarning = consoleErrorSpy.mock.calls.some((call: unknown[]) =>
      String(call[0]).includes('unmounted')
    )
    expect(unmountedStateWarning).toBe(false)
  })
})
