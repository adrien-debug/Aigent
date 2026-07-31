/**
 * Le banc de qualification — quels candidats attendent quoi.
 *
 * Server Component : il reçoit une liste déjà lue et la distribue. Il ne
 * recalcule aucun statut — `AvailableAgent.status` / `.executable` sont la même
 * dérivation que la garde d'exécution, et la refaire ici produit exactement le
 * bug historique d'un écran qui promet un lancement que l'API refuse.
 *
 * TROIS ABSENCES DISTINCTES, JAMAIS CONFONDUES :
 *  · la lecture du catalogue a échoué   → « indisponible », traité par la page ;
 *  · le catalogue est vide              → « aucun agent », un vide PROUVÉ ;
 *  · un agent n'a aucune qualification  → « pas encore lancée », pas un échec.
 */
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Rail, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import type { QualificationRunStatus } from '@/lib/agent-mission-control/qualification-orchestrator'
import { RunStatusBadge } from './atoms'
import { candidateRank } from './model'

/**
 * Une ligne du banc — le strict nécessaire pour décider où aller.
 *
 * Chaque champ nullable l'est parce que la donnée peut réellement manquer : une
 * version candidate non résolue, une qualification jamais lancée. Aucun de ces
 * `null` ne devient un zéro ni un « OK » en descendant vers le pixel.
 */
export interface QualificationCandidate {
  copilotId: string
  name: string
  /** La version candidate résolue, ou `null` si aucune ne résout. */
  candidateVersionId: string | null
  candidateLabel: string | null
  candidateStage: string | null
  /** L'état de la dernière qualification. `not_started` est un fait, pas un trou. */
  state: QualificationRunStatus | 'not_started'
  /** La lecture du registre de qualification a-t-elle abouti pour cette ligne ? */
  qualificationRead: boolean
  /** Le copilot a-t-il déjà une version de production ? (baseline du replay) */
  hasProductionBaseline: boolean
  /** Une boucle d'amélioration est-elle ouverte ? */
  hasOpenProposal: boolean
  /** Nombre de conditions de la garde d'exécution non satisfaites (0..3). */
  runBlockerCount: number
}

const MUTED_RAIL = 'rgb(161 161 170 / 0.35)'

const RAIL_COLOR: Record<QualificationRunStatus | 'not_started', string> = {
  promotable: '#0da87f',
  blocked: '#e8455f',
  running: '#3b82f6',
  superseded: '#be850f',
  aborted: '#be850f',
  not_started: MUTED_RAIL,
}

function CandidateRow({ candidate }: { candidate: QualificationCandidate }) {
  return (
    <li className="relative border-b border-zinc-950/5 last:border-b-0 dark:border-white/5">
      <Rail color={RAIL_COLOR[candidate.state]} />
      <Link
        href={`/qualification/${candidate.copilotId}`}
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:bg-zinc-950/[0.025] dark:hover:bg-white/[0.025]"
      >
        <Avatar square initials={initialsOf(candidate.name)} className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{candidate.name}</Strong>
            {/* Une lecture qui a échoué ne se rend PAS comme « pas encore
                lancée » : les deux se ressembleraient à l'écran et disent
                l'inverse l'une de l'autre. */}
            {!candidate.qualificationRead ? (
              <Badge
                color="zinc"
                title="Le registre de qualification n’a pas pu être lu pour cet agent. Ce n’est pas « aucune qualification » — c’est une absence de lecture."
              >
                registre non lu
              </Badge>
            ) : candidate.state === 'not_started' ? (
              <Badge
                color="zinc"
                title="La lecture a réussi et il n’existe aucune qualification pour la version candidate. Un vide prouvé, pas une panne."
              >
                pas encore lancée
              </Badge>
            ) : (
              <RunStatusBadge status={candidate.state} />
            )}
            {candidate.hasOpenProposal ? (
              <Badge
                color="amber"
                title="Une boucle d’amélioration attend une décision humaine. Une seule boucle ouverte est tolérée par copilot."
              >
                décision attendue
              </Badge>
            ) : null}
          </div>
          <Text className="truncate">
            {candidate.candidateLabel ?? 'version candidate non résolue'}
            {candidate.candidateStage ? ` · ${candidate.candidateStage}` : ''}
            {' · '}
            {candidate.hasProductionBaseline
              ? 'baseline de production présente'
              : 'aucune baseline de production'}
          </Text>
        </div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          {candidate.runBlockerCount > 0 ? (
            <Badge
              color="red"
              title="Conditions de la garde d’exécution non satisfaites : statut « active », aucun outil non résolu, runtime « langgraph ». Les trois doivent tenir."
            >
              {candidate.runBlockerCount}/3 condition(s) manquante(s)
            </Badge>
          ) : (
            <Badge
              color="emerald"
              title="Les trois conditions de la garde d’exécution tiennent : la route accepterait un lancement."
            >
              garde satisfaite
            </Badge>
          )}
        </div>
      </Link>
    </li>
  )
}

export default function QualificationRosterScreen({
  candidates,
  qualificationReadFailures,
}: {
  candidates: QualificationCandidate[]
  /** Combien d'agents dont le registre de qualification n'a pas pu être lu. */
  qualificationReadFailures: number
}) {
  const ranked = [...candidates].sort(
    (a, b) => candidateRank(a.state) - candidateRank(b.state) || a.name.localeCompare(b.name, 'fr'),
  )
  const promotable = ranked.filter((c) => c.state === 'promotable').length
  const blocked = ranked.filter((c) => c.state === 'blocked').length
  const awaitingDecision = ranked.filter((c) => c.hasOpenProposal).length
  const withoutBaseline = ranked.filter((c) => !c.hasProductionBaseline).length

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 xl:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge color="zinc">{ranked.length} candidat(s)</Badge>
        <Badge
          color="emerald"
          title="Tous les checks de la gate passent. « Promouvable » est un état — aucune promotion ne part toute seule."
        >
          {promotable} promouvable(s)
        </Badge>
        <Badge color="red">{blocked} bloquée(s)</Badge>
        <Badge color="amber" title="Boucles d’amélioration qui attendent une décision humaine.">
          {awaitingDecision} décision(s) attendue(s)
        </Badge>
        <Badge
          color="zinc"
          title="Sans version de production, le replay n’a rien à comparer : la route refuse de partir. C’est une dépendance circulaire, pas une panne."
        >
          {withoutBaseline} sans baseline de replay
        </Badge>
        {qualificationReadFailures > 0 ? (
          <Badge
            color="zinc"
            title="Le registre de qualification n’a pas pu être lu pour ces agents. Leur état est INCONNU, pas « pas encore lancé »."
          >
            {qualificationReadFailures} registre(s) non lu(s)
          </Badge>
        ) : null}
      </div>

      <Panel
        title="Banc de qualification"
        hint={`${ranked.length} au catalogue`}
        className="min-h-[20rem] min-w-0 xl:min-h-0 xl:flex-1"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        {ranked.length === 0 ? (
          <Unavailable
            reason="no-data"
            detail="Aucun agent n’est persisté dans le catalogue : il n’y a rien à qualifier. La lecture a réussi — ce n’est pas une panne."
          />
        ) : (
          <ul>
            {ranked.map((candidate) => (
              <CandidateRow key={candidate.copilotId} candidate={candidate} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
