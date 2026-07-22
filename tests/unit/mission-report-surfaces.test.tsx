import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MissionReportPanel } from '@/components/agent-ops/project-mission-orchestrator'
import type { MissionReport } from '@/lib/agent-mission-control/mission-orchestrator'

/**
 * AIGENT-SURFACE-CLEANUP-024 — the mission report renders as ONE surface.
 *
 * The panel lives inside an already-raised AgentSectionCard, so every inner
 * card was a third plane. Worse, two of them were LIGHT surfaces
 * (`bg-zinc-50`, `bg-zinc-50/50`) with no dark variant, rendered on a dark
 * screen, plus light body text (`text-zinc-800/700/600`).
 *
 * These assertions pin the flattening. They render the real component rather
 * than grepping source, so a class reintroduced through a helper is still
 * caught.
 */

const REPORT: MissionReport = {
  runId: 'mission_test_0001',
  status: 'completed',
  participants: [
    { role: 'repo-intelligence', copilotName: 'Repo Intelligence', status: 'ok' },
    { role: 'scorecard', copilotName: null, status: 'missing' },
  ],
  consensus: {
    decision: 'continue',
    summary: 'Evidence consolidated across three sources.',
    blockers: [{ id: 'b1', severity: 'critical', role: 'security', title: 'Unresolved tool handler' }],
    warnings: [{ id: 'w1', severity: 'warning', role: 'scorecard', title: 'No benchmark baseline' }],
    nextActions: ['Run a benchmark suite', 'Re-check the tool registry'],
  },
  findings: [
    { id: 'f1', severity: 'critical', role: 'security', title: 'Unresolved tool handler' },
    { id: 'f2', severity: 'warning', role: 'scorecard', title: 'No benchmark baseline' },
  ],
} as unknown as MissionReport

/** One entry per rendered element, so pairing can be judged per element. */
function classesOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('*')).map(
    (el) => el.getAttribute('class') ?? ''
  )
}

/**
 * True when an element carries `token` with NO `dark:` counterpart on the same
 * element. Catalyst Badge ships `text-zinc-600 … dark:text-zinc-400` on one
 * element — a correct light/dark pair, and not this panel's concern. Only a
 * bare light token, which renders white-on-dark, is a defect.
 */
function hasUnpaired(classLists: string[], token: string): boolean {
  const bare = new RegExp(`(^|\\s)${token.replace(/[/\\-]/g, '\\$&')}(\\s|$)`)
  return classLists.some((cls) => bare.test(cls) && !cls.includes('dark:'))
}

describe('mission report — surface hierarchy', () => {
  it('renders no light-mode surface without a dark variant', () => {
    const { container } = render(<MissionReportPanel report={REPORT} />)
    const classes = classesOf(container)
    // A bare `bg-zinc-50`/`bg-zinc-100` is a white panel on a dark screen.
    for (const light of ['bg-zinc-50', 'bg-zinc-100', 'bg-zinc-50/50', 'bg-zinc-100/50']) {
      expect(hasUnpaired(classes, light), `${light} is a light panel on a dark screen`).toBe(false)
    }
  })

  it('uses no dark-illegible body text', () => {
    const { container } = render(<MissionReportPanel report={REPORT} />)
    const classes = classesOf(container)
    for (const dark of ['text-zinc-800', 'text-zinc-700', 'text-zinc-600']) {
      expect(hasUnpaired(classes, dark), `${dark} is unreadable on the dark canvas`).toBe(false)
    }
  })

  it('wraps neither blockers, warnings nor findings in a nested card', () => {
    const { container } = render(<MissionReportPanel report={REPORT} />)
    const classes = classesOf(container)
    // No rounded+ring panel inside a section that is already raised.
    expect(hasUnpaired(classes, 'rounded-xl')).toBe(false)
    expect(hasUnpaired(classes, 'ring-zinc-950/5')).toBe(false)
  })

  it('does not create a nested scroll region', () => {
    // The page scrolls; a panel inside a panel must not.
    const { container } = render(<MissionReportPanel report={REPORT} />)
    expect(classesOf(container).join(' ').includes('overflow-y-auto')).toBe(false)
  })

  it('still renders the report content it is responsible for', () => {
    // Flattening must not silently drop a section.
    const { getByText } = render(<MissionReportPanel report={REPORT} />)
    expect(getByText(/Blockers \(1\)/)).toBeTruthy()
    expect(getByText(/Warnings \(1\)/)).toBeTruthy()
    expect(getByText('Next actions')).toBeTruthy()
    expect(getByText('Unresolved tool handler', { selector: 'li' })).toBeTruthy()
  })
})
