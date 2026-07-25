'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import type { AgentRecommendation } from '@/lib/agent-mission-control/repo-intelligence'

const PRIORITY_ORDER: Record<AgentRecommendation['priority'], number> = { high: 0, medium: 1, low: 2 }

/**
 * Drawer listing repo-scan agent suggestions. Secondary to the Builder chat —
 * nothing here creates an agent; "Discuss with Builder" posts a real chat message.
 */
export function ProjectBuilderSuggestionsDrawer({
  open,
  onClose,
  recommendations,
  onDiscuss,
}: {
  open: boolean
  onClose: () => void
  recommendations: AgentRecommendation[]
  onDiscuss: (rec: AgentRecommendation) => void
}) {
  const sorted = [...recommendations].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

  return (
    <Dialog open={open} onClose={onClose} size="3xl">
      <DialogTitle>Suggestions from repo scan</DialogTitle>
      <DialogDescription>
        Agents that could be useful for this repository — ranked by priority. Pick one to discuss with the
        Builder; nothing is created until you explicitly approve a draft.
      </DialogDescription>
      <DialogBody className="max-h-[min(70vh,640px)] overflow-y-auto">
        {sorted.length === 0 ? (
          <Text>No suggestion stood out from this scan — you can still describe any agent in the chat.</Text>
        ) : (
          <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
            {sorted.map((rec) => (
              <li key={rec.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge color={rec.priority === 'high' ? 'accent' : 'zinc'}>{rec.priority}</Badge>
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-950 dark:text-white">
                    {rec.title}
                  </span>
                </div>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{rec.why}</p>
                <p className="text-xs text-zinc-500">Role: {rec.proposedRole}</p>
                <div className="grid gap-1 text-xs text-zinc-500 sm:grid-cols-2">
                  <p>
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Tools:</span>{' '}
                    {rec.toolsNeeded.join(', ') || '—'}
                  </p>
                  <p>
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Tests:</span>{' '}
                    {rec.testsNeeded.join('; ') || '—'}
                  </p>
                </div>
                {rec.risks.length > 0 ? (
                  <p className="text-xs text-zinc-500">
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">Risks:</span>{' '}
                    {rec.risks.join(' · ')}
                  </p>
                ) : null}
                <p className="text-xs text-zinc-500">{rec.releaseValue}</p>
                <Button
                  outline
                  className="mt-1"
                  aria-label={`Discuss "${rec.title}" with Builder`}
                  onClick={() => {
                    onDiscuss(rec)
                    onClose()
                  }}
                >
                  Discuss this with Builder
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
