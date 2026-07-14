import clsx from 'clsx'

import { surfaceCardClass } from '@/components/agent-ops/surface-card'
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
        surfaceCardClass,
        'group relative transition-colors duration-200 hover:border-white/10',
        className
      )}
    >
      <div className="relative p-6">
        {eyebrow ? (
          <p
            className={clsx(
              'text-xs font-medium tracking-wide uppercase',
              eyebrowTone === 'positive' ? 'text-accent-400' : 'text-zinc-500'
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <Subheading level={level} tone="accent" className={clsx(eyebrow && 'mt-2', 'text-white')}>
          {title}
        </Subheading>
        {description ? <p className="mt-2 text-sm text-zinc-400">{description}</p> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </div>
  )
}
