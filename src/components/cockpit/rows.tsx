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
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { ProjectCard } from '@/lib/cockpit/named-runs'
import { AbsentMark, Rail, SEVERITY, initialsOf } from './primitives'

/** Coquille du roster : rail de sévérité + contenu en Catalyst. */
function RosterRow({
  railColor,
  children,
}: Readonly<{
  railColor: string
  children: React.ReactNode
}>) {
  return (
    <li className="relative">
      <Rail color={railColor} />
      <div className="flex items-center gap-3 py-2.5 pr-4 pl-4">{children}</div>
    </li>
  )
}

/** Un agent qui a réellement tourné sur la fenêtre. */
/** Un projet du catalogue — actif ou non, il est dit tel qu'il est. */
export function ProjectRow({ card }: Readonly<{ card: ProjectCard }>) {
  const live = card.activeCount > 0

  return (
    <RosterRow railColor={live ? SEVERITY.good : SEVERITY.muted}>
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
