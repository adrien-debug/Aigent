/**
 * Lignes de roster — agents et projets.
 *
 * Même grammaire que le flux d'exécution, portée par la primitive commune
 * `EntityRow` (`primitives.tsx`) : un rail de statut sur l'arête gauche,
 * l'identité au centre, les mesures alignées à droite en chiffres
 * monospacés. Une entité tient sur une ligne dense.
 *
 * Un statut d'agent n'est dit QU'UNE fois à côté du nom : un `Badge` Catalyst
 * qui porte à la fois la couleur et le mot. Le rail de la ligne garde la
 * sévérité (échec/actif/inerte) ; l'avatar, lui, reste neutre — plus de diode
 * ni de troisième teinte pour répéter la même information.
 *
 * Les faits affichés sont exactement les mêmes qu'avant, et une mesure
 * absente l'est toujours explicitement.
 */
import type { ComponentProps } from 'react'

import { Badge } from '@/components/ui/badge'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentCard, ProjectCard } from '@/lib/cockpit/named-runs'
import { timeAgo } from '@/lib/cockpit/named-runs'
import { COPILOT_STATUS_LABEL } from '@/lib/cockpit/status'
import { AbsentMark, EntityAvatar, EntityRow, MetricDot, MetricValue, initialsOf } from './primitives'

const MUTED_RAIL = '#2e343c'

/** Le statut d'un copilot, dit une seule fois — couleur et mot dans le badge. */
const STATUS_BADGE: Record<string, ComponentProps<typeof Badge>['color']> = {
  active: 'success',
  paused: 'warning',
  draft: 'neutral',
  degraded: 'danger',
  archived: 'neutral',
}

/** Un agent qui a réellement tourné sur la fenêtre. */
export function AgentRow({ card, nowMs }: { card: AgentCard; nowMs: number }) {
  const statusLabel = COPILOT_STATUS_LABEL[card.status] ?? COPILOT_STATUS_LABEL.draft
  const statusBadge = STATUS_BADGE[card.status] ?? 'neutral'
  const failing = card.failures24h > 0
  const active = card.status === 'active'
  const railColor = failing ? '#e8455f' : active ? '#0da87f' : MUTED_RAIL

  return (
    <EntityRow
      railColor={railColor}
      avatar={<EntityAvatar initials={initialsOf(card.name)} />}
      title={card.name ?? <span className="text-ink-faint">Agent non résolu</span>}
      /* Un seul signal de statut à côté du nom : le badge porte la couleur ET
         le mot. Le rail de la ligne dit déjà la sévérité — inutile d'y ajouter
         une diode et un troisième libellé. */
      titleMeta={
        <Badge dense color={statusBadge}>
          {statusLabel}
        </Badge>
      }
      subtitle={card.projectName ?? 'Sans projet'}
      metrics={
        <>
          <span className="flex items-baseline gap-1">
            <MetricValue value={card.runs24h} unit="runs" />
            {failing ? (
              <Badge dense color="danger">
                {card.failures24h} KO
              </Badge>
            ) : null}
          </span>
          <span className="flex items-baseline gap-1.5">
            {card.costUsd === null ? <AbsentMark /> : <MetricValue value={formatUsd(card.costUsd)} size="sm" />}
            <MetricDot />
            <span className="font-mono text-[10px] whitespace-nowrap text-ink-faint">
              {card.lastRunMs === null ? '—' : timeAgo(card.lastRunMs, nowMs).replace('il y a ', '')}
            </span>
          </span>
        </>
      }
    />
  )
}

/** Un projet du catalogue — actif ou non, il est dit tel qu'il est. */
export function ProjectRow({ card }: { card: ProjectCard }) {
  const live = card.activeCount > 0
  const railColor = live ? 'var(--accent-main)' : MUTED_RAIL

  return (
    <EntityRow
      railColor={railColor}
      /* Le badge `n/total` est un COMPTE, pas un statut : la teinte de l'avatar
         reste ici le seul signal d'activité, elle n'est donc pas redondante. */
      avatar={<EntityAvatar initials={initialsOf(card.name)} active={live} />}
      title={card.name}
      titleMeta={
        <Badge dense color="neutral">
          {card.activeCount}/{card.copilotCount}
        </Badge>
      }
      subtitle={card.repoFullName ?? 'aucun repo lié'}
      metrics={
        <>
          <MetricValue value={card.runs24h} unit="runs" />
          <span className="flex items-baseline gap-1.5">
            {card.costLast24hUsd === null ? (
              <AbsentMark />
            ) : (
              <MetricValue value={formatUsd(card.costLast24hUsd)} size="sm" />
            )}
            <MetricDot />
            <span className="font-mono text-[10px] tabular-nums text-ink-faint">
              {card.passRate === null ? '—' : `${Math.round(card.passRate * 100)} %`}
            </span>
          </span>
        </>
      }
    />
  )
}
