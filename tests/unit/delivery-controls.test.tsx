/**
 * Governed promotion + delivery controls (`delivery-controls.tsx`).
 *
 * Every network call in this suite is a MOCKED `global.fetch` — no real
 * request ever reaches `/api/agent-ops/**`. `confirm:true` is asserted to be
 * ABSENT from the default dry-run push body, and never sent by any test here
 * (the mission's absolute security constraint: no real GitHub write from a
 * test, ever).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DeliveryControls } from '@/components/console/delivery-controls'
import type { Blocker } from '@/lib/agent-mission-control/agent-detail'
import type { Copilot, CopilotVersion } from '@/lib/agent-mission-control/types'

function makeCopilot(overrides: Partial<Copilot> = {}): Copilot {
  return {
    id: 'copilot-test-1',
    projectId: 'proj-test-1',
    targetProjectIds: [],
    name: 'Test Copilot',
    slug: 'test-copilot',
    description: '',
    runtime: 'langgraph',
    status: 'draft',
    productionVersionId: null,
    latestVersionId: 'version-candidate',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'test',
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    health: {
      testPassRate: 0,
      benchmarkScore: 0,
      runsLast24h: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: 0,
    },
    ...overrides,
  } as Copilot
}

function makeVersion(id: string, label: string): CopilotVersion {
  return { id, copilotId: 'copilot-test-1', label, stage: 'draft', manifestId: 'manifest-1' } as CopilotVersion
}

const candidateVersion = makeVersion('version-candidate', 'v2.0.0-draft')

/**
 * The panel asks `GET /api/agent-ops/delivery-capability` once on mount, before
 * any user action. Every mock here answers that call by URL so the ACTION
 * response can no longer be consumed by the capability read — and so each test
 * states plainly whether real delivery is enabled in its scenario.
 */
function capabilityResponse(realDeliveryEnabled: boolean | 'fail') {
  if (realDeliveryEnabled === 'fail') return Promise.reject(new Error('capability unreachable'))
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ realDeliveryEnabled }) })
}

function mockFetchOnce(status: number, body: unknown, realDeliveryEnabled: boolean | 'fail' = false) {
  const action = { ok: status >= 200 && status < 300, status, json: async () => body }
  return vi.fn((url: string, _init?: RequestInit) =>
    String(url).includes('/delivery-capability')
      ? capabilityResponse(realDeliveryEnabled)
      : Promise.resolve(action)
  )
}

/** A fetch that ONLY answers the capability probe — any action call fails the test. */
function mockCapabilityOnly(realDeliveryEnabled: boolean | 'fail') {
  return vi.fn((url: string, _init?: RequestInit) => {
    if (String(url).includes('/delivery-capability')) return capabilityResponse(realDeliveryEnabled)
    throw new Error(`unexpected action call to ${String(url)}`)
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockCapabilityOnly(false))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('no promoted version (initial state)', () => {
  it('shows no production version and a candidate to promote', () => {
    render(
      <DeliveryControls
        copilot={makeCopilot({ productionVersionId: null })}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )
    expect(screen.getByText(/Promote v2\.0\.0-draft/)).toBeInTheDocument()
  })
})

describe('promotion blocked by the execution gate', () => {
  it('disables the promote button and shows the blocker reason', () => {
    const blockers: Blocker[] = [{ code: 'status', label: 'Status is draft, not active', detail: 'not proven yet' }]
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={blockers}
        candidateVersion={candidateVersion}
      />
    )
    const button = screen.getByRole('button', { name: /Promote v2\.0\.0-draft/ })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Execution gate reports 1 blocker/)).toBeInTheDocument()
  })

  it('never fires a network call when there is no candidate version', () => {
    const fetchMock = mockCapabilityOnly(false)
    vi.stubGlobal('fetch', fetchMock)
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={undefined}
      />
    )
    expect(screen.getByRole('button', { name: /Promote version/ })).toBeDisabled()
    // No ACTION call. The read-only capability probe on mount is not an
    // action — `mockCapabilityOnly` throws on anything else, so reaching a
    // promotion/push route here would fail the test outright.
    const actionCalls = fetchMock.mock.calls.filter(([url]) => !String(url).includes('/delivery-capability'))
    expect(actionCalls).toHaveLength(0)
  })
})

