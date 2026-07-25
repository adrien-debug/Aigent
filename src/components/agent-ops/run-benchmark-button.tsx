'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
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
  const blockedHintId = useId()
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
  // What a provider switch just set the model to — read out by the sr-only
  // live region so a screen-reader user hears the silent input change.
  const [announcement, setAnnouncement] = useState<string | null>(null)
  // Per-provider memory of what the user actually typed: flipping providers to
  // compare must never destroy a hand-entered model id. Ref, not state — it
  // only matters at the moment of a provider change.
  const typedModels = useRef<Partial<Record<CreatableModelProvider, string>>>({})
  const modelInputRef = useRef<HTMLInputElement>(null)

  function handleProviderChange(next: CreatableModelProvider) {
    setProvider(next)
    // The provider's remembered typed value wins; otherwise the base provider
    // restores the base model (so the untouched path re-arms) and any other
    // provider snaps to its first suggestion — the input always shows exactly
    // what will run.
    const nextModel =
      typedModels.current[next] ?? (next === baseProvider ? baseModel : (SUGGESTED_MODELS[next][0] ?? ''))
    setModel(nextModel)
    setAnnouncement(nextModel.length > 0 ? `Model set to ${nextModel}` : null)
  }

  function handleModelChange(value: string) {
    setModel(value)
    typedModels.current[provider] = value
  }

  // A switched provider with an emptied model would post a provider-only
  // override and run the copilot's cross-provider model — a doomed run. Block
  // it at the button rather than let the backend manufacture the failure.
  const runBlocked = provider !== baseProvider && model.trim().length === 0

  // Headless.Input overwrites a passed aria-describedby with its own
  // Field-context value (undefined here), so the blocked-hint link must be
  // wired imperatively on the real <input>.
  useEffect(() => {
    const input = modelInputRef.current
    if (!input) return
    if (runBlocked) input.setAttribute('aria-describedby', blockedHintId)
    else input.removeAttribute('aria-describedby')
  }, [runBlocked, blockedHintId])

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
      // Store the RAW status: only 'completed' may ever wear the accent badge.
      setDone(data.benchmarkRun?.status ?? 'unknown')
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
      <span className="text-xs text-zinc-500">This run only — the agent is not modified.</span>
      {!isCreatable(defaultProvider) ? (
        <Text className="!mt-0 !text-xs">
          Provider {MODEL_PROVIDER_LABELS[defaultProvider]} isn&apos;t runnable — using OpenAI for this run.
        </Text>
      ) : null}
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
          ref={modelInputRef}
          aria-label="Model for this run"
          value={model}
          disabled={isRunning}
          onChange={(event) => handleModelChange(event.target.value)}
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
        {done === 'completed' ? (
          <Badge color="accent" role="status" aria-live="polite">
            Benchmark complete
          </Badge>
        ) : done ? (
          // A non-completed run must NEVER look like success: zinc text, no badge.
          <Text role="status" aria-live="polite" className="!mt-0 !text-xs">
            Finished: {done}
          </Text>
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
      {runBlocked ? (
        <Text id={blockedHintId} className="!mt-0 !text-xs">
          Enter a model for {MODEL_PROVIDER_LABELS[provider]} to run.
        </Text>
      ) : null}
      <span aria-live="polite" role="status" className="sr-only">
        {announcement}
      </span>
      {error ? (
        <Text role="alert" className="!mt-0 !text-xs !text-[var(--state-danger-text)]">
          {error}
        </Text>
      ) : null}
    </div>
  )
}
