import { Heading } from '@/components/ui/heading'
import { cn } from '@/components/ui/cn'
import { Link } from '@/components/ui/link'
import type { StatusDotTone } from '@/components/ui/status-dot'
import type { AvailableAgentStatus } from '@/lib/agent-mission-control/available-agents'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/**
 * The console's shared visual grammar. Server components only: props in,
 * markup out — no state, no data access, no function props crossing the
 * server/client boundary (scripts/check-rsc-boundary.mjs).
 *
 * Every default class list is passed to `cn()` FIRST and the caller's
 * `className` LAST — see src/components/ui/cn.ts for why that order is the
 * only thing that decides who wins.
 */

/* ------------------------------------------------------------------ header */

/**
 * Page header inside the content column. Dense: one line of title, one line of
 * description, actions right-aligned.
 */
export function ScreenHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <Heading className="truncate text-xl/7 font-semibold tracking-tight text-white">{title}</Heading>
        {description ? <p className="mt-1 truncate text-[13px]/5 text-zinc-300">{description}</p> : null}
      </div>
      {/* `flex-wrap`: the agent-detail header passes three non-shrinking controls
          here. Without wrapping they overflowed the column on a narrow viewport
          instead of dropping to a second line. */}
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------- panel */

/**
 * Bounded body heights. A panel NEVER grows with its data: a dense list gets a
 * fixed rung and scrolls INSIDE the panel, so the grid is identical whether the
 * list holds 2 rows or 200. Named rungs rather than a free number, so two
 * panels sitting side by side cannot drift apart.
 */
const SECTION_BODY_HEIGHTS = {
  sm: 'max-h-56', // 224px — ~4 dense rows
  md: 'max-h-80', // 320px — ~6 dense rows
  lg: 'max-h-[26rem]', // 416px — ~8 dense rows
} as const

export type SectionScroll = keyof typeof SECTION_BODY_HEIGHTS

