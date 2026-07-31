/**
 * La FICHE de livraison d'un agent — écran à hauteur bornée, chaque panneau
 * défile DANS sa box.
 *
 * Server Component : il reçoit des lectures déjà faites et les rend. Le seul
 * composant client de l'écran est `DeliveryConsole`, et c'est le seul qui mute.
 *
 * L'ORGANISATION DE L'ÉCRAN EST L'ARGUMENT
 * ----------------------------------------
 * Le panneau des HUIT ÉTATS vient en premier, avant la scorecard et avant la
 * sandbox. Ce n'est pas un choix esthétique : la question qu'un opérateur pose
 * devant cet écran est « où en est cette livraison, exactement ? », et la seule
 * réponse honnête est une liste de huit affirmations distinctes dont trois sont
 * des non-savoirs. Mettre un score en tête laisserait croire que la livraison se
 * résume à un chiffre — et le chiffre, lui, ne dit rien sur le merge ni sur
 * l'activation.
 *
 * Chaque panneau distingue systématiquement TROIS situations : lecture échouée
 * (on ne sait pas), lecture réussie et vide (on sait qu'il n'y a rien), donnée
 * présente. Les deux premières ne se rendent jamais pareil.
 */
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Unavailable } from '@/components/cockpit/primitives'
import type { AgentDeliveryScorecard } from '@/lib/agent-mission-control/delivery-scorecard'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'

import DeliveryConsole from './console'
import {
  DeliveryStateRow,
  DimensionBadge,
  Fact,
  FactValue,
  Note,
  NotMeasured,
  SandboxCheckBadge,
  SandboxStatusBadge,
  isoShort,
} from './atoms'
import {
  SCORECARD_LEVEL_LABEL,
  SCORECARD_LEVEL_MEANING,
  countSandboxChecks,
  deliveryModeLabel,
  deriveDeliveryStates,
  sandboxModeMeaning,
  scorecardMeasuredRatio,
  scorecardScoreIsMeaningful,
} from './model'
import type { DeliveryDetailRead } from './server-reads'

type DeliveryEventPanelProps = { detail: DeliveryDetailRead }
type DeliveryStatesPanelProps = { detail: DeliveryDetailRead }
type ScorecardPanelProps = {
  card: AgentDeliveryScorecard | null
  failure: string | null
}
type ScorecardBodyProps = { card: AgentDeliveryScorecard }
type SandboxPanelProps = {
  report: TargetRepoSandboxReport | null
  failure: string | null
}
type SandboxBodyProps = { report: TargetRepoSandboxReport }
type ConsumerPanelProps = { detail: DeliveryDetailRead }
type DeliveryDetailScreenProps = { detail: DeliveryDetailRead }

function scorecardPanelHint(card: AgentDeliveryScorecard | null): string | undefined {
  if (!card) return undefined
  return card.target === 'production' ? 'version en production' : 'version candidate'
}

function scorecardLevelColor(level: AgentDeliveryScorecard['level']): 'emerald' | 'amber' | 'red' {
  if (level === 'excellent' || level === 'delivery_ready') return 'emerald'
  if (level === 'safe') return 'amber'
  return 'red'
}

function appendFailureMessage(message: string, failure: string): string {
  return message + ' ' + failure
}

/* ═════════════════ Le dernier événement de livraison ═════════════════ */

