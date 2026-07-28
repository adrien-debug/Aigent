import { EmptyState } from '@/components/agent-ops/empty-state'
import { surfaceSunken } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { AgentDraftRow } from '@/lib/agent-mission-control/agent-drafts-store'

const STATUS_BADGE: Record<AgentDraftRow['status'], 'accent' | 'zinc'> = {
  drafting: 'zinc',
  ready: 'accent',
  created: 'zinc',
}

export function AgentDraftsPanel({ drafts }: { drafts: AgentDraftRow[] }) {
  if (drafts.length === 0) {
    return (
      <EmptyState
        title="No drafts yet"
        description="Agent drafts created from the Architect will appear here."
        action={
          <Link
            href="/admin/agents/new"
            className="text-sm font-medium text-accent-600 hover:text-accent-500 dark:text-accent-400"
          >
            Create an agent
          </Link>
        }
      />
    )
  }

  return (
    <div className="max-h-96 overflow-y-auto px-6 py-4">
      <ul className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <li key={draft.id} className={`flex flex-col gap-2 p-4 ${surfaceSunken}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Strong className="truncate text-sm">{draft.name}</Strong>
                  <Badge color={STATUS_BADGE[draft.status]}>{draft.status}</Badge>
                </div>
                <Text size="xs" className="mt-0.5 font-mono">
                  {draft.id}
                </Text>
              </div>
              <Link
                href="/admin/agents/new"
                className="shrink-0 text-xs font-medium text-accent-600 hover:text-accent-500 dark:text-accent-400"
              >
                Resume
              </Link>
            </div>
            <Text size="xs">
              {draft.messages.length} message{draft.messages.length === 1 ? '' : 's'}
              {draft.manifest ? ' · manifest ready' : ' · in progress'}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  )
}
