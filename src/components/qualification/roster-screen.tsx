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
import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { navEntry } from '@/components/navigation'
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
  /** La lecture du catalogue canonique a-t-elle abouti ? */
  agentRead: boolean
  /**
   * Nombre de conditions de la garde d'exécution non satisfaites (0..3).
   *
   * `null` ⇒ aucun contrat canonique ne résout pour cette ligne (catalogue non
   * lu, ou copilot absent du catalogue). Ce n'est PAS « 3 conditions
   * manquantes » : une lecture qui n'a pas eu lieu n'accuse personne.
   */
  runBlockerCount: number | null
}

const RAIL_COLOR: Record<QualificationRunStatus | 'not_started', string> = {
  promotable: SEVERITY.good,
  blocked: SEVERITY.bad,
  running: SEVERITY.running,
  superseded: SEVERITY.warn,
  aborted: SEVERITY.warn,
  not_started: SEVERITY.muted,
}

type CandidateRowProps = { candidate: QualificationCandidate }

type QualificationRosterScreenProps = {
  candidates: QualificationCandidate[]
  qualificationReadFailures: number
}

type QualificationStateBadgeProps = { candidate: QualificationCandidate }
type RunGuardBadgeProps = { candidate: QualificationCandidate }

function QualificationStateBadge({ candidate }: Readonly<QualificationStateBadgeProps>) {
  if (!candidate.qualificationRead) {
    return (
      <Badge
        color="zinc"
        title="Le registre de qualification n’a pas pu être lu pour cet agent. Ce n’est pas « aucune qualification » — c’est une absence de lecture."
      >
        registre non lu
      </Badge>
    )
  }
  if (candidate.state === 'not_started') {
    return (
      <Badge
        color="zinc"
        title="La lecture a réussi et il n’existe aucune qualification pour la version candidate. Un vide prouvé, pas une panne."
      >
        pas encore lancée
      </Badge>
    )
  }
  return <RunStatusBadge status={candidate.state} />
}

function RunGuardBadge({ candidate }: Readonly<RunGuardBadgeProps>) {
  if (candidate.runBlockerCount === null) {
    const title = candidate.agentRead
      ? 'Le catalogue a été lu et ne rend aucune ligne canonique pour cet agent : les trois conditions de la garde d’exécution sont INCONNUES, pas fausses.'
      : 'Le catalogue canonique n’a pas pu être lu. L’état de la garde d’exécution est INCONNU — ce n’est pas « la garde refuserait ».'
    const label = candidate.agentRead ? 'garde non dérivable' : 'catalogue non lu'
    return (
      <Badge color="zinc" title={title}>
        {label}
      </Badge>
    )
  }
  if (candidate.runBlockerCount > 0) {
    return (
      <Badge
        color="red"
        title="Conditions de la garde d’exécution non satisfaites : statut « active », aucun outil non résolu, runtime « langgraph ». Les trois doivent tenir."
      >
        {candidate.runBlockerCount}/3 condition(s) manquante(s)
      </Badge>
    )
  }
  return (
    <Badge
      color="emerald"
      title="Les trois conditions de la garde d’exécution tiennent : la route accepterait un lancement."
    >
      garde satisfaite
    </Badge>
  )
}

/**
 * Un chiffre de l'état des candidats.
 *
 * Comme sur le roster des agents, ce sont des COMPTAGES dérivés de la liste
 * rendue en dessous — jamais une mesure lue en base. Un `0` y est donc un vrai
 * zéro. Les inconnues (garde non dérivable, registre non lu) sont comptées à
 * PART et rendues en ligne neutre : les agréger aux blocages produirait
 * exactement le verdict accusateur que le badge neutre évite ligne à ligne.
 */
function CandidateFigure({
  value,
  label,
  hint,
  tone = 'default',
}: Readonly<{
  value: number
  label: string
  hint?: string
  tone?: 'default' | 'good' | 'warn' | 'bad'
}>) {
  const toneColor = tone === 'bad' ? SEVERITY.bad : tone === 'warn' ? SEVERITY.warn : tone === 'good' ? SEVERITY.good : null

  return (
    <div className="min-w-0">
      <div className="aig-display text-3xl font-semibold tabular-nums sm:text-4xl" style={toneColor ? { color: toneColor } : undefined}>
        {value}
      </div>
      <Text className="aig-text-muted mt-1 truncate text-sm">{label}</Text>
      {hint ? <Text className="aig-text-faint mt-0.5 truncate text-xs">{hint}</Text> : null}
    </div>
  )
}

