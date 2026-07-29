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

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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
    const fetchMock = vi.fn()
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
    expect(fetchMock).not.toHaveBeenCalled()
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
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)
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

describe('push environment disabled by default', () => {
  it('disables the real-delivery button with an explicit reason until a live response proves it available', () => {
    render(
      <DeliveryControls
        copilot={makeCopilot()}
        projectId="proj-test-1"
        repoFullName="hearst/console"
        blockers={[]}
        candidateVersion={candidateVersion}
      />
    )
    expect(screen.getByRole('button', { name: 'Prepare real delivery' })).toBeDisabled()
    expect(screen.getByText(/Real delivery is not available in this environment/)).toBeInTheDocument()
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
