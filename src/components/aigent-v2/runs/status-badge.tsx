import { Badge } from '@/components/ui/badge'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * Run status in the design system's OWN vocabulary (P003: Catalyst only, no
 * parallel palette). `Badge` ships exactly three roles and they map cleanly:
 *
 *   completed          -> accent      the mono-accent ladder = a good outcome
 *   failed / blocked   -> danger      the ONE non-accent hue, reserved for
 *                                     failure (`check:danger` enforces that a
 *                                     failure never wears the accent)
 *   running / pending  -> zinc        neither proved yet — colouring an
 *                                     in-flight run would pre-announce an
 *                                     outcome nothing has measured
 *
 * The Vision frame separates "blocked" (amber) from "failed" (red). This design
 * system declares no amber role, and `theme.css` documents `--state-danger-*`
 * as "the only deliberate exception" to the mono-accent rule — so blocked joins
 * failed rather than inventing a fourth hue. The distinction survives in the
 * LABEL, which is what carries meaning here.
 */
const STATUS_COLOR = {
  completed: 'accent',
  failed: 'danger',
  blocked: 'danger',
  'needs-confirmation': 'zinc',
  running: 'zinc',
} as const satisfies Record<AgentRunStatus, 'accent' | 'danger' | 'zinc'>

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  'needs-confirmation': 'Needs confirmation',
  running: 'Running',
}

export function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  return (
    <Badge color={STATUS_COLOR[status]} className="rounded-full whitespace-nowrap">
      {STATUS_LABEL[status]}
    </Badge>
  )
}
