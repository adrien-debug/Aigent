import clsx from 'clsx'

import { surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

/**
 * Bento / feature panel on the admin canvas — same Section paint as
 * `SurfaceCard` / `AgentSectionCard` (`#121214`). Never Item (`#1f1f22`):
 * that level is for rows/tiles *inside* a section, not peer panels.
 */
export function AgentBentoCard({
  eyebrow,
  eyebrowTone = 'neutral',
  title,
  description,
  children,
  className,
  level = 2,
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
    <section className={clsx(surfaceSectionClass, className)}>
      <div className="relative p-6">
        {eyebrow ? (
          <p
            className={clsx(
              'text-[10px] font-medium uppercase tracking-widest',
              eyebrowTone === 'positive' ? 'text-accent-400' : 'text-zinc-500'
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <Subheading level={level} tone="neutral" className={clsx('tracking-tight text-white', eyebrow && 'mt-1')}>
          {title}
        </Subheading>
        {description ? <Text className="mt-1 tracking-tight">{description}</Text> : null}
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </section>
  )
}