function DeliveryEventPanel({ detail }: DeliveryEventPanelProps) {
  const d = detail.latestDelivery

  return (
    <Panel
      title="Dernière livraison"
      hint={detail.repoFullName ?? 'aucun dépôt cible'}
      className="min-h-[14rem] min-w-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {detail.deliveryFailure !== null ? (
        <Note tone="warn" title="Événement de livraison non lu">
          {appendFailureMessage(
            'La lecture de `agent_delivery_events` a échoué. Aucun état de livraison n’est affiché à la place — un panneau vide se lirait comme « jamais livré », ce qui n’est pas ce qui est su.',
            detail.deliveryFailure,
          )}
        </Note>
      ) : d === null ? (
        <Unavailable
          reason="no-data"
          detail="La lecture a réussi : aucun événement de livraison n’existe pour cet agent. C’est un fait mesuré — cet agent n’a jamais été livré à un dépôt cible."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Mode" value={deliveryModeLabel(d.mode)} />
            <Fact label="Dépôt" value={d.targetRepo} />
            <Fact label="Branche de base" value={d.targetBranch} why="La branche de base n’a pas été enregistrée." />
            <Fact
              label="Branche de livraison"
              value={d.deliveryBranch}
              why="Une livraison en commit direct n’a pas de branche dédiée."
            />
            <Fact
              label="Commit"
              value={d.commitSha !== null ? <FactValue>{d.commitSha.slice(0, 10)}</FactValue> : null}
              why="Aucun SHA de commit n’a été enregistré pour cette livraison."
            />
            <Fact label="Statut enregistré" value={d.status} />
            <Fact label="Date" value={isoShort(d.createdAt)} why="La date de l’événement n’est pas lisible." />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Les liens sortants sont RÉELS ou absents — jamais un `#`. */}
            {d.commitUrl !== null ? (
              <Link href={d.commitUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                Voir le commit
              </Link>
            ) : null}
            {d.prUrl !== null ? (
              <Link href={d.prUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                Voir la PR {d.prNumber !== null ? `#${d.prNumber}` : ''}
              </Link>
            ) : null}
          </div>

          {d.prUrl !== null ? (
            <Note tone="structural" title="L’état de cette PR n’est pas su">
              Aigent a ouvert cette PR et n’a plus jamais relu son état. Elle peut être mergée,
              fermée, ou toujours ouverte : aucun chemin de code ne va le vérifier. Le lien ci-dessus
              est la seule façon de le savoir.
            </Note>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

/* ═════════════════ Les huit états ═════════════════ */

function DeliveryStatesPanel({ detail }: DeliveryStatesPanelProps) {
  const states = deriveDeliveryStates({
    realDeliveryEnabled: detail.realDeliveryEnabled,
    latestDelivery: detail.latestDelivery,
    deliveryRead: detail.deliveryFailure === null,
    consumerTelemetryCount: detail.telemetry?.consumerCount ?? null,
    telemetryEventCount: detail.telemetry?.scannedCount ?? null,
  })

  return (
    <Panel
      title="États de livraison"
      hint={states.length + ' états distincts'}
      className="min-h-[20rem] min-w-0"
      padded={false}
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="border-b border-zinc-950/5 px-4 py-3 dark:border-white/5">
        <Text>
          Huit affirmations DISTINCTES, jamais résumées en une seule. Trois d’entre elles ne sont ni
          des succès ni des échecs : deux sont des <Strong>inconnues structurelles</Strong> — Aigent
          n’a aucun canal pour les savoir — et une est un <Strong>fait mesuré</Strong>, c’est-à-dire
          une lecture qui a réussi et dont le résultat est « rien ».
        </Text>
      </div>
      {states.map((state) => (
        <DeliveryStateRow key={state.id} state={state} />
      ))}
    </Panel>
  )
}

/* ═════════════════ Scorecard ═════════════════ */

function ScorecardPanel({ card, failure }: ScorecardPanelProps) {
  return (
    <Panel
      title="Scorecard de livraison"
      hint={scorecardPanelHint(card)}
      className="min-h-[16rem] min-w-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Note tone="warn" title="Scorecard non calculée">
          {appendFailureMessage(
            'L’agrégation n’a pas abouti. Aucun score n’est affiché à la place — un score de 0 se lirait comme un verdict.',
            failure,
          )}
        </Note>
      ) : card === null ? (
        <Unavailable
          reason="no-data"
          detail="Aucune scorecard n’est calculable : le copilot n’a pas été trouvé dans le périmètre serveur."
        />
      ) : (
        <ScorecardBody card={card} />
      )}
    </Panel>
  )
}

function ScorecardBody({ card }: ScorecardBodyProps) {
  const meaningful = scorecardScoreIsMeaningful(card)
  const ratio = scorecardMeasuredRatio(card)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          color={scorecardLevelColor(card.level)}
          title={SCORECARD_LEVEL_MEANING[card.level]}
        >
          {SCORECARD_LEVEL_LABEL[card.level]}
        </Badge>

        {/* Le score n'est affiché QUE s'il repose sur une dimension réellement
            mesurée. Une somme pondérée sur zéro mesure vaut 0 — et ce 0 se
            lirait comme « noté zéro », ce qui n'est pas « rien n'a été mesuré ». */}
        {meaningful ? (
          <Badge color="zinc" title="Somme pondérée sur les dimensions mesurées. Les dimensions non mesurées n’attribuent simplement pas leur poids.">
            {card.score}/100
          </Badge>
        ) : (
          <NotMeasured why="Aucune dimension n’a été mesurée : le score agrégé serait un 0 arithmétique, pas un verdict. Il n’est donc pas affiché." />
        )}

        <Badge color="zinc" title="Dimensions réellement mesurées sur le total. Le reste n’a pas été évalué.">
          {ratio.measured}/{ratio.total} dimensions mesurées
        </Badge>
      </div>

      {card.blockers.length > 0 ? (
        <Note tone="blocked" title={card.blockers.length + ' bloqueur(s)'}>
          {card.blockers.join(' · ')} — un bloqueur force le verdict à « pas prêt », quel que soit le
          score pondéré.
        </Note>
      ) : null}

      <div className="flex flex-col">
        {card.dimensions.map((dim) => (
          <div
            key={dim.id}
            className="flex items-center gap-3 border-b border-zinc-950/5 py-2 last:border-b-0 dark:border-white/5"
          >
            <div className="min-w-0 flex-1">
              <Text className="truncate">
                <Strong>{dim.label}</Strong>
              </Text>
              <Text className="truncate text-xs">{dim.evidence ?? 'aucune preuve enregistrée'}</Text>
            </div>
            <div className="shrink-0 tabular-nums">
              {/* `score === null` est une ABSENCE, jamais un zéro. */}
              {dim.score === null ? <NotMeasured /> : <FactValue>{dim.score}</FactValue>}
            </div>
            <DimensionBadge status={dim.status} />
          </div>
        ))}
      </div>

      {card.warnings.length > 0 ? (
        <Text className="text-xs">
          <Strong>Réserves — </Strong>
          {card.warnings.join(' · ')}
        </Text>
      ) : null}
    </div>
  )
}

/* ═════════════════ Sandbox du dépôt cible ═════════════════ */

function SandboxPanel({ report, failure }: SandboxPanelProps) {
  return (
    <Panel
      title="Sandbox du dépôt cible"
      hint={report ? report.repo : undefined}
      className="min-h-[16rem] min-w-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Note tone="warn" title="Rapport de sandbox non lu">
          {appendFailureMessage(
            'La lecture du dernier rapport a échoué. Aucun verdict n’est affiché à la place.',
            failure,
          )}
        </Note>
      ) : report === null ? (
        <Unavailable
          reason="no-data"
          detail="La lecture a réussi : aucun rapport de sandbox n’a jamais été persisté pour cet agent. Le dépôt cible n’a donc jamais été évalué."
        />
      ) : (
        <SandboxBody report={report} />
      )}
    </Panel>
  )
}

