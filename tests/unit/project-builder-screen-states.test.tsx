/**
 * `ProjectBuilderScreen` — the two additions layered on the existing initial
 * -load guard (`project-builder-initial-load.test.tsx` already pins the fetch
 * lifecycle, the 401 wording, the composer guard and Retry; not repeated
 * here):
 *
 *  1. SESSION EXPIRED / LOAD FAILED renders one DOMINANT, CENTERED panel with
 *     Retry AND a way back to the project — not just a thin banner sitting
 *     above an otherwise-live two-panel workspace.
 *  2. The workspace grid is masked (`hidden`), not deleted: the composer and
 *     its own `initialLoadFailed` guard (asserted by test 3 in the sibling
 *     file — no `/builder/message` fetch reaches the network) stay in the
 *     tree, they are just not the dominant visual.
 *  3. A loaded conversation renders the real, persisted `conversation.status`
 *     as a stepper — not a fabricated progress bar.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectBuilderScreen } from '@/components/console/project-builder-screen'
import type { ProjectBuilderConversationBundle } from '@/lib/agent-mission-control/project-builder-types'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function bundle(overrides: Partial<ProjectBuilderConversationBundle['conversation']> = {}): ProjectBuilderConversationBundle {
  return {
    conversation: {
      id: 'pbconv-1',
      projectId: 'proj-1',
      status: 'draft_ready',
      langgraphThreadId: null,
      latestPreview: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
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

describe('ProjectBuilderScreen — dominant failure panel + real status stepper', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('session expired: a dominant central panel offers Retry and a way back to the project, and the workspace grid is masked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, 401))
    const { container } = mount()

    await screen.findByText('Your session has expired — sign in again to use the builder.')

    // The dominant panel: Retry, plus an actual destination back to the project
    // list — not just a bare "it failed" sentence.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    const back = screen.getByRole('link', { name: /back to projects/i })
    expect(back.getAttribute('href')).toBe('/admin/projects')

    // The two-panel workspace is masked, not deleted: it is still in the DOM
    // (the composer's own guard is asserted elsewhere) but carries `hidden`.
    const grid = container.querySelector('.xl\\:grid-cols-\\[minmax\\(0\\,1\\.45fr\\)_minmax\\(340px\\,0\\.55fr\\)\\]')
    expect(grid).toBeTruthy()
    expect(grid?.className).toContain('hidden')
  })

  it('a loaded conversation renders its real persisted status as a stepper, not a fabricated progress value', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(bundle({ status: 'draft_ready' })))
    mount()

    await screen.findByText('completed')

    expect(screen.getByText('Discussing')).toBeTruthy()
    expect(screen.getByText('Ready for approval')).toBeTruthy()
    expect(screen.getByText('Draft created')).toBeTruthy()
  })

  it('an archived conversation states so instead of drawing it as a step reached', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(bundle({ status: 'archived' })))
    mount()

    await screen.findByText('This conversation is archived.')
    expect(screen.queryByText('Ready for approval')).toBeNull()
  })
})
