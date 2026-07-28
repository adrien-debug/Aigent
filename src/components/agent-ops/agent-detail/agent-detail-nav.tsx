'use client'

import { Tabs } from '@/components/ui/tabs'

/**
 * The canonical agent sections (AIGENT-AGENT-PAGES-021). Composes the
 * canonical `Tabs` primitive (same grammar as `ProjectTabs`), with
 * `scrollAffordance` on: eight sections overflow a 390px viewport (measured:
 * 551px of links in a 343px track), so the two scroll edges fade in/out as
 * they become reachable/hidden.
 *
 * Replaces the legacy Overview/Manifest/Quality/Runs/Improve/Release row, which
 * was organised around the engineering lifecycle rather than around operating
 * an agent. Manifest split into Configuration + Instructions; Quality and Tests
 * collapsed into Observability.
 *
 * Evolution and Release came back (AIGENT-OPERATOR-RESTORE-028) because folding
 * them into Observability made an operator surface read like a monitoring one:
 * Observability answers "what did this agent do", Evolution "how do I make it
 * better", Release "may this version ship". Those are three decisions, not one
 * dashboard.
 */
const SECTIONS = [
  { label: 'Overview', segment: '' },
  { label: 'Runs', segment: 'runs' },
  { label: 'Tools', segment: 'tools' },
  { label: 'Configuration', segment: 'configuration' },
  { label: 'Instructions', segment: 'instructions' },
  { label: 'Observability', segment: 'observability' },
  { label: 'Evolution', segment: 'evolution' },
  { label: 'Release', segment: 'release' },
] as const

export function AgentDetailNav({ copilotId }: { copilotId: string }) {
  return (
    <Tabs
      items={SECTIONS}
      base={`/admin/agents/${copilotId}`}
      ariaLabel="Agent sections"
      scrollAffordance
    />
  )
}
