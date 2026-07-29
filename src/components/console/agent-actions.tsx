'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/ui/status-dot'

/**
 * Console action pattern — RUN / TEST / BENCHMARK.
 *
 * This is the FIRST writing surface the console has grown (P006/P007 left
 * `/admin/**` fully read-only; the only other `fetch(` in `src/components/console/`
 * lives in `project-builder-screen.tsx`). The shape below is deliberately the
 * one to copy for any sibling panel that also fires a billed POST:
 *
 *   idle → (confirm, only when the call is billed) → running → success | error
 *
 * - One `useActionState`-shaped hook (`useConfirmedAction`) owns the state
 *   machine, the double-submit guard, the AbortController and the
 *   `mountedRef` unmount guard — copy the hook, not just the JSX.
 * - The confirmation step is INLINE in the button (click once to arm, click
 *   again to fire) — never a modal/dialog (no `Dialog` primitive exists in
 *   this kit, and the mission explicitly rules out a selection box).
 * - A blocked action never renders a live button: the caller passes
 *   `blockers`/`executable` computed server-side by `getAgentDetail()`
 *   (`computeBlockers` / `isExecutable` in `runtime-catalogue.ts`) and this
 *   component only reads that verdict — it never recomputes executability.
 */

type ActionPhase = 'idle' | 'confirm' | 'running' | 'success' | 'error'

type ActionResult = {
  ok: true
  [key: string]: unknown
}

type UseConfirmedActionOptions = {
  /** POST body → parsed JSON response. Called once per confirmed click. */
  run: (signal: AbortSignal) => Promise<ActionResult>
}

/**
 * One in-flight call at a time, abort on unmount, no setState after unmount.
 * Modeled on `project-builder-screen.tsx`'s `mountedRef` + `AbortController`
 * pair (there: `streamAbortRef`/`loadAbortRef` + the mount effect at the top
 * of the component).
 */
function useConfirmedAction({ run }: UseConfirmedActionOptions) {
  const [phase, setPhase] = useState<ActionPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ActionResult | null>(null)

  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  const arm = useCallback(() => {
    if (inFlightRef.current) return
    setPhase((p) => (p === 'idle' || p === 'success' || p === 'error' ? 'confirm' : p))
  }, [])

  const cancel = useCallback(() => {
    if (inFlightRef.current) return
    setPhase('idle')
  }, [])

  const fire = useCallback(() => {
    // Double-submit guard: a second click while a call is already in flight
    // (or already fired) is a no-op, not a second billed request.
    if (inFlightRef.current) return
    inFlightRef.current = true
    setPhase('running')
    setError(null)

    const controller = new AbortController()
    abortRef.current = controller

    run(controller.signal)
      .then((res) => {
        if (!mountedRef.current || controller.signal.aborted) return
        setResult(res)
        setPhase('success')
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || controller.signal.aborted) return
        setError(err instanceof Error ? err.message : 'Request failed')
        setPhase('error')
      })
      .finally(() => {
        inFlightRef.current = false
      })
  }, [run])

  return { phase, error, result, arm, cancel, fire }
}

/** Shared fetch helper: parses the route's `{ error }` body on a non-2xx. */
async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<ActionResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    // Non-JSON body — fall through to the generic message below.
  }
  if (!res.ok) {
    const message =
      parsed !== null && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
        ? (parsed as { error: string }).error
        : `Request failed (${res.status})`
    throw new Error(message)
  }
  return parsed as ActionResult
}

/**
 * One billed, confirmed action button. `label`/`confirmLabel` are the two
 * button faces; `onSuccess`/`onError` render the outcome under the button.
 */
