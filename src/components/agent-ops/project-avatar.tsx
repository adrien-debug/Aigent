import clsx from 'clsx'

import { Avatar } from '@/components/ui/avatar'
import { metaTextClass } from '@/components/ui/text'

/**
 * Canonical project identity chip.
 *
 * Projects are workspaces: square avatar, real photo/logo when there is one,
 * initials otherwise. (Copilots are operators — round icon avatar, see
 * `copilot-avatar.tsx`. Keeping the two shapes distinct is what tells a
 * project apart from an agent at a glance.)
 *
 * Exists because the same chip was inlined in three places as
 * `bg-zinc-100 text-zinc-900` — a LIGHT tile with dark initials dropped onto a
 * dark panel, which read as a bright sticker rather than an avatar. On the dark
 * ground the fill now sits on the sunken plane with light initials.
 *
 * Sizes are a closed set (§6): 28/32px in dense rows, 40/48px on detail pages.
 * No arbitrary size — pass a token, not a class.
 */

const SIZE = {
  xs: 'size-7', // 28px — dense table rows
  sm: 'size-8', // 32px — standard rows, lists
  md: 'size-10', // 40px — detail page headers
  lg: 'size-12', // 48px — hero
} as const

const TEXT = {
  xs: 'text-[10px]',
  sm: metaTextClass,
  md: 'text-sm',
  lg: 'text-base',
} as const

export type ProjectAvatarSize = keyof typeof SIZE

export function ProjectAvatar({
  name,
  src,
  size = 'sm',
  className,
}: {
  name: string
  /** Real image or logo URL. Null/empty falls back to initials — never a blank tile. */
  src?: string | null
  size?: ProjectAvatarSize
  className?: string
}) {
  const image = src || null

  return (
    <Avatar
      square
      src={image}
      // Catalyst renders `initials` only when there is no src, so passing both
      // is safe and gives a graceful fallback rather than an empty square.
      initials={image ? undefined : name.slice(0, 2).toUpperCase()}
      alt=""
      className={clsx(
        SIZE[size],
        TEXT[size],
        'shrink-0 font-medium',
        // Light theme keeps the pale tile; dark theme uses the sunken plane so
        // the chip belongs to the surface instead of glowing on top of it.
        'bg-zinc-100 text-zinc-700 ring-1 ring-zinc-950/10',
        'dark:bg-surface-sunken dark:text-zinc-300 dark:ring-[var(--surface-border-strong)]',
        className,
      )}
    />
  )
}
