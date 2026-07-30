import { cn } from '@/components/ui/cn'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/**
 * The console's EXPANDED state vocabulary — six situations that must never
 * look alike, sitting beside `screen-primitives.tsx` (`EmptyState`,
 * `ErrorState`, `Unavailable`, `DegradedBanner`), which stay as they are.
 *
 * WHY THIS FILE EXISTS. The four primitives above answer two questions well
 * ("nothing here" / "something broke") but collapse six real situations into
 * those two: a metric never configured on the server, a test/bench/shadow run
 * that never fired, a read that came back `null` rather than empty, and an
 * expired session all rendered as the same quiet grey paragraph. A reader
 * cannot tell "safe to ignore" from "go fix your token" from "click Configure"
 * without reading every word — the FRAME has to carry that distinction before
 * the text does, because the frame is what a skimming eye registers first.
 *
 * THE SIX, AND WHAT SEPARATES THEM ON THE PLATE (not just in prose):
 *   · EmptyStateIllustrated  — MEASURED, and empty. Dashed zinc frame, an
 *     inline glyph, and REQUIRED `reason` + `source` text — never a bare title.
 *   · ConfigurationRequired  — not wired server-side. Accent-tinted frame (the
 *     one non-danger, non-zinc role in this file) because it is actionable and
 *     benign, with a `Button` slot that is REQUIRED, not optional.
 *   · EvidenceMissing        — a proof pipeline (test/bench/shadow/replay)
 *     never ran. Dotted frame — visually "not yet drawn" — distinct from the
 *     dashed "drawn empty" of `EmptyStateIllustrated`.
 *   · DataUnavailable        — read attempted, value not reported (⇔ a
 *     provider gap), NOT the same as zero. Solid frame, the literal
 *     `UNAVAILABLE_LABEL` word, never a number.
 *   · ErrorStateBlocking     — the surface is UNUSABLE. Solid danger frame
 *     that DOMINATES its region (`role="alert"`, no `children` slot — see the
 *     prop type below — so a form or a table can never sit "next to" it and
 *     imply the screen still works).
 *   · LoadingSkeleton        — bounded, finite shapes. No spinner, no
 *     unbounded pulse: a fixed `rows` count inside a fixed-height frame.
 *
 * Accent + zinc + the one danger role only (`src/theme.css`), Catalyst
 * primitives only, no dependency. No sparkline anywhere in this file.
 */

/* --------------------------------------------------------- empty, measured */

/**
 * We read the source. It came back empty. That is a real, expected result —
 * not a failure and not "nothing configured yet". `reason` and `source` are
 * REQUIRED props on purpose: a title alone ("No runs") tells a reader nothing
 * about whether that is normal, so `check-empty-state-explained.mjs` fails a
 * build that tries to make them optional.
 */
export function EmptyStateIllustrated({
  title,
  reason,
  source,
  action,
  className,
}: {
  title: string
  /** Why an empty result is expected/normal here — not a restatement of the title. */
  reason: string
  /** Where this was read from, so the reader can trust the empty result. */
  source: string
  /** Optional next step — a real destination, never a dead button. */
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-app px-4 py-8 text-center',
        className
      )}
    >
      <span aria-hidden className="text-xl text-zinc-600">
        ○
      </span>
      <p className="text-[13px]/5 font-medium text-zinc-300">{title}</p>
      <p className="max-w-sm text-[11px]/4 text-zinc-500">{reason}</p>
      <p className="text-[10px]/4 uppercase tracking-widest text-zinc-600">Source · {source}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/* --------------------------------------------------------------- blocking */

/**
 * The surface cannot be used, at all — not "part of the data is degraded"
 * (`DegradedBanner` already covers that), a hard read failure or a thrown
 * boundary. Deliberately has NO `children` slot: a dead form or a stale table
 * rendered "beside" this would tell the reader the screen still half-works.
 * `check-error-state-not-usable.mjs` fails if a `children` prop is added back.
 */