/** The graphite panel: hairline border, dense header row, optional bounded body. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  scroll,
  priority = 'secondary',
}: {
  title: string
  description?: string
  /** Right-hand slot of the header row: a link, a compact control, a count. */
  actions?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Bounds the body and scrolls the content inside it instead of stretching the grid. */
  scroll?: SectionScroll
  /**
   * Visual weight against sibling panels on the same screen. `'secondary'` (the
   * default, and the only variant every existing caller renders today) keeps
   * the original graphite plate. `'primary'` sits one plane higher
   * (`surface-overlay`), carries the strong hairline and the elevated shadow —
   * the one panel on a screen the reader's eye should land on first. Additive:
   * no caller has to opt in.
   */
  priority?: 'primary' | 'secondary'
}) {
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl border',
        priority === 'primary'
          ? 'border-line-strong bg-surface-overlay shadow-[var(--shadow-card-lg)]'
          : 'border-line bg-surface-raised shadow-[var(--shadow-card-sm)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="min-w-0">
          <Heading level={2} className="truncate text-[13px]/5 font-semibold tracking-wide text-white">
            {title}
          </Heading>
          {description ? <p className="mt-0.5 truncate text-[11px]/4 text-zinc-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn('min-w-0', scroll && [SECTION_BODY_HEIGHTS[scroll], 'overflow-y-auto'], bodyClassName)}>
        {children}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ metric */

/**
 * One KPI: a tiny uppercase label, ONE large figure, a sub-label, and an
 * optional right-hand slot for a gauge or a ratio indicator.
 *
 * Owns its padding so `KpiCard` can wrap it in card chrome without double
 * padding. `value` is a node on purpose: an absent measurement passes
 * `<Unavailable />` here, never a fabricated 0.
 */
export function Metric({
  label,
  value,
  detail,
  aside,
  className,
}: {
  label: string
  value: React.ReactNode
  detail?: string
  /** Right of the figure: a small gauge arc, a ratio, a status dot. */
  aside?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-start justify-between gap-3 px-4 py-3.5', className)}>
      <div className="min-w-0">
        <p className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
        <p className="mt-1.5 truncate text-2xl/7 font-light tabular-nums text-white">{value}</p>
        {detail ? <p className="mt-1 truncate text-[11px]/4 text-zinc-400">{detail}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </div>
  )
}

/** Row-1 card: `Metric` in bordered graphite. The card carries no padding — `Metric` does. */
export function KpiCard({
  label,
  value,
  detail,
  aside,
  className,
  priority = 'secondary',
}: {
  label: string
  value: React.ReactNode
  detail?: string
  aside?: React.ReactNode
  className?: string
  /** Same hierarchy contract as `Section.priority` — the headline KPI on a
   * screen (e.g. the single number the operator cares about most) can render
   * `'primary'` to visually outrank the row of ordinary KPI cards beside it.
   * Defaults to `'secondary'`, which is byte-identical to the card's original
   * chrome. */
  priority?: 'primary' | 'secondary'
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-xl border',
        priority === 'primary'
          ? 'border-line-strong bg-surface-overlay shadow-[var(--shadow-card-lg)]'
          : 'border-line bg-surface-raised shadow-[var(--shadow-card-sm)]',
        className
      )}
    >
      <Metric label={label} value={value} detail={detail} aside={aside} />
    </div>
  )
}

/* --------------------------------------------------------------- panel row */

/**
 * The repeating unit of every list panel: leading slot, title, subtitle, and a
 * right-aligned stat cluster. `values` is declarative rather than free markup
 * so the figure/caption pair cannot drift from one panel to the next.
 *
 * `href` is what makes a row interactive. Without it the row is inert markup —
 * no hover affordance is rendered, because a row that looks clickable and is
 * not is a dead control.
 */
export function PanelRow({
  leading,
  title,
  subtitle,
  values,
  trailing,
  href,
  selected = false,
  className,
}: {
  /** Left of the title: an icon, an avatar, a status dot. */
  leading?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Right-aligned figures. Each renders as one tabular value over a tiny caption. */
  values?: { label: string; value: React.ReactNode }[]
  /** Far right: a badge, a chevron, a compact action. */
  trailing?: React.ReactNode
  /** Real destination. Omit it and the row renders as a plain, non-interactive row. */
  href?: string
  /**
   * The persistent "this is the one the operator is looking at" state — the
   * row for the record shown in a detail pane beside the list, for instance.
   * Renders on `surface-selected`, a step above the transient `surface-hover`
   * a pointer produces, so a selection does not get read as a passing hover.
   * Defaults to `false`; no existing caller passes it today.
   */
  selected?: boolean
  className?: string
}) {
  const body = (
    <>
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]/5 font-medium text-white">{title}</div>
        {subtitle ? <div className="mt-0.5 truncate text-[11px]/4 text-zinc-400">{subtitle}</div> : null}
      </div>
      {values && values.length > 0 ? (
        <div className="flex shrink-0 items-center gap-4 text-right">
          {values.map((entry) => (
            <div key={entry.label} className="min-w-0">
              <div className="text-[13px]/5 tabular-nums text-white">{entry.value}</div>
              <div className="text-[10px]/4 uppercase tracking-widest text-zinc-500">{entry.label}</div>
            </div>
          ))}
        </div>
      ) : null}
      {trailing ? <div className="flex shrink-0 items-center">{trailing}</div> : null}
    </>
  )

  const shared = cn(
    'flex min-w-0 items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0',
    selected && 'bg-surface-selected'
  )

  // Every caller passes an internal `/admin/...` route, so this is `Link` (which
  // wraps next/link): as a raw `<a>` each row navigation was a full document
  // reload, throwing away the client router and re-fetching the whole shell.
  return href ? (
    <Link href={href} className={cn(shared, 'transition-colors hover:bg-surface-hover', className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(shared, className)}>{body}</div>
  )
}

/* ------------------------------------------------------------------- table */

/**
 * THE console table language — one set, applied to the existing Catalyst
 * primitives of `src/components/ui/table.tsx`. No `Table` wrapper component is
 * introduced here: the kit already owns the markup, these constants only
 * retokenise it.
 *
 * WHY THIS EXISTS. Two dialects shipped side by side. `agents-screen` and
 * `agent-detail-screen` used the kit raw (`<Table dense>` + a bare
 * `bg-surface-sunken` head), which keeps the kit's UNTOKENISED hairlines
 * (`border-white/10`, `divide-white/8`) and its 24px edge padding
 * (`first:pl-6`) — so the first column sat 8px to the right of its own panel
 * title, which sits at `px-4`. `runs-screen` and `projects-screen` each carried
 * a private, near-identical copy of the fix. Same language, three sources.
 * All four console tables now consume THESE constants and hold no private copy.
 *
 * HOW THE OVERRIDES LAND — both mechanisms, on purpose:
 *  · On the SAME element (thead/tbody/tr), `cn()` passes the caller's class last
 *    and `tailwind-merge` drops the kit's conflicting one. Deterministic, no
 *    cascade involved. See `src/components/ui/cn.ts`.
 *  · On DESCENDANTS (th/td), the kit's `px-5 first:pl-6` cannot be reached from
 *    the parent by merging, so `TABLE_SHELL` uses arbitrary variants:
 *    `[&_td:first-child]:pl-4` compiles to `.shell td:first-child` (0,2,1),
 *    which outranks `.first\:pl-6:first-child` (0,2,0) by specificity rather
 *    than by stylesheet order. Declared ONCE on the table, not per cell.
 */

/**
 * Goes on `<Table className={TABLE_SHELL}>`. **Drop the `dense` prop** when you
 * apply it — `dense` emits `[&_td]:py-2.5` at the same specificity as the
 * `[&_td]:py-2` here, and the tie is then decided by stylesheet order.
 *
 * 12px body text, dense 8px rows, 12px inter-column gutters, and 16px at both
 * edges — the edge value is what makes a column and the `Section` header above
 * it (`px-4`) share one vertical line. That misalignment was the visible bug.
 */
export const TABLE_SHELL = [
  'text-xs',
  // `TableCell` is nowrap but `TableHeader` is not, so a two-word label
  // ("Started · UTC", "Runs · 24h") wrapped mid-header and broke the rhythm.
  '[&_th]:whitespace-nowrap',
  '[&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2',
  '[&_th:first-child]:pl-4 [&_td:first-child]:pl-4',
  '[&_th:last-child]:pr-4 [&_td:last-child]:pr-4',
].join(' ')

/**
 * Goes on `<TableHead className={TABLE_HEAD}>`. A sunken plate one step below
 * the panel, a tokenised hairline under it, and a 10px uppercase label.
 *
 * `text-zinc-400`, not the `zinc-500` the two private copies used: zinc-500 on
 * `--color-surface-sunken` measures ~4.1:1, under the 4.5 AA floor at this size.
 */
export const TABLE_HEAD = 'border-line bg-surface-sunken text-[10px] tracking-widest text-zinc-400'

/** Goes on `<TableBody className={TABLE_BODY}>`: row separators on the `line`
 *  token instead of the kit's untokenised `divide-white/8`. */
export const TABLE_BODY = 'divide-line'

/**
 * Goes on EVERY `<TableRow>` that does not lead anywhere — including the row
 * inside `TableHead`. The kit hovers every `<tr>`; a header row and an inert
 * data row that light up under the cursor advertise a control that is not there.
 *
 * TODAY THAT IS EVERY ROW OF THE CONSOLE. All four tables (runs, projects,
 * agents, agent detail — runs and versions) are inert: where a row offers a
 * destination it does so through a real `Button href` in its own cell
 * ("Open Builder", "Inspect"), which is the control the user can actually
 * focus and click. There is deliberately NO "row link" variant — a `<tr>`
 * cannot be an anchor, so a whole-row hover would promise a click target that
 * does not exist. If a row ever gains a genuine row-level destination, give it
 * `transition-colors hover:bg-surface-hover` and a real `<a>` covering the row.
 */
export const TABLE_ROW = 'hover:bg-transparent'

/** Goes on any `<TableHeader>` / `<TableCell>` holding a figure: right-aligned,
 *  tabular, so digits stack in a column instead of dancing row to row. */
export const TABLE_NUM = 'text-right tabular-nums'

/**
 * Wraps the `<Table>` when something must stay OUT of the scroll area (a footer
 * disclosure strip under the rows). Bounds the panel at the same rung as
 * `Section scroll="lg"`, so a table panel is exactly as tall as any other
 * bounded panel beside it, with 3 rows or with 300.
 *
 * WHEN TO USE WHICH — this is the ONLY difference, and it is a placement
 * question, not a CSS one. `Section scroll="lg"` bounds the panel's whole body,
 * so anything inside it scrolls, footer included. A footer that must stay
 * pinned while the rows move therefore cannot live in a `scroll`-ed Section:
 * the table gets this wrapper and the footer sits beside it, both inside an
 * unbounded body. When the table is the panel's ONLY child, skip this and use
 * `Section scroll="lg"` — one bound, not two nested.
 *
 * NOT A BEHAVIOURAL DIFFERENCE. A previous note here claimed `overflow-auto`
 * was required over `overflow-y-auto` so a too-wide row could scroll sideways
 * on a phone instead of being clipped. That is not how the property resolves:
 * per CSS Overflow 3, when one axis is not `visible` the other computes from
 * `visible` to `auto` — so `Section`'s `overflow-y-auto` scrolls horizontally
 * too. The two mechanisms behave identically; only the footer decides.
 */
export const TABLE_SCROLL = 'max-h-[26rem] overflow-auto'

/* ------------------------------------------------------------------ states */

/**
 * The absent measurement, in HTML. A metric that was never measured renders
 * this word — never 0, never "0%", never an empty gauge arc pretending to be a
 * measured zero. A measured 0 renders 0.
 *
 * The word itself is NOT spelled here: it is `UNAVAILABLE_LABEL` in
 * `@/lib/agent-mission-control/format`, the one neutral module the HTML layer,
 * the SVG gauges and `formatUsd` can all reach. This component owns the
 * RENDERING (the span, the zinc-500 role), not the string — a second literal
 * here is exactly how the vocabulary split in the first place.
 */
export function Unavailable({ className }: { className?: string }) {
  return <span className={cn('text-zinc-500', className)}>{UNAVAILABLE_LABEL}</span>
}

/** Nothing to show, and nothing wrong with that. Calm, neutral, never danger, never accent. */
export function EmptyState({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn('px-4 py-10 text-center', className)}>
      <p className="text-[13px]/5 text-zinc-400">{title}</p>
      {description ? <p className="mt-1 text-[11px]/4 text-zinc-600">{description}</p> : null}
    </div>
  )
}

