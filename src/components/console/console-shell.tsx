import {
  ArrowRightStartOnRectangleIcon,
  CircleStackIcon,
  CommandLineIcon,
  CpuChipIcon,
  HomeIcon,
  PlayCircleIcon,
} from '@heroicons/react/24/outline'

import { cn } from '@/components/ui/cn'
import { Heading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'

/**
 * The console frame: a graphite rail (216px at `lg`, 248px from `xl`), a 52px
 * topbar, and the content column. Server component — it holds no state and
 * reads no data, everything it renders comes from props, which is the only
 * reason it can stay one.
 *
 * THREE THINGS THIS FILE DELIBERATELY REFUSES TO RENDER:
 *
 *  1. A DEAD CONTROL. The rail used to carry `Factory`, `Performance` and
 *     `Settings` as DISABLED buttons pointing at `href: null`. Those routes were
 *     demolished (scripts/check-no-legacy-front.mjs still fails the build if any
 *     of them comes back); a greyed-out entry for a screen that does not exist
 *     is an advertisement for vapour. They are deleted, not hidden. Project
 *     Builder is absent for the opposite reason: it is real, but it lives at
 *     `/admin/projects/[id]/builder` and cannot be reached without a project id,
 *     so it is reached from the Projects screen instead of a fabricated link.
 *
 *  2. AN INVENTED MEASUREMENT. The topbar used to show a hardcoded green
 *     "Connected" dot. Nothing measured it; it was green on a dead database. The
 *     platform state now comes from the route via `stateLabel` / `stateTone`, and
 *     a route that cannot supply one gets NO dot at all — see
 *     `resolvePlatformState`. An absent warning in the reads a route made is
 *     neutral, never positive — only a measured health earns the accent role.
 *
 *  3. A WORD THE DESTINATION CANNOT HONOUR. The quick-access control used to be
 *     labelled "Live runs". Nothing behind it is live: `/admin/runs` is a server
 *     render (`dynamic = 'force-dynamic'` = fresh per REQUEST, not streaming),
 *     there is no `EventSource`, no polling and no `revalidate` anywhere under
 *     `src/`, and the runs table prints its own "Read at <t> UTC" footer
 *     precisely because it is a snapshot. It now says "Run activity" — the same
 *     wording `agents-screen` already uses for the same destination.
 */

/**
 * The rail. Every entry is a route that exists on disk today
 * (`src/app/admin/**`); adding one here without adding the page is how a dead
 * control gets back in.
 */
const NAVIGATION = [
  { href: '/admin', label: 'Overview', icon: HomeIcon },
  { href: '/admin/runs', label: 'Runs', icon: PlayCircleIcon },
  { href: '/admin/projects', label: 'Projects', icon: CircleStackIcon },
  { href: '/admin/agents', label: 'Agents', icon: CpuChipIcon },
] as const

type NavIcon = (typeof NAVIGATION)[number]['icon']

/**
 * Which rail entry lights up, given the path the route handed us.
 *
 * A server component cannot read `usePathname()` without turning client, so the
 * path is a PROP. Detail routes are resolved by prefix, so
 * `/admin/agents/copilot-x` lights `Agents` and
 * `/admin/projects/proj-1/builder` lights `Projects` without either page having
 * to know the rail's shape. `/admin` matches EXACTLY — it prefixes every other
 * entry, so treating it as a prefix would light Overview on every screen.
 */
function resolveActiveHref(activeHref: string | undefined): string | null {
  if (!activeHref) return null
  const path = activeHref.split(/[?#]/)[0].replace(/\/+$/, '') || '/'

  let best: string | null = null
  for (const { href } of NAVIGATION) {
    if (path === href) return href
    if (href === '/admin') continue
    if (path.startsWith(`${href}/`) && (best === null || href.length > best.length)) best = href
  }
  return best
}

/**
 * The wording shown when a route flags degradation but supplies none of its own.
 *
 * Deliberately NOT the bare word `Degraded`: that is a value of the RUNTIME
 * AGENT status vocabulary (`active | inactive | degraded | unavailable`), and
 * reusing it here would put an agent-level word in a platform-level slot — the
 * exact ambiguity this console has been bitten by before, where one word in two
 * slots read as two different claims. This says what it means: the SERVICE is
 * degraded, not some agent.
 */
const DEGRADED_STATE_LABEL = 'Service degraded'

/**
 * Platform state for the topbar — or nothing.
 *
 * The rule is the repo's render-truth rule applied to a dot: an absent
 * measurement is not rendered as a healthy one. No label and no degradation
 * flag ⇒ `null` ⇒ the cluster does not render. `degraded` on its own IS a
 * measurement, so it still surfaces (in the danger role) rather than being
 * silently dropped for want of a word.
 */
function resolvePlatformState(
  stateLabel: string | undefined,
  stateTone: StatusDotTone | undefined,
  degraded: boolean
): { label: string; tone: StatusDotTone } | null {
  const label = stateLabel?.trim()
  if (label) {
    const tone = stateTone ?? (degraded ? 'negative' : 'neutral')
    return { label, tone }
  }
  if (degraded) return { label: DEGRADED_STATE_LABEL, tone: stateTone ?? 'negative' }
  return null
}

/**
 * One rail entry. The ACTIVE item is a solid accent pill with zinc-950 text —
 * dark on `#A7FB90` measures ~16:1, and it is the single most recognisable trait
 * of the frame. Inactive items are zinc with a `bg-surface-hover` hit area.
 *
 * Written against `Link` rather than `Button plain`: `Button`'s base carries
 * `text-base/6 sm:text-sm/6`, and a caller class cannot beat the `sm:` half
 * (see the `responsiveDefault` note in src/components/ui/cn.ts), so a compact
 * 13px rail item built on `Button` would silently render 14px from 640px up.
 */
function NavItem({
  href,
  label,
  icon: Icon,
  active,
  className,
}: {
  href: string
  label: string
  icon: NavIcon
  active: boolean
  className?: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]/5 font-medium transition-colors',
        active
          ? 'bg-accent-500 text-content-on-accent'
          : 'text-content-muted hover:bg-surface-hover hover:text-white',
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-4 shrink-0', active ? 'text-content-on-accent' : 'text-content-subtle group-hover:text-content-muted')}
      />
      <span className="truncate">{label}</span>
    </Link>
  )
}

export function ConsoleShell({
  children,
  activeHref,
  title,
  stateLabel,
  stateTone,
  degraded = false,
}: {
  children: React.ReactNode
  /**
   * The path of the screen being rendered — `'/admin'`, `'/admin/runs'`, or the
   * concrete path of a detail route (`/admin/agents/${id}`), which lights its
   * parent section. Omitted ⇒ no active pill.
   */
  activeHref?: string
  /** Page title, left of the topbar. Omitted ⇒ the topbar shows no title. */
  title?: string
  /**
   * The platform state word, right of the topbar (e.g. `'No data-source warning
   * reported'`, `'Partial data'`). Omitted ⇒ nothing is claimed and nothing is
   * drawn. Deliberately NOT `'Live'` — see point 3 of the file docblock.
   */
  stateLabel?: string
  /**
   * Explicit visual role for `stateLabel`. Required whenever the label is not
   * a plain absence-of-warning: `positive` only for measured health,
   * `negative` for proven degradation, `neutral` for scoped reads that reported
   * no warning. Omitted with `degraded` falls back to negative; omitted
   * otherwise falls back to neutral — never to positive.
   */
  stateTone?: StatusDotTone
  /** When no `stateLabel` is supplied, surfaces the service-degraded fallback. */
  degraded?: boolean
}) {
  const active = resolveActiveHref(activeHref)
  const state = resolvePlatformState(stateLabel, stateTone, degraded)

  return (
    <div className="min-h-screen bg-surface-app text-white">
      {/* FULL-BLEED FRAME, CAPPED CONTENT. The width cap used to sit here, on
          the grid, which put the RAIL inside it: above 1800px the graphite
          plane detached from the left edge of the screen and floated in page
          ground with a border on one side and nothing on the other — a
          rendering fault, not a layout choice. The cap now lives on the two
          things that actually need a reading measure (the topbar row and
          `<main>`), at `1552px` = the old `1800 − 248`, so the content measure
          is unchanged and only the rail moved.

          THE TRACK IS RESPONSIVE, WHICH IS THE WHOLE "COMPACT AT INTERMEDIATE
          WIDTHS" ANSWER. It used to be one binary switch — nothing below `lg`,
          248px from `lg` up — so at 1024px four short links ate 24.2% of the
          viewport. 216px at `lg` returns 32px to the content column exactly
          where it is scarcest, and still clears the widest thing in the rail:
          the brand band needs 16 + 28 + 10 + ~118 ("Agent Mission Control" at
          10px) + 16 ≈ 188px. From `xl` the rail is back to 248px.
          NO collapse toggle: a hamburger needs open/close state, which would
          force `'use client'` onto the entire frame. CSS only. */}
      <div className="grid min-h-screen lg:grid-cols-[216px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)]">
        {/* The rail owns the border and the graphite plane so both run the FULL
            page height; the sticky inner column is what stays in view. */}
        {/* The rail sits on the PAGE plane, not the card plane. It used to share
            `surface-raised` with every panel, so the frame and the content read
            as one continuous grey and nothing looked layered. Black rail, black
            page, cards lifted above both: one clear hierarchy. */}
        <aside className="hidden border-r border-line bg-surface-app lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            {/* Brand band, height-matched to the topbar so the two hairlines
                read as one continuous rule across the frame. */}
            <div className="flex h-13 shrink-0 items-center gap-2.5 border-b border-line px-4">
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-500 text-content-on-accent"
              >
                <CommandLineIcon className="size-4" />
              </span>
              <div className="min-w-0">
                <Heading level={2} className="truncate text-[13px]/4 font-semibold">
                  Aigent
                </Heading>
                <p className="mt-0.5 truncate text-[10px]/4 text-content-subtle">Agent Mission Control</p>
              </div>
            </div>

            <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
              <p className="px-2.5 pb-1.5 text-[10px]/4 font-semibold uppercase tracking-widest text-content-faint">
                Console
              </p>
              <ul className="space-y-0.5">
                {NAVIGATION.map((item) => (
                  <li key={item.href}>
                    <NavItem
                      href={item.href}
                      label={item.label}
                      icon={item.icon}
                      active={item.href === active}
                      className="w-full"
                    />
                  </li>
                ))}
              </ul>
            </nav>

            {/* Footer: one real destination. `/logout` is a GET route handler
                (src/app/logout/route.ts) written so a plain link can trigger it —
                a plain <a> on purpose, because next/link would PREFETCH it and
                sign the operator out on hover. */}
            <div className="shrink-0 border-t border-line p-2.5">
              <a
                href="/logout"
                className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px]/5 font-medium text-content-muted transition-colors hover:bg-surface-hover hover:text-white"
              >
                <ArrowRightStartOnRectangleIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-content-subtle group-hover:text-content-muted"
                />
                <span className="truncate">Sign out</span>
              </a>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          {/* Topbar + compact rail travel together: below `lg` the sidebar is
              gone, so the strip IS the navigation and must stay reachable. */}
          <div className="sticky top-0 z-20 bg-surface-app/95 backdrop-blur">
            {/* The hairline spans the whole column (it is the frame's rule); the
                ROW inside it carries the same `max-w-[1552px]` cap and the same
                padding as `<main>`, so the title and the state cluster stay on
                the content's own edges at every width. */}
            <header className="border-b border-line">
              <div className="mx-auto flex h-13 w-full max-w-[1552px] items-center justify-between gap-3 px-3 sm:px-4 lg:px-5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="grid size-6 shrink-0 place-items-center rounded bg-accent-500 text-content-on-accent lg:hidden"
                  >
                    <CommandLineIcon className="size-3.5" />
                  </span>
                  {title ? <p className="truncate text-[13px]/5 font-semibold text-white">{title}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {state ? (
                    <StatusDot tone={state.tone} className="max-w-32 text-[11px]/4">
                      {state.label}
                    </StatusDot>
                  ) : null}
                  {/* Quick access = a REAL destination, under a label that
                      destination can honour. The frame this adapts puts a search
                      field here; a field that filters nothing is a dead control,
                      so the slot carries the one link an operator always wants
                      instead.
                      It says "Run activity", NOT "Live runs" — see point 3 of
                      the file docblock. Polling was NOT added to rescue the old
                      word: that would trade a labelling defect for a load
                      defect, and a genuinely live view needs its own SSE
                      endpoint plus a client consumer, neither of which exists.
                      SUPPRESSED ON THE RUNS SECTION ITSELF: a control that
                      navigates to the screen already being read is a no-op
                      dressed as an action. The rail entry beside it keeps the
                      `aria-current` pill, so nothing is lost. */}
                  {active === '/admin/runs' ? null : (
                    <Link
                      href="/admin/runs"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-raised px-2 py-1 text-[11px]/4 font-medium text-content-muted transition-colors hover:bg-surface-hover hover:text-white"
                    >
                      <PlayCircleIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      <span className="truncate">Run activity</span>
                    </Link>
                  )}
                </div>
              </div>
            </header>

            {/* CSS-only small-screen navigation: one scrollable strip, no JS, no
                hamburger, no open/close state to keep this a server component. */}
            <nav
              aria-label="Primary (compact)"
              className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5 lg:hidden"
            >
              {NAVIGATION.map((item) => (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={item.href === active}
                  className="shrink-0"
                />
              ))}
            </nav>
          </div>

          {/* `w-full max-w-[1552px] mx-auto`: the reading measure the cap used
              to give the whole frame, applied where it belongs. 1552 − 40 of
              `lg:p-5` = the same 1512px content measure the old
              `max-w-[1800px]` produced, so no screen's grid rungs move. */}
          <main className="mx-auto w-full min-w-0 max-w-[1552px] flex-1 p-3 sm:p-4 lg:p-5">{children}</main>
        </div>
      </div>
    </div>
  )
}
