import clsx from 'clsx'

import { surfaceRaised } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'

/**
 * An empty-state title is a LABEL, not a sentence — "No drafts yet", never
 * "No drafts yet.". Callers drifted both ways ("No repository selected yet.",
 * "This repository is empty." against "No runs yet", "All clear"), so the
 * terminal period is stripped HERE, in the component that owns the grammar,
 * rather than trusted to ~20 call sites that already proved they diverge.
 * A middle period is untouched: only a trailing one is punctuation drift.
 */
function asLabel(title: string): string {
  return title.replace(/\s*\.+$/, '')
}

/**
 * Padding is a PROP, not a `className`, and the reason is measured, not
 * stylistic. `EmptyState` used to compose `clsx('px-6 py-12', className)`,
 * which reads like an override and is not one: two utilities of the same
 * property have identical specificity, so the winner is whichever Tailwind
 * emits LAST in the compiled sheet — never the one written last in the
 * attribute. Probed in the running app against the real stylesheet:
 *   `px-6 py-12 py-8`        → 48px         (the caller's py-8 is dead)
 *   `px-6 py-12 px-0 py-6`   → 48px / 24px  (BOTH of the caller's are dead)
 * Two agent-ops call sites were asking for a tighter box and silently getting
 * the roomy one, which is why an empty card inside a dense panel carried the
 * same 96px of vertical air as a full-page empty state.
 * With a prop, exactly ONE padding string is ever emitted, so there is no race
 * left to lose. `className` keeps its legitimate role: ADDING what the default
 * does not set (`flex-1`, `min-h-0`), never replacing it.
 */
const EMPTY_STATE_PADDING = {
  /** Full-width / full-card empty state — the page-level default. */
  default: 'px-6 py-12',
  /** A card body that must not dominate the row it shares with a populated peer. */
  compact: 'px-6 py-8',
  /** Inside a section that already owns the gutter: vertical air only. */
  inline: 'px-0 py-6',
} as const

export type EmptyStatePadding = keyof typeof EMPTY_STATE_PADDING

/**
 * EmptyState — the ONE empty-state grammar for /admin screens (canon fixed by
 * DS audit: 5 different copy-pasted empty-state markups were found across the
 * repo). Centered, generous padding, discrete zinc icon, NEUTRAL title (this
 * is an empty state, not a section title — no accent), zinc-500 description,
 * optional action slot for a follow-up button/link.
 *
 * The title is a `role="status"` LABEL, not a heading. It used to render a
 * `Subheading`, i.e. an `<h2>` — the exact rank that `Section`/`AgentSection`
 * give the card the empty state sits INSIDE (`components/ui/section.tsx:76`,
 * `agent-ops/agent-section.tsx:31` both render `Subheading level={2}`). So
 * "No runs yet" was published as a SIBLING section of "Runs" rather than as
 * its content: heading navigation announced a section that does not exist,
 * and the document outline claimed a structure the page does not have. 14
 * dashboard files pair the two components, across /admin, /admin/agents,
 * /admin/projects and /admin/factory.
 *
 * `role="status"` is the honest role: this is a transient state of a region,
 * and it earns something a heading never gave — when a client filter or a
 * refresh empties a populated list, the swap is announced instead of silently
 * replacing rows. No accessible name is lost in the trade: no `aria-labelledby`
 * exists anywhere in `src/`, and this heading carried no `id`, so no region
 * ever drew its name from it.
 *
 * Callers own the surrounding surface (card/section wrapper); this component
 * only lays out the centered content block, on the `EMPTY_STATE_PADDING`
 * rhythm chosen through the `padding` prop above.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  padding = 'default',
  className,
}: {
  icon?: React.ComponentType<React.ComponentProps<'svg'>>
  title: string
  description?: string
  action?: React.ReactNode
  padding?: EmptyStatePadding
  className?: string
}) {
  return (
    <div role="status" className={clsx(EMPTY_STATE_PADDING[padding], className)}>
      <div className="mx-auto max-w-md text-center">
        {Icon ? <Icon aria-hidden="true" className="mx-auto size-10 text-zinc-500" /> : null}
        {/* Byte-for-byte the classes the neutral `Subheading` actually resolved
            to: its own `text-base/7 font-semibold sm:text-sm/6` plus the neutral
            tone's `text-zinc-950 dark:text-white` — which beat the caller's
            `text-zinc-900`, since Tailwind settles a same-utility clash by the
            order of the generated CSS (`.text-zinc-950` is emitted last), not by
            the order of the class attribute. Only the tag (and therefore the
            document outline) changes; nothing moves on screen. */}
        <p
          className={clsx(
            Icon && 'mt-4',
            'text-base/7 font-semibold text-zinc-950 sm:text-sm/6 dark:text-white'
          )}
        >
          {asLabel(title)}
        </p>
        {/* `mt-2` only. The `text-zinc-600` that used to sit here was a no-op:
            `Text` composes `clsx(className, defaults)`, so its own
            `text-zinc-500 dark:text-zinc-400` is what the stylesheet emits last
            and therefore what paints. The class claimed a tone the component
            never had, and contradicted this file's own doc ("zinc-500
            description") two comments above. Removed rather than made real with
            `!`: zinc-500/400 IS the intended description tone. */}
        {description ? <Text className="mt-2">{description}</Text> : null}
        {action ? <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div> : null}
      </div>
    </div>
  )
}

/**
 * EmptyStatePanel — `EmptyState` plus the surface it stands on.
 *
 * `EmptyState` deliberately owns no surface, which left every caller to write
 * its own wrapper. Ten of them converged on the same hand-rolled string —
 * `rounded-2xl border border-dashed border-white/5 bg-white/[0.01]` — a dashed
 * hairline at 5% over a 1% fill. On the dark ground that is very close to
 * invisible: the panel does not separate from the page, so a legitimately empty
 * section reads as a rendering failure rather than a deliberate state.
 *
 * This wraps the same content in the real `surfaceRaised` plane, so an empty
 * panel occupies the SAME visual slot as the populated panel it replaces —
 * the page keeps its structure whether or not there is data. Use this whenever
 * an empty state stands in for a card; use bare `EmptyState` only when the
 * caller already provides a surface (e.g. inside an existing `Section`).
 *
 * `className` lands on the SURFACE, not on the inner content. It used to go to
 * the content, which made the surface unreachable: five callers mounted this
 * inside a `Section` — a surface already — and tried to cancel the doubled plane
 * with `className="border-0 bg-transparent"`. That string reached a content div
 * that had neither a border nor a background, so it did nothing at all while
 * looking like it had; the ring, the shadow and the rounded fill kept painting a
 * card inside a card. Those callers now use bare `EmptyState`, and routing
 * `className` here means the next attempt to restyle the plane actually bites.
 */
export function EmptyStatePanel({
  className,
  ...props
}: React.ComponentProps<typeof EmptyState>) {
  return (
    <div className={clsx(surfaceRaised, className)}>
      <EmptyState {...props} />
    </div>
  )
}

/**
 * NotMeasuredDash — the cell-level counterpart of EmptyState: a dimension that
 * was never measured renders "—", NEVER a 0. Zero asserts "a run looked and
 * found none"; absence of measurement asserts nothing. Any table/matrix cell
 * fed a `null` metric must use this rather than coercing to a number.
 *
 * Screen readers get "not measured" — the em dash alone is silent.
 */
export function NotMeasuredDash() {
  return (
    <span className="text-zinc-400">
      <span aria-hidden="true">—</span>
      <span className="sr-only">not measured</span>
    </span>
  )
}
