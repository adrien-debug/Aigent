import clsx from 'clsx'

import { Subheading } from '@/components/catalyst/heading'

export function AgentBentoCard({
  eyebrow,
  eyebrowTone = 'neutral',
  title,
  description,
  children,
  className,
  level = 3,
}: {
  eyebrow?: string
  /** 'positive' only when the eyebrow genuinely signals a healthy/active state (doctrine: green = success). */
  eyebrowTone?: 'neutral' | 'positive'
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
  level?: 1 | 2 | 3 | 4 | 5 | 6
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10',
        className
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-radial-[at_top_left] from-zinc-950/[0.02] via-transparent to-transparent dark:from-white/[0.04]"
      />
      <div className="relative p-6 sm:p-8">
        {eyebrow ? (
          <p
            className={clsx(
              'text-xs font-medium tracking-wide uppercase',
              eyebrowTone === 'positive' ? 'text-green-700 dark:text-green-400' : 'text-zinc-500'
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <Subheading level={level} className={clsx(eyebrow && 'mt-2')}>
          {title}
        </Subheading>
        {description ? <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{description}</p> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  )
}
