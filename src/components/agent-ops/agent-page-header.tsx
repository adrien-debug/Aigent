import { Heading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'

export function AgentPageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string
  description?: string
  meta?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <Heading className="truncate">{title}</Heading>
        {description ? <Text className="mt-1 max-w-2xl">{description}</Text> : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  )
}
