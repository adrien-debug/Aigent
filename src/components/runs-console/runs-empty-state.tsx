import { FunnelIcon, InboxIcon } from '@heroicons/react/24/outline'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'

/**
 * Two genuinely different absences, never merged into one "no data" screen:
 * filters that exclude everything, versus a window that truly holds no run.
 */
export function RunsEmptyState({
  hasFilters,
  onReset,
}: {
  hasFilters: boolean
  onReset: () => void
}) {
  const Icon = hasFilters ? FunnelIcon : InboxIcon

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-surface-sunken text-zinc-400 ring-1 ring-[var(--surface-border)]">
        <Icon className="size-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium text-white">
        {hasFilters ? 'No run matches these filters' : 'No operational run in this window'}
      </p>
      <Text size="xs" className="max-w-sm">
        {hasFilters
          ? 'The loaded runs are real — none of them satisfies the current combination. Widen the period or clear a filter.'
          : 'The backend answered, and it holds no operational run for the last 24 hours. Evaluation runs are excluded by contract and never appear here.'}
      </Text>
      {hasFilters ? (
        <Button color="accent" onClick={onReset} className="mt-1">
          Clear filters
        </Button>
      ) : null}
    </div>
  )
}
