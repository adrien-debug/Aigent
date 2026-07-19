/**
 * RTL tests for RunCopilotPanel — interactive run flow with mocked fetch/router.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

import { RunCopilotPanel } from '@/components/agent-ops/run-copilot-panel'

/** Headless UI renders a hidden measurement control — target the visible field. */
function taskInput() {
  return screen.getAllByPlaceholderText('Describe the task for this copilot to run…')[0]!
}

describe('RunCopilotPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    refresh.mockClear()
  })

  it('disables Run until task input is non-empty', async () => {
    render(<RunCopilotPanel copilotId="copilot-test" copilotName="Atlas" />)

    const runButton = screen.getByRole('button', { name: 'Run copilot' })
    expect(runButton).toBeDisabled()

    await userEvent.type(taskInput(), 'Check ETH regime')
    expect(runButton).toBeEnabled()
  })

  it('submits a run and renders the result receipt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'completed',
          outputSummary: 'Regime is ranging.',
          latencyMs: 1200,
          costUsd: 0.002,
        }),
      }))
    )

    render(<RunCopilotPanel copilotId="copilot-test" copilotName="Atlas" />)

    await userEvent.type(taskInput(), 'Check ETH regime')
    await userEvent.click(screen.getByRole('button', { name: 'Run copilot' }))

    await waitFor(() => {
      expect(screen.getByText('Regime is ranging.')).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledWith(
      '/api/agent-ops/copilots/copilot-test/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userInput: 'Check ETH regime' }),
      })
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('surfaces a 503 as a user-visible error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({ error: 'live backend not configured' }),
      }))
    )

    render(<RunCopilotPanel copilotId="copilot-test" copilotName="Atlas" />)

    await userEvent.type(taskInput(), 'Ping')
    await userEvent.click(screen.getByRole('button', { name: 'Run copilot' }))

    await waitFor(() => {
      expect(screen.getByText('Live backend not configured.')).toBeInTheDocument()
    })
  })
})
