/**
 * Lignes de roster — agents et projets — en composants Catalyst officiels.
 *
 * `Avatar` porte l'identité, `Badge` le statut, `Strong`/`Text` la typographie.
 * Il n'y a plus de `EntityRow` ni de `EntityAvatar` maison : c'étaient des
 * doublons de Catalyst. Ce qui reste hors kit sur ces lignes est le seul `Rail`
 * (sévérité), que le kit ne fournit pas.
 *
 * Un statut n'est dit qu'UNE fois : par le `Badge`, qui porte la couleur ET le
 * mot. Pas de diode, pas d'avatar teinté en plus pour répéter la même chose.
 *
 * Les faits affichés sont exactement les mêmes qu'avant, et une mesure absente
 * l'est toujours explicitement.
 */
import type { ComponentProps } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentCard, ProjectCard } from '@/lib/cockpit/named-runs'
import { timeAgo } from '@/lib/cockpit/named-runs'
import { COPILOT_STATUS_LABEL } from '@/lib/cockpit/status'
import { AbsentMark, Rail, initialsOf } from './primitives'

type BadgeColor = ComponentProps<typeof Badge>['color']

const MUTED_RAIL = 'rgb(161 161 170 / 0.35)'

/** Le statut d'un copilot, dit une seule fois — couleur et mot dans le badge. */
const STATUS_BADGE: Record<string, BadgeColor> = {
  active: 'emerald',
  paused: 'amber',
  draft: 'zinc',
  degraded: 'red',
  archived: 'zinc',
}

/** Coquille commune aux deux rosters : rail de sévérité + contenu en Catalyst. */
function RosterRow({
  railColor,
  children,
}: {
  railColor: string
  children: React.ReactNode
}) {
  return (
    <li className="relative border-b border-zinc-950/5 last:border-b-0 dark:border-white/5">
      <Rail color={railColor} />
      <div className="flex items-center gap-3 py-2.5 pr-4 pl-4">{children}</div>
    </li>
  )
}

/** Un agent qui a réellement tourné sur la fenêtre. */
export function AgentRow({ card, nowMs }: { card: AgentCard; nowMs: number }) {
  const statusLabel = COPILOT_STATUS_LABEL[card.status] ?? COPILOT_STATUS_LABEL.draft
  const statusBadge = STATUS_BADGE[card.status] ?? 'zinc'
  const failing = card.failures24h > 0
  const railColor = failing ? '#e8455f' : card.status === 'active' ? '#0da87f' : MUTED_RAIL

  return (
    <RosterRow railColor={railColor}>
      <Avatar square initials={initialsOf(card.name)} className="size-8 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {card.name ? (
            <Strong className="truncate">{card.name}</Strong>
          ) : (
            <Text className="truncate">Agent non résolu</Text>
          )}
          <Badge color={statusBadge}>{statusLabel}</Badge>
          {failing ? <Badge color="red">{card.failures24h} KO</Badge> : null}
        </div>
        <Text className="truncate">{card.projectName ?? 'Sans projet'}</Text>
      </div>

      <div className="shrink-0 text-right">
        <Text>
          <Strong className="tabular-nums">{card.runs24h}</Strong> runs
        </Text>
        <Text className="tabular-nums">
          {card.costUsd === null ? <AbsentMark /> : formatUsd(card.costUsd)}
          {' · '}
          {card.lastRunMs === null ? '—' : timeAgo(card.lastRunMs, nowMs).replace('il y a ', '')}
        </Text>
      </div>
    </RosterRow>
  )
}

/** Un projet du catalogue — actif ou non, il est dit tel qu'il est. */
export function ProjectRow({ card }: { card: ProjectCard }) {
  const live = card.activeCount > 0

  return (
    <RosterRow railColor={live ? '#0da87f' : MUTED_RAIL}>
      <Avatar square initials={initialsOf(card.name)} className="size-8 shrink-0" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Strong className="truncate">{card.name}</Strong>
          <Badge color={live ? 'emerald' : 'zinc'}>
            {card.activeCount}/{card.copilotCount}
          </Badge>
        </div>
        <Text className="truncate">{card.repoFullName ?? 'aucun repo lié'}</Text>
      </div>

      <div className="shrink-0 text-right">
        {/* Un projet SANS copilot n'a pas 0 run pour $0.00 : il n'a rien à
         * mesurer. `sumMeasuredHealth` rend `{ value: 0 }` sur une équipe vide
         * (sa garde est `team.length > 0 && measured === 0`), et ce zéro est
         * défendable au contrat — mais à l'écran « 0 runs · $0.00 » se lit
         * « mesuré, calme » alors que le fait est « personne ». Troisième état,
         * comme le fait déjà la surface /projects. */}
        {card.copilotCount === 0 ? (
          <Text>rien à mesurer</Text>
        ) : (
          <>
            <Text>
              {card.runs24h === null ? (
                <AbsentMark />
              ) : (
                <>
                  <Strong className="tabular-nums">{card.runs24h}</Strong> runs
                </>
              )}
            </Text>
            <Text className="tabular-nums">
              {card.costLast24hUsd === null ? <AbsentMark /> : formatUsd(card.costLast24hUsd)}
              {' · '}
              {card.passRate === null ? '—' : `${Math.round(card.passRate * 100)} %`}
            </Text>
          </>
        )}
      </div>
    </RosterRow>
  )
}
