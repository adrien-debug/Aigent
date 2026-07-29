import * as Headless from '@headlessui/react'
import { BellIcon, MagnifyingGlassIcon, UserCircleIcon } from '@heroicons/react/24/outline'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/labels'

/**
 * The 56px top bar — a SERVER component. Every figure it shows arrives as a
 * prop, already measured upstream; this file computes nothing and holds no
 * state. It is a sibling ABOVE the rail + content row (see the layout contract
 * at the top of `./rail.tsx`), which is what puts the mobile nav strip directly
 * under it.
 *
 * THREE HONESTY RULES ARE WIRED INTO THIS FILE:
 *
 *  1. THE SEARCH CONTROL IS A REAL LINK. A fake `<input>` that swallows
 *     keystrokes is a lie about what the console can do. The control is styled
 *     exactly like the reference search field and is in fact an
 *     `<a href="/admin/runs">` — a route that exists. It reads as a link and it
 *     genuinely takes you somewhere.
 *  2. NO IDENTITY IS INVENTED. No user profile is wired to this page, so the
 *     avatar carries a generic glyph — never a name, never initials pulled out
 *     of nowhere, never an email.
 *  3. AN UNMEASURED FIGURE IS NEVER A NUMBER, AND NEVER GREEN. `executableNow` /
 *     `executableTotal` are `number | null`; `null` means the platform could not
 *     read them — not zero — so the pill renders `UNAVAILABLE_LABEL`, the single
 *     legal word for an absent measurement, on the NEUTRAL zinc role. Only a
 *     real, measured figure earns the accent.
 *
 * The pill switches ROLE, not just wording: when `degraded` is true the platform
 * itself is reporting trouble, so it renders on the danger role. A degraded
 * console must never read as healthy green.
 */
export function Topbar({
  degraded,
  executableNow,
  executableTotal,
}: {
  /** True when the page's data layer reported at least one warning. */
  degraded: boolean
  /** Agents the runtime would accept a run for right now. `null` = not measured. */
  executableNow: number | null
  /** Agents considered. `null` = not measured. */
  executableTotal: number | null
}) {
  const measured = executableNow !== null && executableTotal !== null

  // Three states, three roles: failure → danger, absence → neutral zinc,
  // a real reading → accent. The accent is never spent on the first two.
  const pillColor = degraded ? 'danger' : measured ? 'accent' : 'zinc'

  // Spoken in full at every width; the visible half below collapses under sm.
  const pillLabel = degraded
    ? 'Service dégradé'
    : measured
      ? `${executableNow}/${executableTotal} agents exécutables`
      : `Agents exécutables : ${UNAVAILABLE_LABEL}`

  const pillTitle = degraded
    ? 'La plateforme signale une dégradation — les chiffres de cette page peuvent être incomplets.'
    : measured
      ? 'Agents pour lesquels le runtime accepterait un run maintenant.'
      : 'Le nombre d’agents exécutables n’a pas pu être lu.'

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-app px-4">
      <div className="flex shrink-0 flex-col justify-center leading-tight">
        <span className="text-sm font-semibold tracking-tight text-white">Aigent</span>
        <span className="hidden text-xs text-zinc-400 sm:block">Console d’orchestration</span>
      </div>

      {/* `min-w-0` so the search field yields width instead of pushing the bar
          past the viewport at 375px; the label truncates rather than overflows. */}
      <div className="flex min-w-0 flex-1 justify-center">
        <Link
          href="/admin/runs"
          title="Ouvrir la console des runs"
          className="flex h-8 w-full max-w-md min-w-0 items-center gap-2 rounded-full border border-line bg-sunken px-3 text-xs text-zinc-400 transition-colors hover:border-line-strong hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <MagnifyingGlassIcon aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
          <span className="truncate">Rechercher dans les runs</span>
        </Link>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Headless.Button
          type="button"
          aria-label="Notifications"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <BellIcon aria-hidden="true" className="size-5" />
        </Headless.Button>

        {/* Decoration, and it says so: no identity is wired to this screen, so
            the avatar is hidden from assistive tech rather than given a made-up
            name. It also stands down under sm to leave the search its width. */}
        <Avatar aria-hidden="true" className="hidden size-7 shrink-0 bg-zinc-800 sm:inline-grid">
          <UserCircleIcon className="size-full text-zinc-500" />
        </Avatar>

        <Badge
          color={pillColor}
          title={pillTitle}
          // `text-xs` is passed on purpose: it makes `Badge`'s responsive size
          // pair collapse to one rung, so the pill stays 12px inside the 56px
          // bar instead of jumping to 14px below 640px.
          className="shrink-0 rounded-full px-2.5 py-1 text-xs"
        >
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />

          {/* Read once, at every width. The visible half below is `aria-hidden`
              so nothing is announced twice from 640px up. */}
          <span className="sr-only">{pillLabel}</span>

          {degraded ? (
            <span aria-hidden="true" className="hidden sm:inline">
              Service dégradé
            </span>
          ) : measured ? (
            <span aria-hidden="true" className="hidden items-baseline gap-1 sm:inline-flex">
              <span className="font-mono tabular-nums">
                {executableNow}/{executableTotal}
              </span>
              <span>agents exécutables</span>
            </span>
          ) : (
            <span aria-hidden="true" className="hidden sm:inline">
              {UNAVAILABLE_LABEL}
            </span>
          )}
        </Badge>
      </div>
    </header>
  )
}