/**
 * Something failed. The danger role, never the accent — an error painted in the
 * success hue is the single most expensive lie this console can tell.
 */
export function ErrorState({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-xl border border-[var(--state-danger-solid-line)] bg-[var(--state-danger-surface)] px-4 py-3.5 shadow-[var(--shadow-card-sm)]',
        className
      )}
    >
      <p className="text-[13px]/5 font-semibold text-[var(--state-danger-text)]">{title}</p>
      {description ? <p className="mt-1 text-[11px]/4 text-zinc-300">{description}</p> : null}
      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * The page is rendering, but part of its data could not be read — `dataWarnings`
 * is non-empty. Also the danger role: a partial answer must not look healthy.
 */
export function DegradedBanner({
  title = 'Degraded data',
  messages,
  className,
}: {
  title?: string
  /** One line per warning. Render nothing when empty — an empty banner is a lie. */
  messages: string[]
  className?: string
}) {
  if (messages.length === 0) return null
  return (
    <div
      role="status"
      className={cn(
        'rounded-xl border border-[var(--state-danger-solid-line)] bg-[var(--state-danger-surface)] px-4 py-3 shadow-[var(--shadow-card-sm)]',
        className
      )}
    >
      <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-[var(--state-danger-text)]">{title}</p>
      <ul className="mt-1.5 space-y-0.5">
        {messages.map((message) => (
          <li key={message} className="text-[11px]/4 text-zinc-300">
            {message}
          </li>
        ))}
      </ul>
    </div>
  )
}