function SandboxBody({ report }: SandboxBodyProps) {
  const counts = countSandboxChecks(report)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SandboxStatusBadge status={report.status} title={sandboxModeMeaning(report)} />
        <Badge
          color={report.executionMode === 'execute' ? 'emerald' : 'sky'}
          title={sandboxModeMeaning(report)}
        >
          {report.executionMode === 'execute' ? 'scripts exécutés' : 'dry-run — scripts non exécutés'}
        </Badge>
        <Badge color="zinc">{counts.passed} passé(s)</Badge>
        {counts.failed > 0 ? <Badge color="red">{counts.failed} échoué(s)</Badge> : null}
        {counts.warning > 0 ? <Badge color="amber">{counts.warning} réserve(s)</Badge> : null}
        <Badge color="zinc" title="Checks qui n’ont RIEN mesuré. Ni passés, ni échoués.">
          {counts.skipped} non exécuté(s)
        </Badge>
      </div>

      {report.executionMode === 'dry_run' ? (
        <Note title="Aucun script du dépôt cible n’a tourné">
          En dry-run, les scripts de gate du dépôt sont DÉTECTÉS puis marqués « non exécutés ». Un
          verdict vert prouve que les artefacts livrés sont présents et bien formés — il ne prouve
          rien sur le fait que le `build` du consommateur passerait.
        </Note>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Branche" value={report.branch} />
        <Fact
          label="Commit"
          value={report.commit !== null ? <FactValue>{report.commit.slice(0, 10)}</FactValue> : null}
          why="Le SHA de tête n’a pas pu être résolu (dépôt injoignable ou quota)."
        />
        <Fact
          label="Score in situ"
          value={report.sandboxFitScore !== null ? <FactValue>{report.sandboxFitScore}/100</FactValue> : null}
          why="Aucun check applicable : le score n’est pas calculable, il n’est pas nul."
        />
        <Fact
          label="Repo-fit (Aigent)"
          value={report.repoFitScore !== null ? <FactValue>{report.repoFitScore}/100</FactValue> : null}
          why="Le repo-fit du plan de contrôle n’a pas été calculé pour cet agent."
        />
      </div>

      {report.blockers.length > 0 ? (
        <Note tone="blocked" title={report.blockers.length + ' bloqueur(s)'}>
          {report.blockers.join(' · ')}
        </Note>
      ) : null}

      <div className="flex flex-col">
        {report.checks.map((check) => (
          <div
            key={check.id}
            className="flex items-center gap-3 border-b border-zinc-950/5 py-2 last:border-b-0 dark:border-white/5"
          >
            <div className="min-w-0 flex-1">
              <Text className="truncate">{check.label}</Text>
              {check.reason ? <Text className="truncate text-xs">{check.reason}</Text> : null}
            </div>
            <SandboxCheckBadge status={check.status} reason={check.reason} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═════════════════ Runtime consommateur ═════════════════ */

/**
 * Ce que devient l'agent APRÈS la poussée — et pourquoi Aigent n'en sait rien.
 *
 * Ce panneau est celui qui a le plus de chances d'être mal lu, donc il ne montre
 * aucun voyant : il montre des PHRASES. Un voyant gris à côté de « activation
 * consommateur » se lirait comme « pas activé » ; la vérité est « nous n'avons
 * aucun moyen de le savoir », et ça ne se dessine pas, ça s'écrit.
 */
type ConsumerProvisionNoteProps = { detail: DeliveryDetailRead }
type DetailTelemetryNoteProps = { detail: DeliveryDetailRead }

function ConsumerProvisionNote({ detail }: ConsumerProvisionNoteProps) {
  if (detail.repoFullName === null) {
    return (
      <Note title="Aucun dépôt cible">
        Sans dépôt lié, la question du provisioning n’a pas d’objet. Ce n’est ni « provisionné »
        ni « non provisionné » : il n’y a pas de cible.
      </Note>
    )
  }
  if (detail.consumerFailure !== null) {
    return (
      <Note tone="warn" title="État de provisioning non lu">
        {appendFailureMessage(
          'La lecture de `aigent/consumer-ready.json` sur le dépôt cible a échoué. On ne sait pas si le pack d’accueil est installé.',
          detail.consumerFailure,
        )}
      </Note>
    )
  }
  if (detail.consumerProvisioned === true) {
    const provisionedAt = detail.consumerProvisionedAt
      ? ' · provisionné le ' + isoShort(detail.consumerProvisionedAt)
      : ''
    return (
      <Note tone="info" title="Pack d’accueil consommateur installé">
        Version {detail.consumerPackVersion ?? 'non enregistrée'}
        {provisionedAt}
        . Le canal de retour EXISTE dans le dépôt — ce qui ne veut pas dire qu’il a servi.
      </Note>
    )
  }
  if (detail.consumerProvisioned === false) {
    return (
      <Note title="Pack d’accueil non installé">
        La lecture a réussi : `aigent/consumer-ready.json` n’existe pas sur le dépôt cible. Aucun
        canal de retour n’y est installé, donc aucun run ne pourrait remonter même si l’agent
        tournait.
      </Note>
    )
  }
  return (
    <Note tone="warn" title="État de provisioning non lu">
      Aucune lecture n’a abouti pour ce dépôt.
    </Note>
  )
}

function DetailTelemetryNote({ detail }: DetailTelemetryNoteProps) {
  if (detail.telemetryFailure !== null) {
    return (
      <Note tone="warn" title="Télémétrie non lue">
        {appendFailureMessage(
          'Impossible de dire si un agent déployé a rapporté un run.',
          detail.telemetryFailure,
        )}
      </Note>
    )
  }
  if (detail.telemetry === null) {
    return (
      <Note tone="warn" title="Télémétrie non lue">
        Aucune lecture n’a abouti. Aucun chiffre n’est affiché à la place.
      </Note>
    )
  }
  if (detail.telemetry.consumerCount === 0) {
    return (
      <Note tone="structural" title="Aucun agent déployé n’a jamais rapporté de run">
        La table `runtime_telemetry_events` a été LUE : sur {detail.telemetry.scannedCount}{' '}
        événement(s) les plus récents, <Strong>aucun</Strong> ne porte une provenance
        « consumer ». C’est un <Strong>fait mesuré</Strong> sur une lecture réussie, pas un
        panneau vide et pas une inconnue. Le flux est à sens unique : Aigent pousse des agents,
        et rien ne revient.
      </Note>
    )
  }
  return (
    <Note tone="info" title="Des runs de provenance consommateur existent">
      {detail.telemetry.consumerCount} événement(s) de provenance « consumer » sur{' '}
      {detail.telemetry.scannedCount} lu(s).
    </Note>
  )
}

function ConsumerPanel({ detail }: ConsumerPanelProps) {
  return (
    <Panel
      title="Runtime consommateur"
      hint={detail.repoFullName ?? undefined}
      className="min-h-[16rem] min-w-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        {/* ── Provisioning du pack d'accueil ── */}
        <ConsumerProvisionNote detail={detail} />

        <Divider soft />

        {/* ── Les deux inconnues structurelles ── */}
        <Note tone="structural" title="Activation chez le consommateur — inconnue structurelle">
          Après le provisioning, Aigent ne fait que <Strong>POUSSER</Strong>. Les gestes activate,
          rebind et deploy-version appartiennent au workspace consommateur, qui n’expose aucun canal
          de lecture vers Aigent. C’est pour cette raison — structurelle, pas accidentelle — que
          `active_in_consumer` vaut le littéral « unknown » dans la trace de cycle de vie. Ce n’est
          pas une donnée manquante à aller chercher : c’est une frontière du produit.
        </Note>

        <Note tone="structural" title="Merge de la PR — inconnu">
          Aucun chemin de code d’Aigent ne relit l’état d’une pull request après l’avoir ouverte. Ni
          mergée, ni refusée : non su.
        </Note>

        <Divider soft />

        {/* ── Le fait mesuré ── */}
        <DetailTelemetryNote detail={detail} />
      </div>
    </Panel>
  )
}

/* ═════════════════ L'écran ═════════════════ */

export default function DeliveryDetailScreen({ detail }: DeliveryDetailScreenProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {/* ─── En-tête ─── */}
      <div className="shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <Heading level={1}>{detail.copilotName}</Heading>
          {detail.repoFullName !== null ? (
            <Badge color="zinc">{detail.repoFullName}</Badge>
          ) : (
            <Badge color="zinc" title="Aucun dépôt GitHub lié au projet de cet agent.">
              aucun dépôt cible
            </Badge>
          )}
          {detail.projectName !== null ? <Badge color="zinc">{detail.projectName}</Badge> : null}
        </div>
        <Text className="mt-1">
          <Link href="/delivery" className="underline">
            ← Banc de livraison
          </Link>
        </Text>
      </div>

      {!detail.projectRead ? (
        <div className="shrink-0">
          <Note tone="warn" title="Projet non lu">
            Le projet de cet agent n’a pas pu être lu : le dépôt cible affiché ci-dessus est peut-être
            incomplet. Ce n’est pas « aucun projet ».
          </Note>
        </div>
      ) : null}

      {/* ─── Les huit états, en tête ─── */}
      <div className="min-h-0 shrink-0">
        <DeliveryStatesPanel detail={detail} />
      </div>

      <div className="grid shrink-0 gap-3 xl:grid-cols-2">
        <DeliveryEventPanel detail={detail} />
        <ConsumerPanel detail={detail} />
        <ScorecardPanel card={detail.scorecard} failure={detail.scorecardFailure} />
        <SandboxPanel report={detail.sandbox} failure={detail.sandboxFailure} />
      </div>

      {/* ─── Le poste de livraison ─── */}
      <Panel title="Actions de livraison" className="min-h-0 shrink-0 min-w-0">
        <DeliveryConsole
          target={{
            copilotId: detail.copilotId,
            copilotName: detail.copilotName,
            projectId: detail.projectId,
            repoFullName: detail.repoFullName,
            projectRead: detail.projectRead,
            realDeliveryEnabled: detail.realDeliveryEnabled,
          }}
        />
      </Panel>
    </div>
  )
}
