'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Input } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'
import { Text } from '@/components/catalyst/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import { MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/labels'
import { SUGGESTED_MODELS } from '@/lib/agent-mission-control/model-catalog'
import { CREATABLE_MODEL_PROVIDERS, type CreatableModelProvider } from '@/lib/agent-mission-control/resource-ids'
import type { ModelProvider } from '@/lib/agent-mission-control/types'

interface RunBenchmarkButtonProps {
  copilotId: string
  suiteId: string
  /** Optional explicit version; defaults server-side to production→latest. */
  versionId?: string
  /** The copilot's own provider/model — the untouched-state baseline. */
  defaultProvider: ModelProvider
  defaultModel: string
}

/** Shape of the benchmark-runner endpoint's reply. */
interface RunBenchmarkResult {
  benchmarkRun?: { status: string }
}

const isCreatable = (p: ModelProvider): p is CreatableModelProvider =>
  (CREATABLE_MODEL_PROVIDERS as readonly string[]).includes(p)

/**
 * "Run benchmark" trigger — real V1 execution, with a PER-RUN model override.
 *
 * The provider/model pickers default to the copilot's own configuration; the
 * copilot row is NEVER patched from here. When the pickers are left untouched
 * the POST body is byte-identical to the historical one (no
 * modelProvider/model keys), so the server-default path stays intact. When
 * they differ, the overrides ride the same POST and the run is persisted with
 * the provider/model it actually executed — that is what the comparison table
 * ranks. `mistral` is deliberately absent: declared but not wired
 * (ProviderUnavailableError), offering it would only manufacture failed runs.
 *
 * POSTs to the copilot's benchmark-runner route (runs + grades every task,
 * persists benchmark_runs / benchmark_results), then `router.refresh()` so the
 * section re-reads the new run. Monochrome accent, states inline in
 * accent/zinc — never a second hue, never a fake result.
 */
export function RunBenchmarkButton({
  copilotId,
  suiteId,
  versionId,
  defaultProvider,
  defaultModel,
}: RunBenchmarkButtonProps) {
  const router = useRouter()
  const datalistId = useId()
  // A non-creatable provider (mistral is declared in the DB enum but not
  // wired) cannot be offered in the Select; fall back to openai — and snap the
  // model WITH it, so the visible pair is always coherent. Running from that
  // state sends both overrides explicitly, which is honest: it IS a deviation
  // from the copilot. Keeping the copilot's mistral model id under an openai
  // provider would manufacture a guaranteed model-not-found run.
  const baseProvider: CreatableModelProvider = isCreatable(defaultProvider) ? defaultProvider : 'openai'
  const baseModel = isCreatable(defaultProvider) ? defaultModel : (SUGGESTED_MODELS[baseProvider][0] ?? '')
  const [provider, setProvider] = useState<CreatableModelProvider>(baseProvider)
  const [model, setModel] = useState(baseModel)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  function handleProviderChange(next: CreatableModelProvider) {
    setProvider(next)
    // Returning to the base provider restores the base model (so the untouched
    // path re-arms); any other provider snaps to its first suggestion — the
    // input always shows exactly what will run.
    setModel(next === baseProvider ? baseModel : (SUGGESTED_MODELS[next][0] ?? ''))
  }

  // A switched provider with an emptied model would post a provider-only
  // override and run the copilot's cross-provider model — a doomed run. Block
  // it at the button rather than let the backend manufacture the failure.
  const runBlocked = provider !== baseProvider && model.trim().length === 0

  async function handleRun() {
    if (isRunning) return

    setIsRunning(true)
    setError(null)
    setDone(null)

    // Overrides only when they deviate from the copilot's defaults — the
    // untouched path must stay byte-identical to the pre-override behavior.
    const trimmedModel = model.trim()
    const overrides: { modelProvider?: CreatableModelProvider; model?: string } = {}
    if (provider !== defaultProvider) overrides.modelProvider = provider
    if (trimmedModel.length > 0 && trimmedModel !== defaultModel) overrides.model = trimmedModel

    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/benchmarks/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suiteId, versionId, ...overrides }),
      })

      if (!response.ok) {
        setError(await messageForResponse(response, `Benchmark run failed (${response.status}).`))
        return
      }

      const data = (await response.json()) as RunBenchmarkResult
      setDone(data.benchmarkRun?.status === 'completed' ? 'Benchmark complete' : 'Run finished')
      router.refresh()
    } catch {
      setError('Benchmark run failed — the backend is unreachable.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    // Two DETERMINISTIC rows (pickers, then action) instead of one long row
    // hoping to wrap: this component lives in a card header's actions slot,
    // whose width the card controls — a single ~500px row is an overflow
    // hazard on narrow viewports, and stacking is the layout we want anyway.
    <div className="flex max-w-full flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          aria-label="Model provider for this run"
          value={provider}
          disabled={isRunning}
          onChange={(event) => handleProviderChange(event.target.value as CreatableModelProvider)}
          className="max-w-36"
        >
          {CREATABLE_MODEL_PROVIDERS.map((option) => (
            <option key={option} value={option}>
              {MODEL_PROVIDER_LABELS[option]}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Model for this run"
          value={model}
          disabled={isRunning}
          onChange={(event) => setModel(event.target.value)}
          placeholder={provider === baseProvider ? baseModel : (SUGGESTED_MODELS[provider][0] ?? '')}
          list={datalistId}
          className="max-w-52"
        />
        <datalist id={datalistId}>
          {SUGGESTED_MODELS[provider].map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {done ? (
          <Badge color="accent" role="status" aria-live="polite">
            {done}
          </Badge>
        ) : null}
        <Button color="accent" onClick={handleRun} disabled={isRunning || runBlocked}>
          {isRunning ? (
            <>
              <Spinner />
              Running…
            </>
          ) : (
            'Run benchmark'
          )}
        </Button>
      </div>
      {error ? (
        <Text role="alert" className="!mt-0 !text-xs !text-accent-400">
          {error}
        </Text>
      ) : null}
    </div>
  )
}