function CandidateRow({ candidate }: Readonly<CandidateRowProps>) {
  return (
    <li className="relative">
      <Rail color={RAIL_COLOR[candidate.state]} />
      <Link
        href={'/qualification/' + candidate.copilotId}
        // Le survol monte la ligne d'un palier de clarté au lieu de poser un
        // voile blanc dosé à la main : `aig-raised` est le rôle « ce qui prend
        // l'attention », et il est le même sur tous les bancs du produit.
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:aig-raised"
      >
        <Avatar square initials={initialsOf(candidate.name)} className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{candidate.name}</Strong>
            {/* Une lecture qui a échoué ne se rend PAS comme « pas encore
                lancée » : les deux se ressembleraient à l'écran et disent
                l'inverse l'une de l'autre. */}
            <QualificationStateBadge candidate={candidate} />
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

        {/* Trois rendus pour trois affirmations différentes. Le badge NEUTRE
            n'est pas une politesse : sans lui, une panne de lecture du
            catalogue peignait tout le banc en « 3/3 condition(s) manquante(s) »
            — un verdict accusateur produit par une absence de mesure. */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <RunGuardBadge candidate={candidate} />
        </div>
      </Link>
    </li>
  )
}

export default function QualificationRosterScreen({
  candidates,
  qualificationReadFailures,
}: Readonly<QualificationRosterScreenProps>) {
  const ranked = [...candidates].sort(
    (a, b) => candidateRank(a.state) - candidateRank(b.state) || a.name.localeCompare(b.name, 'fr'),
  )
  const promotable = ranked.filter((c) => c.state === 'promotable').length
  const blocked = ranked.filter((c) => c.state === 'blocked').length
  const awaitingDecision = ranked.filter((c) => c.hasOpenProposal).length
  const withoutBaseline = ranked.filter((c) => !c.hasProductionBaseline).length
  // Compté séparément des blocages réels : agréger les deux redonnerait
  // exactement le chiffre accusateur que le badge neutre vient d'éviter.
  const guardUnknown = ranked.filter((c) => c.runBlockerCount === null).length

  return (
    <>
      <PageHeader
        title={navEntry('/qualification').name}
        description={navEntry('/qualification').purpose}
      />
      <PageBody className="gap-5">
        {/* ÉTAT DES CANDIDATS — la zone dominante. Ces chiffres vivaient en
            badges de 11 px dans le `meta` de l'en-tête : l'information
            principale de la surface rendue à la taille d'une étiquette. Ils
            gardent chacun leur `title` explicatif, mot pour mot. */}
        <section
          className="aig-stage aig-accent-edge shrink-0 p-5 sm:p-6"
          aria-label="État des candidats"
        >
          <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
            État des candidats
          </Text>

          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <CandidateFigure value={ranked.length} label="Candidat(s)" />
            <div title="Tous les checks de la gate passent. « Promouvable » est un état — aucune promotion ne part toute seule.">
              <CandidateFigure
                value={promotable}
                label="Promouvable(s)"
                tone={promotable > 0 ? 'good' : 'default'}
                hint="aucune promotion ne part seule"
              />
            </div>
            <CandidateFigure
              value={blocked}
              label="Bloquée(s)"
              tone={blocked > 0 ? 'bad' : 'default'}
            />
            <div title="Boucles d’amélioration qui attendent une décision humaine.">
              <CandidateFigure
                value={awaitingDecision}
                label="Décision(s) attendue(s)"
                tone={awaitingDecision > 0 ? 'warn' : 'default'}
              />
            </div>
          </div>

          <div className="aig-hairline my-5" />

          {/* Les inconnues, en ligne et en NEUTRE. Elles ne montent pas au rang
              de grand chiffre : ce sont des absences de mesure, pas des
              verdicts, et les grossir les ferait lire comme des blocages. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Badge
              color="zinc"
              title="Sans version de production, le replay n’a rien à comparer : la route refuse de partir. C’est une dépendance circulaire, pas une panne."
            >
              {withoutBaseline} sans baseline de replay
            </Badge>
            {guardUnknown > 0 ? (
              <Badge
                color="zinc"
                title="Aucun contrat canonique ne résout pour ces agents — catalogue non lu, ou agent absent du catalogue. L’état de leur garde d’exécution est INCONNU, jamais « non lançable »."
              >
                {guardUnknown} garde(s) non dérivable(s)
              </Badge>
            ) : null}
            {qualificationReadFailures > 0 ? (
              <Badge
                color="zinc"
                title="Le registre de qualification n’a pas pu être lu pour ces agents. Leur état est INCONNU, pas « pas encore lancé »."
              >
                {qualificationReadFailures} registre(s) non lu(s)
              </Badge>
            ) : null}
          </div>
        </section>

        {/* Le banc descend dans un CREUX : il accueille la liste au lieu de la
            poser sur une énième carte de rang égal à la scène. La box reste
            bornée, la donnée défile dedans. */}
        <section className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
            <Subheading level={2}>Banc de qualification</Subheading>
            <Text className="aig-text-muted text-sm">{ranked.length} au catalogue</Text>
          </div>

          <div className="aig-inset min-w-0">
            {ranked.length === 0 ? (
              <div className="p-4">
                <Unavailable
                  reason="no-data"
                  detail="Aucun agent n’est persisté dans le catalogue : il n’y a rien à qualifier. La lecture a réussi — ce n’est pas une panne."
                />
              </div>
            ) : (
              <ul className="divide-y divide-[color:var(--aig-line-soft)]">
                {ranked.map((candidate) => (
                  <CandidateRow key={candidate.copilotId} candidate={candidate} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </PageBody>
    </>
  )
}