/* --------------------------------------------------- shared console format */

/**
 * Presentation helpers shared by the console's screens.
 *
 * They live HERE, in the module every screen already imports, rather than in
 * one screen that another screen reaches into: `agents-screen.tsx` became a
 * client component (it owns search/filter/sort state), and the moment it did,
 * the server-rendered `agent-detail-screen.tsx` importing these two helpers
 * from it started throwing at request time — "Attempted to call
 * formatUtcTimestamp() from the server but it is on the client". Typecheck,
 * the full unit suite and `check:rsc-boundary` all stayed green; only loading
 * the page surfaced it.
 */

/** The dot role for an agent's runtime status. `unavailable` splits on the
 *  LIFECYCLE column: `archived` was retired on purpose (neutral), anything
 *  else is missing a hard requirement (danger). */
export function agentStatusTone(status: AvailableAgentStatus, lifecycleStatus?: string): StatusDotTone {
  if (status === 'active') return 'positive'
  if (status === 'degraded') return 'negative'
  if (status === 'unavailable') return lifecycleStatus === 'archived' ? 'neutral' : 'negative'
  return 'neutral'
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/**
 * ISO instant → `2026-07-29 08:14 UTC`, or `null` when the string is not a
 * parseable instant. UTC and locale-free on purpose: `toLocaleString()` renders
 * differently per server locale, and these screens render on both sides.
 */
export function formatUtcTimestamp(iso: string | null): string | null {
  if (iso === null) return null
  const epoch = Date.parse(iso)
  if (!Number.isFinite(epoch)) return null
  const date = new Date(epoch)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`
}
