/**
 * Présentation pure de l'Aperçu — zéro I/O, zéro composant React.
 */
import type { ActionItem, ActionItemKind, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { QUEUE_KIND_LABEL } from '@/lib/agent-mission-control/operator-queue'
import type { SeverityTone } from '@/components/surface-primitives'

const ACTION_ITEM_TONE: Record<ActionItemKind, SeverityTone> = {
  architect_approval: 'warn',
  ready_manual: 'warn',
  sandbox_failed: 'bad',
  release_gate_red: 'bad',
  pr_open: 'neutral',
  mission_blocked: 'bad',
  data_unavailable: 'neutral',
}

export function sortOverviewProjects(
  projects: readonly ProjectOverviewItem[],
): ProjectOverviewItem[] {
  return [...projects].toSorted((a, b) => {
    const aScore = a.copilotCount > 0 ? 1 : 0
    const bScore = b.copilotCount > 0 ? 1 : 0
    if (aScore !== bScore) return bScore - aScore
    return a.name.localeCompare(b.name, 'fr')
  })
}

export function actionItemChip(item: Pick<ActionItem, 'kind'>): {
  tone: SeverityTone
  label: string
} {
  return {
    tone: ACTION_ITEM_TONE[item.kind],
    label: QUEUE_KIND_LABEL[item.kind],
  }
}

export type WindowReadState = 'unread' | 'empty' | 'active'

export function windowReadState(unread: boolean, runs24h: number | null): WindowReadState {
  if (unread) return 'unread'
  if (runs24h === 0) return 'empty'
  return 'active'
}
