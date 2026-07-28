'use client'

import { Tabs } from '@/components/ui/tabs'

/**
 * Project sub-nav — composes the canonical `Tabs` primitive (same grammar as
 * `AgentDetailNav`): hairline underline on the nav, accent underline +
 * `aria-current` on the active tab, horizontal scroll INSIDE the bounded
 * track (never the page body).
 *
 * Only routes that ACTUALLY EXIST are listed — a tab pointing at a missing
 * segment is a 404 generator, not a roadmap. Today the project surface has
 * exactly three: the overview (`page.tsx`), the Agent Builder (`builder/`) and
 * My Team (`team/`). "My Team" sits next to Agent Builder because both are
 * agent-facing surfaces: you assemble agents in the builder, you read the
 * assembled team in the graph. Three tabs never overflow a phone viewport,
 * so `scrollAffordance` stays off.
 */
const TABS = [
  { label: 'Overview', segment: '' },
  { label: 'Agent Builder', segment: 'builder' },
  { label: 'My Team', segment: 'team' },
] as const

export function ProjectTabs({ projectId }: { projectId: string }) {
  return <Tabs items={TABS} base={`/admin/projects/${projectId}`} ariaLabel="Project sections" />
}
