/**
 * `ImprovePanel` — the console's one entry point onto the real improvement
 * loop (`improvement-loop.ts`) via the three existing routes: analyze,
 * create-v2, decision. Every network call in this file is MOCKED — no real
 * LLM completion is ever triggered by these tests.
 *
 * What is pinned:
 *  1. an available analysis renders the proposal (sources, manifest changes);
 *  2. "nothing to improve" is a distinct message, not a generic failure;
 *  3. an unavailable source (e.g. runtime telemetry) renders "unavailable",
 *     never "0" and never a healthy dot;
 *  4. V2 creation moves the panel into the approve/reject state;
 *  5. a 409 "cycle already open" renders as a plain sentence, not a crash;
 *  6. approve/reject persist the decision and never call any promotion route.
 *
 * Both billed actions (analyze, create-v2) require an explicit confirm click
 * before the network call fires — asserted directly by checking fetch was NOT
 * called until after the confirm button is clicked.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ImprovePanel } from '@/components/console/improve-panel'
import type { ImprovementProposal, ImprovementSources } from '@/lib/agent-mission-control/improvement-loop'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function baseSources(overrides: Partial<ImprovementSources> = {}): ImprovementSources {
  return { db: true, langgraph: true, langsmith: false, langsmithReason: 'LANGSMITH_API_KEY not set', runtimeTelemetry: true, ...overrides }
}

function makeProposal(overrides: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: 'prop-1',
    copilotId: 'cop-1',
    baseVersionId: 'ver-1',
    v2VersionId: null,
    v2ManifestId: null,
    status: 'proposed',
    summary: 'Tightens confirmation policy after two unsafe-action failures.',
    failureAnalysis: [],
    manifestChanges: {
      confirmationPolicy: { from: 'risky-only', to: 'always', why: 'Two cases attempted an unsafe action without confirming.' },
    },
    sources: baseSources(),
    costUsd: 0.02,
    createdAt: new Date().toISOString(),
    createdBy: 'console-operator',
    decidedBy: null,
    decidedAt: null,
    ...overrides,
  }
}

function mount(props: Partial<React.ComponentProps<typeof ImprovePanel>> = {}) {
  return render(
    <ImprovePanel
      copilotId="cop-1"
      baseVersionLabel="v1.2.0"
      initialProposal={null}
      initialComparison={null}
      {...props}
    />
  )
}

describe('ImprovePanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('1 — no cycle yet: analyze requires an explicit confirm before the billed call fires', async () => {
    mount()
    expect(screen.getByText('No improvement cycle has been run for this copilot.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    expect(screen.getByText('This runs a billed gpt-5.4 completion.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, proposal: makeProposal(), sources: baseSources() }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm analyze' }))
    })

    await waitFor(() => expect(screen.getByText('proposed')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/copilots/cop-1/improve/analyze',
      expect.objectContaining({ method: 'POST' })
    )
    // The proposed manifest change is visible.
    expect(screen.getByText('Confirmation policy')).toBeTruthy()
    expect(screen.getByText('always')).toBeTruthy()
  })

  it('2 — "nothing to improve" renders its own message, not a generic failure', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'nothing to improve: every suite passes and runtime telemetry is healthy' }, 502)
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm analyze' }))
    })

    await waitFor(() => expect(screen.getByText('Nothing to improve right now.')).toBeTruthy())
    expect(screen.queryByText('Analysis failed.')).toBeNull()
  })

  it('3 — an unavailable source renders "unavailable" with its reason, never a healthy dot or a zero', async () => {
    const proposal = makeProposal({
      sources: baseSources({ runtimeTelemetry: false, runtimeTelemetryReason: 'copilot has no project_id' }),
    })
    mount({ initialProposal: proposal })

    expect(screen.getByText('Deployed runtime telemetry')).toBeTruthy()
    expect(screen.getByText('(copilot has no project_id)')).toBeTruthy()
    // Two "unavailable" dots: LangSmith (seeded false above) and runtime telemetry.
    expect(screen.getAllByText('unavailable').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('0')).toBeNull()
  })

  it('4 — create-v2 requires confirmation, then moves the panel to approve/reject', async () => {
    const proposal = makeProposal({ status: 'proposed' })
    mount({ initialProposal: proposal })

    fireEvent.click(screen.getByRole('button', { name: 'Create V2 draft' }))
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, v2VersionId: 'ver-2', v2ManifestId: 'man-2', label: 'v1.3.0-draft' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm create V2' }))
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/copilots/cop-1/improve/create-v2',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ proposalId: 'prop-1' }) })
    )
    await waitFor(() => expect(screen.getByText('v2-created')).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
    // No promotion route was ever called by this panel.
    const promotionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/promotion'))
    expect(promotionCalls).toHaveLength(0)
  })

  it('5 — analyze 409 (cycle already open) renders a plain sentence, not a crash', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'an improvement cycle is already open for this copilot — decide it first', proposalId: 'prop-9' }, 409)
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm analyze' }))
    })

    await waitFor(() =>
      expect(screen.getByText('An improvement cycle is already open for this copilot.')).toBeTruthy()
    )
    // Still on the empty state — no proposal was fabricated from the 409 body.
    expect(screen.getByText('No improvement cycle has been run for this copilot.')).toBeTruthy()
  })

  it('6a — approve persists the decision and never calls a promotion route', async () => {
    const proposal = makeProposal({ status: 'v2-created', v2VersionId: 'ver-2' })
    mount({ initialProposal: proposal })

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'approved' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/copilots/cop-1/improve/decision',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ proposalId: 'prop-1', decision: 'approved', decidedBy: 'console-operator' }),
      })
    )
    await waitFor(() => expect(screen.getByText('approved')).toBeTruthy())
    const promotionCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/promotion'))
    expect(promotionCalls).toHaveLength(0)
  })

  it('6b — reject persists the decision', async () => {
    const proposal = makeProposal({ status: 'v2-created', v2VersionId: 'ver-2' })
    mount({ initialProposal: proposal })

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, status: 'rejected' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    })

    await waitFor(() => expect(screen.getByText('rejected')).toBeTruthy())
  })

  it('7 — unmount during an in-flight analyze does not write state or warn', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }))

    let resolveFetch!: (value: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFetch = resolve }))

    fireEvent.click(screen.getByRole('button', { name: 'Confirm analyze' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    unmount()

    await act(async () => {
      resolveFetch(jsonResponse({ ok: true, proposal: makeProposal(), sources: baseSources() }))
      await Promise.resolve()
    })

    const postUnmountWarnings = consoleError.mock.calls.filter(([first]) =>
      String(first).includes('unmounted component') || String(first).includes('not wrapped in act')
    )
    expect(postUnmountWarnings).toEqual([])
  })
})