describe('promotion succeeds', () => {
  it('calls the promotion route with action:promote and renders the new production version, never the word "deployed"', async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, persisted: true, action: 'promote', productionVersionId: 'version-candidate' })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Promote v2\.0\.0-draft/ }))
    // Confirmation dialog must appear — a promote is never a single click.
    const confirmButton = await screen.findByRole('button', { name: 'Evaluate and promote' })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(screen.getByText(/Promoted — production_version_id = version-candidate/)).toBeInTheDocument())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/copilots/copilot-test-1/promotion',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'promote',
          versionId: 'version-candidate',
          previousProductionVersionId: null,
        }),
      })
    )
    expect(screen.queryByText(/deployed/i)).not.toBeInTheDocument()
  })
})

describe('dry-run delivery', () => {
  it('never sends confirm:true and renders "dry-run", never "delivered" or "deployed"', async () => {
    const fetchMock = mockFetchOnce(200, {
      pushed: false,
      dryRun: true,
      mode: 'pull_request',
      branch: 'agent-delivery/test',
      baseBranch: 'main',
      files: [],
      message: 'dry-run',
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dry-run delivery' }))

    await waitFor(() => expect(screen.getByText('Dry-run — nothing written to the repository')).toBeInTheDocument())

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/projects/proj-test-1/push-agent',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ copilotId: 'copilot-test-1' }),
      })
    )
    // calls[0] is the mount capability probe — select the ACTION call by URL.
    const pushCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/push-agent'))
    expect(pushCall).toBeDefined()
    const sentBody = JSON.parse((pushCall![1] as RequestInit).body as string)
    expect(sentBody.confirm).toBeUndefined()
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/deployed/i)).not.toBeInTheDocument()
  })
})

describe('missing repository', () => {
  it('disables delivery controls and shows a clear message, no crash', () => {
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName={undefined}
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )
    expect(screen.getByRole('button', { name: 'Dry-run delivery' })).toBeDisabled()
    expect(screen.getByText(/no `repoFullName`/)).toBeInTheDocument()
  })
})

describe('real-delivery capability, read from the server before the action', () => {
  it('capability false → the real button is disabled and says so, dry-run stays available', async () => {
    vi.stubGlobal('fetch', mockCapabilityOnly(false))
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )
    await waitFor(() => expect(screen.getByText(/Real delivery is not enabled on this server/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Prepare real delivery' })).toBeDisabled()
    // The safe path is never taken away.
    expect(screen.getByRole('button', { name: /Dry-run delivery/ })).toBeEnabled()
    // The refusal must not name the server-side switch it depends on.
    expect(screen.queryByText(/GITHUB_PUSH_ENABLED/)).toBeNull()
    expect(screen.queryByText(/GITHUB_TOKEN/)).toBeNull()
  })

  it('capability true → the real button is enabled, and still behind a strong confirmation', async () => {
    vi.stubGlobal('fetch', mockCapabilityOnly(true))
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Prepare real delivery' })).toBeEnabled())
    // Enabled is not fired: opening the control only opens the dialog. No
    // action request leaves until the dialog is confirmed (mockCapabilityOnly
    // throws on any non-capability URL, so a stray POST fails this test).
    fireEvent.click(screen.getByRole('button', { name: 'Prepare real delivery' }))
    expect(screen.getByText('Deliver for real?')).toBeInTheDocument()
  })

  it('capability read FAILS → unavailable, held closed, and distinct from a plain refusal', async () => {
    vi.stubGlobal('fetch', mockCapabilityOnly('fail'))
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )
    await waitFor(() =>
      expect(screen.getByText(/could not be determined/)).toBeInTheDocument()
    )
    // Unknown is NOT rendered as "not enabled on this server" — an unreachable
    // check is not evidence the server refuses.
    expect(screen.queryByText(/Real delivery is not enabled on this server/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Prepare real delivery' })).toBeDisabled()
  })
})

describe('delivery event present', () => {
  it('the delivery loop assessment renders its real returned state', async () => {
    const fetchMock = mockFetchOnce(200, { ok: true, state: { readiness: 'ready_for_manual_test', iterations: 1 } })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assess readiness' }))

    await waitFor(() => expect(screen.getByText(/ready_for_manual_test/)).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/agent-ops/copilots/copilot-test-1/delivery-loop',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