function ConfirmedActionButton({
  label,
  confirmLabel,
  runningLabel,
  onFire,
  renderResult,
}: {
  label: string
  confirmLabel: string
  runningLabel: string
  onFire: (signal: AbortSignal) => Promise<ActionResult>
  renderResult?: (result: ActionResult) => React.ReactNode
}) {
  const { phase, error, result, arm, cancel, fire } = useConfirmedAction({ run: onFire })

  return (
    <div className="flex flex-col gap-1.5">
      {phase === 'confirm' ? (
        <div className="flex items-center gap-1.5">
          <Button color="accent" onClick={fire}>
            {confirmLabel}
          </Button>
          <Button plain onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button color="accent" onClick={arm} disabled={phase === 'running'}>
          {phase === 'running' ? runningLabel : label}
        </Button>
      )}
      {phase === 'error' && error !== null ? (
        <p className="text-[11px]/4 text-[var(--state-danger-text)]">{error}</p>
      ) : null}
      {phase === 'success' && result !== null ? (
        <div className="text-[11px]/4 text-zinc-400">
          {renderResult ? renderResult(result) : <StatusDot tone="positive">Done</StatusDot>}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ panel */

export type AgentActionsBlocker = { code: string; label: string }

/**
 * The three write actions for one copilot: run, run test suite, run
 * benchmark suite. Renders nothing live when the agent is not executable —
 * only the blocker reasons the server already computed.
 */
export function AgentActionsPanel({
  copilotId,
  executable,
  blockers,
  testSuiteId,
  benchmarkSuiteId,
}: {
  copilotId: string
  executable: boolean
  blockers: AgentActionsBlocker[]
  /** First test suite owned by this copilot, or `null` if none exists yet. */
  testSuiteId: string | null
  /** First benchmark suite owned by this copilot, or `null` if none exists yet. */
  benchmarkSuiteId: string | null
}) {
  if (!executable) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-[var(--state-danger-solid-line)] px-3 py-2.5">
        <StatusDot tone="negative">Actions blocked</StatusDot>
        <ul className="space-y-0.5">
          {blockers.map((b) => (
            <li key={b.code} className="text-[11px]/4 text-zinc-400">
              {b.label}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <ConfirmedActionButton
        label="Run agent"
        confirmLabel="Confirm — this calls the live model"
        runningLabel="Running…"
        onFire={(signal) =>
          postJson(
            `/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/run`,
            { userInput: 'Run requested from the console.' },
            signal
          )
        }
        renderResult={(result) => (
          <span>
            Run {typeof result.status === 'string' ? result.status : 'finished'}
            {typeof result.runId === 'string' ? ` · ${result.runId}` : ''}
          </span>
        )}
      />

      {testSuiteId === null ? (
        <p className="text-[11px]/4 text-zinc-500">No test suite exists for this agent yet.</p>
      ) : (
        <ConfirmedActionButton
          label="Run tests"
          confirmLabel="Confirm — this calls the live model"
          runningLabel="Testing…"
          onFire={(signal) =>
            postJson(
              `/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/tests/run`,
              { suiteId: testSuiteId },
              signal
            )
          }
          renderResult={(result) => {
            const testRun = result.testRun as { status?: string; id?: string } | undefined
            return (
              <span>
                Tests {testRun?.status ?? 'finished'}
                {testRun?.id ? ` · ${testRun.id}` : ''}
              </span>
            )
          }}
        />
      )}

      {benchmarkSuiteId === null ? (
        <p className="text-[11px]/4 text-zinc-500">No benchmark suite exists for this agent yet.</p>
      ) : (
        <ConfirmedActionButton
          label="Run benchmark"
          confirmLabel="Confirm — this calls the live model"
          runningLabel="Benchmarking…"
          onFire={(signal) =>
            postJson(
              `/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/benchmarks/run`,
              { suiteId: benchmarkSuiteId },
              signal
            )
          }
          renderResult={(result) => {
            const benchmarkRun = result.benchmarkRun as { status?: string; id?: string } | undefined
            return (
              <span>
                Benchmark {benchmarkRun?.status ?? 'finished'}
                {benchmarkRun?.id ? ` · ${benchmarkRun.id}` : ''}
              </span>
            )
          }}
        />
      )}
    </div>
  )
}
