import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { Text } from '@/components/ui/text'
import type {
  QualificationReadiness,
  QualificationStepResult,
  QualificationStepStatus,
} from '@/lib/agent-mission-control/qualification-orchestrator'

/**
 * Qualification workflow — the honest, ordered view of a candidate's walk
 * through tests → benchmark → shadow → replay → gate, plus the single recommended
 * NEXT action and any blockers (AIGENT-AUTONOMOUS-FACTORY-001).
 *
 * This adds NO verdict of its own: it renders exactly what
 * `computeReadiness(getLatestQualificationRun(...))` produced. It never prints a
 * bare "READY" — the state is phrased as an instruction. It uses the same
 * dot+text status convention as `PromotionStatusText`/`CheckStatusText` (the word
 * carries the distinction; the accent dot marks PASS only; a FAIL is never
 * painted like an unmeasured/unavailable step) so the whole detail surface reads
 * as one system. Step order + labels are local so this presentational component
 * carries no runtime dependency on the server-only orchestrator (types only).
 */

const STEP_ORDER: Array<{ step: QualificationStepResult['step']; label: string; blurb: string }> = [
  { step: 'tests', label: 'Tests', blurb: 'Latest completed test run for this version.' },
  { step: 'benchmark', label: 'Benchmark', blurb: 'Latest completed benchmark for this version.' },
  { step: 'shadow', label: 'Shadow', blurb: 'Candidate vs production, via the real LangGraph path.' },
  { step: 'replay', label: 'Replay', blurb: 'Candidate replayed against the reference version.' },
  { step: 'gate', label: 'Promotion gate', blurb: 'The authoritative rollup the promote RPC re-reads.' },
]

const STATUS_LABEL: Record<QualificationStepStatus, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_CONFIGURED: 'Not configured',
  NOT_AVAILABLE: 'Not available',
  INSUFFICIENT_EVIDENCE: 'Not measured',
  PENDING: 'Pending',
}

function StepStatusText({ status }: { status: QualificationStepStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className={
          status === 'PASS'
            ? 'size-1.5 rounded-full bg-accent-500'
            : status === 'FAIL'
              ? 'size-1.5 rounded-full bg-[var(--state-danger-solid)]'
              : 'size-1.5 rounded-full ring-1 ring-zinc-400 dark:ring-zinc-500'
        }
      />
      <span
        className={
          status === 'PASS'
            ? 'text-accent-700 dark:text-accent-300'
            : status === 'FAIL'
              ? 'text-[var(--state-danger-text)]'
              : 'text-zinc-500 dark:text-zinc-400'
        }
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

export function QualificationTimeline({ readiness }: { readiness: QualificationReadiness }) {
  // Index the executed steps so the fixed 5-step order can show PENDING for any
  // step the workflow hasn't reached yet (never a fabricated status).
  const byStep = new Map<string, QualificationStepResult>()
  for (const s of readiness.steps) byStep.set(s.step, s)

  return (
    <div className="flex flex-col gap-4">
      {/* Recommended next action — an instruction/state, never a "READY" pill. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Text className="!text-xs">{readiness.nextAction}</Text>
        {readiness.candidateVersionId ? (
          <span className="font-mono text-[10px] tabular-nums break-all text-zinc-500">
            {readiness.candidateVersionId}
          </span>
        ) : null}
      </div>

      <ul className="flex max-h-80 flex-col overflow-y-auto">
        {STEP_ORDER.map(({ step, label, blurb }) => {
          const result = byStep.get(step)
          const status: QualificationStepStatus = result?.status ?? 'PENDING'
          return (
            <li
              key={step}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2.5 last:border-0"
            >
              <div className="min-w-0">
                <span className="text-sm text-zinc-200">{label}</span>
                <p className="mt-0.5 text-xs text-zinc-400">{result?.reason ?? blurb}</p>
                {/* `zinc-400`, not `-500`: same 10px provenance line as
                    `PromotionChecksList`, on the same raised plane of the same
                    page — `check-contrast.mjs` measured that one at 3.59
                    against a 4.5 AA floor. The two must not diverge, they are
                    read as one column. */}
                {result?.sourceOfTruth ? (
                  <p className="mt-0.5 text-[10px] text-zinc-400">{result.sourceOfTruth}</p>
                ) : null}
              </div>
              <StepStatusText status={status} />
            </li>
          )
        })}
      </ul>

      {readiness.blockers.length > 0 ? (
        <div>
          <p className={eyebrowClass}>Blockers</p>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {readiness.blockers.map((b, i) => (
              <li key={i} className="text-xs text-zinc-400">
                {b}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
