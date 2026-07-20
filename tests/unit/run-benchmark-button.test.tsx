/**
 * RTL tests for RunBenchmarkButton's per-run model override.
 *
 * The load-bearing contract: an UNTOUCHED form must POST a body byte-identical
 * to the pre-override behavior (no modelProvider/model keys at all), so the
 * server-default path never shifts under existing users. Overrides ride the
 * same POST only when the pickers deviate from the copilot's own
 * provider/model.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

import { RunBenchmarkButton } from '@/components/agent-ops/run-benchmark-button'

function stubFetch() {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ benchmarkRun: { status: 'completed' } }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Body of the first (only) POST the component issued. */
function postedBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]![1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

function renderButton() {
  return render(
    <RunBenchmarkButton
      copilotId="copilot-test"
      suiteId="suite-1"
      defaultProvider="openai"
      defaultModel="gpt-4.1"
    />
  )
}

const providerSelect = () => screen.getAllByLabelText('Model provider for this run')[0]!
const modelInput = () => screen.getAllByLabelText('Model for this run')[0]!
const runButton = () => screen.getByRole('button', { name: 'Run benchmark' })

describe('RunBenchmarkButton', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    refresh.mockClear()
  })

  it('untouched pickers POST no override keys (server-default path intact)', async () => {
    const fetchMock = stubFetch()
    renderButton()

    await userEvent.click(runButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = postedBody(fetchMock)
    expect(body).toEqual({ suiteId: 'suite-1' })
    expect('modelProvider' in body).toBe(false)
    expect('model' in body).toBe(false)
    expect(refresh).toHaveBeenCalled()
  })

  it('switching provider snaps the model and POSTs both overrides', async () => {
    const fetchMock = stubFetch()
    renderButton()

    await userEvent.selectOptions(providerSelect(), 'google')
    expect(modelInput()).toHaveValue('gemini-2.5-pro')

    await userEvent.click(runButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody(fetchMock)).toEqual({
      suiteId: 'suite-1',
      modelProvider: 'google',
      model: 'gemini-2.5-pro',
    })
  })

  it('returning to the copilot provider restores its model and re-arms the untouched path', async () => {
    const fetchMock = stubFetch()
    renderButton()

    await userEvent.selectOptions(providerSelect(), 'local')
    expect(modelInput()).toHaveValue('local-reasoning-70b')
    await userEvent.selectOptions(providerSelect(), 'openai')
    expect(modelInput()).toHaveValue('gpt-4.1')

    await userEvent.click(runButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody(fetchMock)).toEqual({ suiteId: 'suite-1' })
  })

  it('a custom model on the same provider POSTs the model override alone', async () => {
    const fetchMock = stubFetch()
    renderButton()

    await userEvent.clear(modelInput())
    await userEvent.type(modelInput(), 'gpt-5.4-mini')
    await userEvent.click(runButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody(fetchMock)).toEqual({ suiteId: 'suite-1', model: 'gpt-5.4-mini' })
  })

  it('never offers mistral', () => {
    stubFetch()
    renderButton()

    const options = Array.from((providerSelect() as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['openai', 'google', 'local'])
  })

  it('a mistral copilot snaps to a coherent openai pair and posts BOTH overrides untouched', async () => {
    // mistral is a legal DB state but not creatable/wired: the fallback must
    // never pair provider=openai with the copilot's mistral model id — that
    // would manufacture a guaranteed model-not-found run.
    const fetchMock = stubFetch()
    render(
      <RunBenchmarkButton
        copilotId="copilot-test"
        suiteId="suite-1"
        defaultProvider="mistral"
        defaultModel="mistral-large-2"
      />
    )

    expect(modelInput()).toHaveValue('gpt-5.4')

    await userEvent.click(runButton())

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody(fetchMock)).toEqual({
      suiteId: 'suite-1',
      modelProvider: 'openai',
      model: 'gpt-5.4',
    })
  })

  it('blocks Run when the provider is overridden but the model is emptied', async () => {
    stubFetch()
    renderButton()

    await userEvent.selectOptions(providerSelect(), 'google')
    await userEvent.clear(modelInput())

    expect(runButton()).toBeDisabled()
  })
})