export function ErrorStateBlocking({
  title,
  description,
  retry,
  className,
}: {
  title: string
  description: string
  /** A real retry/back action — never decorative filler. */
  retry?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-[var(--state-danger-solid-line)] bg-surface-raised px-6 py-10 text-center',
        className
      )}
    >
      <span aria-hidden className="text-2xl text-[var(--state-danger-text)]">
        ⛔
      </span>
      <p className="text-sm/5 font-semibold text-[var(--state-danger-text)]">{title}</p>
      <p className="max-w-sm text-[12px]/5 text-zinc-400">{description}</p>
      {retry ? <div className="mt-2">{retry}</div> : null}
    </div>
  )
}

/* --------------------------------------------------------------- loading */

/**
 * Finite, bounded placeholder shapes — never an infinite spinner. `rows`
 * bounds the shape count so a skeleton for a 200-row table still renders a
 * fixed handful of bars, matching the "box fixe, data scrolle" rule: the
 * skeleton never grows to guess at the eventual row count.
 */
export function LoadingSkeleton({
  rows = 3,
  className,
}: {
  /** Bounded on purpose: 1–8. A caller asking for more gets 8. */
  rows?: number
  className?: string
}) {
  const count = Math.max(1, Math.min(8, rows))
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="h-3.5 animate-pulse rounded bg-surface-hover"
          style={{ width: `${72 - index * 6 > 40 ? 72 - index * 6 : 40}%` }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  )
}

/* --------------------------------------------------------------- unavailable */

/**
 * The read was ATTEMPTED and the value was not reported — a provider gap, a
 * timeout, a missing column — never a stand-in for a measured zero. Solid
 * frame (distinct from the dashed `EmptyStateIllustrated`) because this is not
 * an expected result, it is a gap in one.
 */
export function DataUnavailable({
  label,
  detail,
  className,
}: {
  label: string
  detail: string
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface-app px-4 py-3.5', className)}>
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">{label}</p>
      <p className="mt-1 text-lg/6 font-light text-zinc-500">{UNAVAILABLE_LABEL}</p>
      <p className={cn('mt-1 text-[11px]/4 text-zinc-600', className)}>{detail}</p>
    </div>
  )
}

/* --------------------------------------------------------------- configuration */

/**
 * Not broken, not empty — never wired server-side. The only non-danger,
 * non-zinc role in this file: it is actionable and benign, so it borrows the
 * accent as a low-key signal ("go press this"), never as a success claim.
 * `action` is REQUIRED — a "not configured" card with no way to configure it
 * is a dead end.
 */
export function ConfigurationRequired({
  title,
  description,
  action,
  className,
}: {
  title: string
  description: string
  /** The real setup destination — required, this state exists to be actioned. */
  action: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-surface)] px-4 py-4',
        className
      )}
    >
      <p className="text-[13px]/5 font-medium text-accent-500">{title}</p>
      <p className="text-[11px]/4 text-zinc-400">{description}</p>
      <div>{action}</div>
    </div>
  )
}

/* --------------------------------------------------------------- evidence */

/**
 * A proof pipeline (test / bench / shadow / replay) has never been run for
 * this subject — not a failed run, not an empty result of one that ran.
 * Dotted frame: visually "not yet drawn", distinct from the dashed "drawn
 * empty" of `EmptyStateIllustrated` and the solid frames used everywhere else.
 */
export function EvidenceMissing({
  pipeline,
  detail,
  action,
  className,
}: {
  /** Which pipeline never ran: "test", "bench", "shadow", "replay". */
  pipeline: string
  detail: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border border-dotted border-line-strong bg-surface-app px-4 py-4',
        className
      )}
    >
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">No {pipeline} evidence yet</p>
      <p className="text-[11px]/4 text-zinc-500">{detail}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

/* --------------------------------------------------------------- compact metric */

/**
 * A dense, one-line metric row — the antidote to a large empty `KpiCard` used
 * for a number nobody needed to see at 2xl. `value` accepts a node so an
 * absent measurement passes `<Unavailable />`, matching `Metric`'s contract.
 */
export function CompactMetric({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-3 py-1.5 text-[11px]/4', className)}>
      <span className="truncate text-zinc-500">{label}</span>
      <span className="shrink-0 tabular-nums text-zinc-200">{value}</span>
    </div>
  )
}

