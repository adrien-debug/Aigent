import type React from 'react'
import { cn } from './cn'

type AvatarProps = {
  src?: string | null
  square?: boolean
  initials?: string
  alt?: string
  className?: string
  /** Custom fill — a glyph, an icon, a gradient tile — for identities that
   * are neither a photo nor initials (e.g. `CopilotAvatar`'s type icon).
   * Takes over the slot entirely: mutually exclusive with `src`/`initials`,
   * same as they already are with each other. The frame (outline, radius,
   * sizing) still comes from `Avatar` either way. */
  children?: React.ReactNode
}

export function Avatar({
  src = null,
  square = false,
  initials,
  alt = '',
  className,
  children,
  ...props
}: AvatarProps & React.ComponentPropsWithoutRef<'span'>) {
  return (
    <span
      data-slot="avatar"
      {...props}
      className={cn(
        // Basic layout
        'inline-grid shrink-0 align-middle [--avatar-radius:20%] *:col-start-1 *:row-start-1',
        'outline -outline-offset-1 outline-black/10 dark:outline-white/10',
        // Border radius
        square ? 'rounded-(--avatar-radius) *:rounded-(--avatar-radius)' : 'rounded-full *:rounded-full',
        className
      )}
    >
      {initials && (
        <svg
          className="size-full fill-current p-[5%] text-[48px] font-medium uppercase select-none"
          viewBox="0 0 100 100"
          aria-hidden={alt ? undefined : 'true'}
        >
          {alt && <title>{alt}</title>}
          <text x="50%" y="50%" alignmentBaseline="middle" dominantBaseline="middle" textAnchor="middle" dy=".125em">
            {initials}
          </text>
        </svg>
      )}
      {src && <img className="size-full" src={src} alt={alt} />}
      {children}
    </span>
  )
}
