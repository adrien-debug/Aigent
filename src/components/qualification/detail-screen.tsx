/**
 * Fiche de qualification d'un candidat — la preuve, puis les actes.
 *
 * Server Component : il reçoit tout déjà lu et distribue. Il ne recalcule NI le
 * statut, NI la promouvabilité, NI l'exécutabilité — ce sont les dérivations
 * canoniques, et les refaire ici est exactement ce qui produit deux vérités sous
 * un seul label. La seule chose qu'il « rejoue » est la lecture des TROIS
 * conditions de la garde d'exécution, pour les EXPLIQUER ; et si le rejeu
 * diverge du contrat canonique, l'écart est affiché plutôt que résolu en
 * silence.
 *
 * LA SEULE PARTIE CLIENTE est `QualificationConsole` : c'est là que vivent les
 * mutations, en `fetch` vers `/api/agent-ops/**` (jamais en Server Action —
 * voir le commentaire de tête de `console.tsx`).
 *
 * CE QUE CET ÉCRAN REFUSE DE FAIRE
 * --------------------------------
 * · Rendre un check `missing` comme un `pass`. Trois états, trois couleurs,
 *   trois mots — c'est ce qui empêche de promouvoir sur une preuve absente.
 * · Déclarer promouvable une gate dont la liste de checks est VIDE
 *   (`[].every()` vaut `true`) : `summarizeChecks` exige `total > 0`.
 * · Rendre « replay impossible faute de baseline » comme « replay échoué ».
 * · Rendre « une boucle est déjà ouverte » comme une erreur : c'est un
 *   invariant garanti en base, donc une information.
 */
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Unavailable } from '@/components/cockpit/primitives'
import { formatPercent } from '@/lib/agent-mission-control/format'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { PromotionGateResult } from '@/lib/agent-mission-control/promotion-gate'
import type { QualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import type { ImprovementProposal } from '@/lib/agent-mission-control/improvement-loop'
import type { BenchmarkSuite, CopilotVersion, TestSuite } from '@/lib/agent-mission-control/types'
import QualificationConsole, { type ConsoleTarget } from './console'
import {
  ExecutionModeBadge,
  Fact,
  FactValue,
  GateStatusBadge,
  Note,
  ProposalStatusBadge,
  PromotionStatusBadge,
  RunStatusBadge,
  StepStatusBadge,
  isoShort,
} from './atoms'
import {
  REPLAY_FEASIBILITY_DETAIL,
  STEP_LABEL,
  canGenerateSuites,
  executionMode,
  isProposalOpen,
  proposalNextAction,
  replayFeasibility,
  runGuardConditions,
  runGuardDivergence,
  runGuardWouldAccept,
  sortPromotionChecks,
  sortReleaseChecks,
  suiteReadState,
  summarizeChecks,
} from './model'

/* ─────────────────── Les preuves shadow / replay lues ─────────────────── */

/** La dernière expérience shadow persistée pour ce candidat, telle que lue. */
export interface ShadowEvidence {
  id: string
  status: string
  verdict: string | null
  executionMode: unknown
  /** Compte persisté. `null` ⇒ la colonne n'a jamais été écrite, PAS zéro. */
  sampledRunCount: number | null
  /**
   * Compte persisté des appels d'outils mutants interceptés.
   *
   * `null` est structurel ici : un 0 se lit comme la PREUVE que le shadow a tout
   * intercepté. Confondre « jamais enregistré » avec « aucune mutation tentée »
   * transformerait une absence de mesure en certificat d'innocuité.
   */
  wouldMutateCount: number | null
  startedAt: string | null
  endsAt: string | null
}

/** La dernière comparaison replay persistée pour ce candidat, telle que lue. */
export interface ReplayEvidence {
  id: string
  status: string
  verdict: string | null
  executionMode: unknown
  /** Compte persisté. `null` ⇒ non enregistré, jamais « 0 cas comparés ». */
  caseCount: number | null
  createdAt: string | null
}

/** Une évaluation de gate archivée — l'historique, jamais une re-dérivation. */
export interface GateHistoryEntry {
  id: string
  versionId: string
  overall: string
  promotable: boolean
  evaluatedAt: string | null
}

export interface QualificationDetail {
  copilotId: string
  copilotName: string
  /** Le contrat canonique. `null` ⇒ aucune ligne canonique ne résout. */
  agent: AvailableAgent | null
  candidateVersion: CopilotVersion | null
  productionVersionId: string | null
  /** La lecture du pointeur de production a-t-elle abouti ? */
  productionRead: boolean
  versions: CopilotVersion[]
  /** `null` ⇒ la lecture a abouti. Une liste vide sur un échec n'est PAS un vide prouvé. */
  versionsFailure: string | null
  testSuites: TestSuite[]
  testSuitesFailure: string | null
  benchmarkSuites: BenchmarkSuite[]
  benchmarkSuitesFailure: string | null
  releaseGate: ReleaseGate | null
  releaseGateFailure: string | null
  promotionGate: PromotionGateResult | null
  promotionGateFailure: string | null
  qualificationRun: QualificationRun | null
  qualificationFailure: string | null
  shadow: ShadowEvidence | null
  shadowFailure: string | null
  replay: ReplayEvidence | null
  replayFailure: string | null
  proposal: ImprovementProposal | null
  proposalFailure: string | null
  gateHistory: GateHistoryEntry[]
  gateHistoryFailure: string | null
}

type DetailHeaderProps = { detail: QualificationDetail }
type RunGuardPanelProps = { agent: AvailableAgent | null }
type ReleaseGatePanelProps = { gate: ReleaseGate | null; failure: string | null }
type PromotionGatePanelProps = { gate: PromotionGateResult | null; failure: string | null }
type QualificationRunPanelProps = { run: QualificationRun | null; failure: string | null }
type ShadowPanelProps = { evidence: ShadowEvidence | null; failure: string | null }
type ReplayPanelProps = {
  evidence: ReplayEvidence | null
  failure: string | null
  productionVersionId: string | null
  productionRead: boolean
}
type ImprovementPanelProps = { proposal: ImprovementProposal | null; failure: string | null }
type GateHistoryPanelProps = { history: GateHistoryEntry[]; failure: string | null }
type VersionsPanelProps = { detail: QualificationDetail }
type SuitesPanelProps = { detail: QualificationDetail }
type QualificationDetailScreenProps = { detail: QualificationDetail }

function appendFailureMessage(message: string, failure: string): string {
  return message + ' ' + failure
}

function shadowVerdictColor(verdict: string | null): 'emerald' | 'red' | 'amber' {
  if (verdict === 'PASS') return 'emerald'
  if (verdict === 'FAIL') return 'red'
  return 'amber'
}

function replayVerdictColor(verdict: string | null): 'emerald' | 'red' | 'amber' {
  if (verdict === 'BETTER' || verdict === 'EQUIVALENT') return 'emerald'
  if (verdict === 'WORSE') return 'red'
  return 'amber'
}

function resolvePromotable(detail: QualificationDetail): boolean {
  if (detail.promotionGate) return detail.promotionGate.promotable
  if (detail.releaseGate) return summarizeChecks(detail.releaseGate.checks).promotable
  return false
}

function openProposalIdFrom(proposal: ImprovementProposal | null): string | null {
  if (!isProposalOpen(proposal)) return null
  return proposal?.id ?? null
}

type ProductionStatusBadgeProps = {
  productionRead: boolean
  productionVersionId: string | null
}

function ProductionStatusBadge({
  productionRead,
  productionVersionId,
}: ProductionStatusBadgeProps) {
  if (!productionRead) {
    return (
      <Badge color="zinc" title="Le pointeur de production n’a pas pu être lu.">
        production non lue
      </Badge>
    )
  }
  if (productionVersionId) {
    return (
      <Badge color="emerald" title="Version qui sert réellement la production.">
        production en service
      </Badge>
    )
  }
  return (
    <Badge
      color="amber"
      title="Aucune version n’a jamais été promue : il n’existe aucune baseline de production."
    >
      aucune production
    </Badge>
  )
}

/* ─────────────────────────── En-tête ─────────────────────────── */

function DetailHeader({ detail }: DetailHeaderProps) {
  const { copilotName, agent, candidateVersion, productionVersionId, productionRead } = detail

  return (
    <div className="shrink-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Heading level={1} className="min-w-0 truncate">
          {copilotName}
        </Heading>
        {candidateVersion ? (
          <Badge color="sky" title="La version candidate évaluée par cette fiche.">
            candidat {candidateVersion.label}
          </Badge>
        ) : (
          <Badge color="amber" title="Aucune version candidate ne résout : il n’y a rien à qualifier.">
            aucune version candidate
          </Badge>
        )}
        {candidateVersion ? <Badge color="zinc">{candidateVersion.stage}</Badge> : null}
        <ProductionStatusBadge
          productionRead={productionRead}
          productionVersionId={productionVersionId}
        />
      </div>
      <div className="mt-1">
        <Link href={`/agents/${detail.copilotId}`} className="underline">
          <Text>Voir la fiche complète de l’agent</Text>
        </Link>
      </div>
      {agent === null ? (
        <div className="mt-2">
          <Note tone="warn" title="Aucune ligne canonique ne résout pour ce copilot">
            Le contrat canonique (<code>getAvailableAgent</code>) ne rend rien pour cet identifiant :
            les trois conditions de la garde d’exécution sont donc INCONNUES, pas fausses. Cet écran
            ne les invente pas.
          </Note>
        </div>
      ) : null}
    </div>
  )
}

/* ─────────────── Garde d'exécution — les trois conditions ─────────────── */

/**
 * Le miroir exact de la garde fail-closed de `POST /copilots/:id/run`.
 *
 * Les trois conditions sont LUES depuis le contrat canonique, jamais recalculées
 * depuis des colonnes brutes. Ce panneau existe pour qu'un « non lançable » soit
 * expliqué, pas deviné — et il affiche une éventuelle divergence entre le rejeu
 * et le champ `executable` du contrat plutôt que de la taire.
 */
function RunGuardPanel({ agent }: RunGuardPanelProps) {
  if (agent === null) {
    return (
      <Panel title="Garde d’exécution" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
        <Unavailable
          reason="unread"
          detail="Aucune ligne canonique ne résout pour ce copilot : l’état des trois conditions est inconnu. Ce n’est pas « la garde refuserait » — c’est « on ne peut pas le dire »."
        />
      </Panel>
    )
  }

  const conditions = runGuardConditions(agent)
  const wouldAccept = runGuardWouldAccept(conditions)
  const divergence = runGuardDivergence(agent, conditions)

  return (
    <Panel
      title="Garde d’exécution"
      hint={conditions.filter((c) => c.satisfied).length + '/3 conditions'}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            color={agent.executable ? 'emerald' : 'red'}
            title="La règle exacte de POST /copilots/:id/run : statut « active », zéro outil non résolu, runtime « langgraph ». Les TROIS, ensemble. Sinon 409 avec les raisons concrètes."
          >
            {agent.executable ? 'la garde accepterait un lancement' : 'la garde refuserait un lancement'}
          </Badge>
          <Badge color="zinc" title="Le statut vient de getAvailableAgent — cette surface ne le recalcule jamais.">
            statut dérivé du catalogue
          </Badge>
        </div>

        <ul className="flex flex-col gap-1.5">
          {conditions.map((c) => (
            <li key={c.id} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <Text className="truncate" title={c.detail}>
                  {c.label}
                </Text>
              </span>
              <Text className="shrink-0 tabular-nums">{c.observed}</Text>
              <Badge color={c.satisfied ? 'emerald' : 'red'} title={c.detail}>
                {c.satisfied ? 'tenue' : 'non tenue'}
              </Badge>
            </li>
          ))}
        </ul>

        {divergence ? (
          <Note tone="warn" title="Divergence avec le contrat canonique">
            {divergence}
          </Note>
        ) : null}

        {!wouldAccept ? (
          <Text className="text-xs">
            Un run refusé rend un 409 portant ces raisons. Les trois conditions sont conjointes : en
            satisfaire deux ne débloque rien.
          </Text>
        ) : null}
      </div>
    </Panel>
  )
}

/* ─────────────────────── Gate de release ─────────────────────── */

/**
 * La gate de release — 9 checks, TROIS états.
 *
 * `missing` (« Non mesuré ») est le point de ce panneau : il bloque comme un
 * échec mais n'affirme pas la même chose, et le confondre avec un `pass` est
 * exactement ce qui promeut une version non prouvée.
 */
function ReleaseGatePanel({ gate, failure }: ReleaseGatePanelProps) {
  if (gate === null) {
    return (
      <Panel title="Gate de release" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
        <Unavailable
          reason={failure ? 'unread' : 'no-data'}
          detail={
            failure
              ? appendFailureMessage('La gate n’a pas pu être évaluée :', failure)
              : 'Aucune version candidate ne résout pour ce copilot — il n’y a rien à évaluer.'
          }
        />
      </Panel>
    )
  }

  const summary = summarizeChecks(gate.checks)

  return (
    <Panel
      title="Gate de release"
      hint={summary.passed + '/' + summary.total + ' vérifiés'}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            color={summary.promotable ? 'emerald' : 'red'}
            title="Promouvable seulement quand TOUS les checks passent, et seulement si des checks existent — une liste vide n’est jamais un feu vert."
          >
            {summary.promotable ? 'promouvable' : 'non promouvable'}
          </Badge>
          {summary.failed > 0 ? <Badge color="red">{summary.failed} échec(s)</Badge> : null}
          {summary.missing > 0 ? (
            <Badge
              color="amber"
              title="Signaux jamais mesurés. Ils bloquent la promotion, mais ils n’accusent rien — il n’y a simplement rien à lire."
            >
              {summary.missing} non mesuré(s)
            </Badge>
          ) : null}
          <Badge color="zinc">candidat {gate.evidence.candidateLabel}</Badge>
        </div>

        {/* Une gate sans aucun check n'est PAS une gate verte. Le dire, parce
            que `[].every()` vaut `true` et que la protection est invisible. */}
        {summary.total === 0 ? (
          <Note tone="warn" title="Aucun check n’a été évalué">
            Une liste de checks vide ne prouve rien. Elle n’autorise donc aucune promotion, même si
            « aucun check en échec » se lit spontanément comme un succès.
          </Note>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sortReleaseChecks(gate.checks).map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <Text className="truncate">{c.label}</Text>
                </span>
                <Text className="shrink-0 tabular-nums">{c.observed}</Text>
                <Text className="hidden shrink-0 sm:inline">exigé&nbsp;: {c.required}</Text>
                <GateStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact
            label="Taux de réussite des tests"
            value={
              gate.evidence.testRun ? (
                <FactValue>{formatPercent(gate.evidence.testRun.passRate)}</FactValue>
              ) : null
            }
            why="Aucun test run live n’est épinglé à ce candidat — il n’y a rien à mesurer."
            hint={
              gate.evidence.testRun
                ? gate.evidence.testRun.passed + '/' + gate.evidence.testRun.total + ' cas'
                : undefined
            }
          />
          <Fact
            label="Score de benchmark"
            value={
              gate.evidence.benchmark && gate.evidence.benchmark.score !== null ? (
                <FactValue>{Math.round(gate.evidence.benchmark.score * 10) / 10} / 100</FactValue>
              ) : null
            }
            why="Aucun benchmark live n’est épinglé au candidat, ou sa colonne de score est vide. Un score absent n’est pas un score de 0."
          />
          <Fact
            label="Score de production"
            value={
              gate.evidence.productionBenchmarkScore !== null ? (
                <FactValue>
                  {Math.round(gate.evidence.productionBenchmarkScore * 10) / 10} / 100
                </FactValue>
              ) : null
            }
            why="Aucune version de production ne porte de benchmark live — il n’existe pas de référence à laquelle comparer le candidat."
          />
          <Fact
            label="Actions non sûres"
            value={
              gate.evidence.benchmark && gate.evidence.benchmark.unsafeActionCount !== null ? (
                <FactValue>{gate.evidence.benchmark.unsafeActionCount}</FactValue>
              ) : null
            }
            why="Le compteur n’a jamais été mesuré. Il ne peut donc ni prouver la propreté ni prouver une violation — c’est un « non mesuré », et il bloque."
          />
          <Fact
            label="Erreurs de confirmation"
            value={
              gate.evidence.benchmark &&
              gate.evidence.benchmark.confirmationMistakeCount !== null ? (
                <FactValue>{gate.evidence.benchmark.confirmationMistakeCount}</FactValue>
              ) : null
            }
            why="Le compteur n’a jamais été mesuré — un « non mesuré », pas un zéro."
          />
          <Fact
            label="Outils capables d’écrire"
            value={
              gate.evidence.toolRiskWrites.length === 0 ? (
                <FactValue>aucun</FactValue>
              ) : (
                <Badge color="red">{gate.evidence.toolRiskWrites.join(', ')}</Badge>
              )
            }
          />
        </div>

        <Text className="text-xs">
          Les checks lisent le dernier test run et le dernier benchmark épinglés au candidat et
          filtrés sur une exécution live — une preuve fixture ne peut jamais débloquer une promotion.
        </Text>
      </div>
    </Panel>
  )
}

/* ─────────────────────── Gate de promotion ─────────────────────── */

function PromotionGatePanel({ gate, failure }: PromotionGatePanelProps) {
  if (gate === null) {
    return (
      <Panel title="Gate de promotion" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
        <Unavailable
          reason={failure ? 'unread' : 'no-data'}
          detail={
            failure
              ? appendFailureMessage('La gate de promotion n’a pas pu être évaluée :', failure)
              : 'Aucune version candidate ne résout — il n’y a rien à évaluer.'
          }
        />
      </Panel>
    )
  }

  return (
    <Panel
      title="Gate de promotion"
      hint={gate.overall}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            color={gate.promotable ? 'emerald' : 'red'}
            title="Cette évaluation est REJOUÉE côté serveur avant toute écriture, puis relue par la RPC transactionnelle. L’activation d’un bouton n’est jamais ce qui autorise une promotion."
          >
            {gate.promotable ? 'promotion permise' : 'promotion bloquée'}
          </Badge>
          <Badge color="zinc">runtime {gate.runtime}</Badge>
        </div>

        <ul className="flex flex-col gap-1.5">
          {sortPromotionChecks(gate.checks).map((c) => (
            <li key={c.id} className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <Text className="truncate">{c.label}</Text>
                <Text className="text-xs" title={`source : ${c.sourceOfTruth}`}>
                  {c.reason}
                </Text>
              </div>
              <PromotionStatusBadge status={c.status} />
            </li>
          ))}
        </ul>

        <Note tone="info" title="Aucune promotion automatique n’existe">
          La RPC <code>promote_copilot_version</code> est l’unique voie d’écriture, verrouillée en
          base à trois niveaux : un rôle d’exécution dédié dont <code>service_role</code> n’est pas
          membre, une évaluation de gate fraîche et passante relue dans la transaction, et un index
          partiel qui interdit deux versions de production. Cette interface déclenche ce chemin ;
          elle n’en ouvre aucun autre.
        </Note>
      </div>
    </Panel>
  )
}

/* ─────────────────────── Qualification orchestrée ─────────────────────── */

function QualificationRunPanel({ run, failure }: QualificationRunPanelProps) {
  return (
    <Panel
      title="Qualification orchestrée"
      hint={run ? `curseur ${run.stepCursor}` : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Unavailable
          reason="unread"
          detail={
            appendFailureMessage(
              'Le registre de qualification n’a pas pu être lu :',
              failure,
            ) + ' Ce n’est pas « aucune qualification ».'
          }
        />
      ) : run === null ? (
        <Unavailable
          reason="no-data"
          detail="Aucune qualification n’a été lancée pour la version candidate. La lecture a réussi — la table est vide pour ce candidat, ce n’est pas une panne."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={run.status} />
            <Badge
              color={run.policy.requireShadow ? 'amber' : 'zinc'}
              title="Une preuve shadow est-elle exigée pour promouvoir ce candidat ? La résolution de politique est fail-closed : stricte quand elle est indéterminable."
            >
              shadow {run.policy.requireShadow ? 'exigé' : 'non exigé'}
            </Badge>
            <Badge
              color={run.policy.requireReplay ? 'amber' : 'zinc'}
              title="Une comparaison replay est-elle exigée pour promouvoir ce candidat ?"
            >
              replay {run.policy.requireReplay ? 'exigé' : 'non exigé'}
            </Badge>
          </div>

          {run.steps.length === 0 ? (
            <Text>
              Le parcours est ouvert mais aucune étape n’a encore produit de verdict. Ce n’est pas un
              échec — rien n’a encore été exécuté.
            </Text>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {run.steps.map((s) => (
                <li key={`${s.step}-${s.at}`} className="flex min-w-0 items-start gap-2">
                  <Strong className="w-28 shrink-0 truncate">{STEP_LABEL[s.step]}</Strong>
                  <div className="min-w-0 flex-1">
                    <Text className="truncate" title={s.reason}>
                      {s.reason}
                    </Text>
                    <Text className="text-xs">source : {s.sourceOfTruth}</Text>
                  </div>
                  <StepStatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}

          <Text className="text-xs">
            Le parcours s’arrête à la gate : il n’a aucun chemin vers la promotion. Un candidat
            « promouvable » reste un candidat tant qu’un humain n’a pas agi.
          </Text>
        </div>
      )}
    </Panel>
  )
}

/* ─────────────────────── Shadow ─────────────────────── */

function ShadowPanel({ evidence, failure }: ShadowPanelProps) {
  return (
    <Panel
      title="Shadow"
      hint={evidence?.verdict ?? undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Unavailable reason="unread" detail={appendFailureMessage('La preuve shadow n’a pas pu être lue :', failure)} />
      ) : evidence === null ? (
        <Unavailable
          reason="no-data"
          detail="Aucune expérience shadow n’existe pour ce candidat. La lecture a réussi — il n’y a rien."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              color={shadowVerdictColor(evidence.verdict)}
              title="INSUFFICIENT_EVIDENCE n’est ni un succès ni un échec : le corpus n’a pas réuni de quoi trancher."
            >
              {evidence.verdict ?? 'verdict absent'}
            </Badge>
            <Badge color="zinc">{evidence.status}</Badge>
            <ExecutionModeBadge mode={executionMode(evidence.executionMode)} />
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact
              label="Runs échantillonnés"
              value={
                evidence.sampledRunCount === null ? null : (
                  <FactValue>{evidence.sampledRunCount}</FactValue>
                )
              }
              why="Le compteur d’échantillonnage n’a pas été enregistré pour cette expérience. Aucun run n’en est déduit — c’est un « non mesuré »."
            />
            {/* Le hint « un 0 est le résultat attendu » ne s'affiche QUE sur un
                compteur réellement mesuré. Sur une colonne jamais écrite, il
                ferait passer une absence de mesure pour une preuve
                d'innocuité — c'est ce panneau, et pas un autre, où ce mensonge
                coûte le plus cher. */}
            <Fact
              label="Mutations interceptées"
              value={
                evidence.wouldMutateCount === null ? null : (
                  <FactValue>{evidence.wouldMutateCount}</FactValue>
                )
              }
              why="Le compteur de mutations n’a JAMAIS été enregistré pour cette expérience. Ce n’est pas « aucune mutation tentée » : rien ne prouve ici que le shadow a intercepté quoi que ce soit."
              hint={
                evidence.wouldMutateCount === null
                  ? undefined
                  : 'Appels d’outils mutants qui auraient écrit — interceptés, jamais exécutés. Un 0 est ici un 0 MESURÉ, et c’est le résultat attendu.'
              }
            />
            <Fact
              label="Démarré"
              value={isoShort(evidence.startedAt) ? <FactValue>{isoShort(evidence.startedAt)}</FactValue> : null}
              why="La date de démarrage n’a pas été enregistrée."
            />
            <Fact
              label="Terminé"
              value={isoShort(evidence.endsAt) ? <FactValue>{isoShort(evidence.endsAt)}</FactValue> : null}
              why="L’expérience n’a pas de date de fin : elle est en cours, ou elle a été interrompue."
            />
          </div>

          {executionMode(evidence.executionMode) !== 'live_langgraph' ? (
            <Note tone="warn" title="Cette preuve ne satisfait pas un check shadow exigé">
              Seule une exécution <code>live_langgraph</code> est acceptée par une gate qui exige le
              shadow. Une simulation prouve la mécanique du moteur, pas le comportement du candidat.
            </Note>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

/* ─────────────────────── Replay ─────────────────────── */

/**
 * Le replay, et surtout : le replay IMPOSSIBLE.
 *
 * Sans `production_version_id`, il n'y a rien à comparer et la route refuse de
 * partir (409). Ce panneau distingue explicitement trois choses qu'un écran naïf
 * confondrait : « jamais tourné », « impossible faute de baseline », et « la
 * lecture a échoué ».
 */
function ReplayPanel({
  evidence,
  failure,
  productionVersionId,
  productionRead,
}: ReplayPanelProps) {
  const feasibility = replayFeasibility(productionVersionId, productionRead)

  return (
    <Panel
      title="Replay"
      hint={evidence?.verdict ?? undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        {feasibility !== 'possible' ? (
          <Note
            tone={feasibility === 'no-baseline' ? 'info' : 'warn'}
            title={
              feasibility === 'no-baseline'
                ? 'Replay impossible tant qu’aucune version de production n’existe'
                : 'Faisabilité du replay inconnue'
            }
          >
            {REPLAY_FEASIBILITY_DETAIL[feasibility]}
          </Note>
        ) : null}

        {failure !== null ? (
          <Unavailable reason="unread" detail={appendFailureMessage('La preuve replay n’a pas pu être lue :', failure)} />
        ) : evidence === null ? (
          <Unavailable
            reason="no-data"
            detail={
              feasibility === 'no-baseline'
                ? 'Aucune comparaison replay n’existe — et il ne pouvait pas en exister, faute de baseline. Ce n’est pas un replay qui a échoué.'
                : 'Aucune comparaison replay n’existe pour ce candidat. La lecture a réussi — il n’y a rien.'
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                color={replayVerdictColor(evidence.verdict)}
                title="INCONCLUSIVE n’est pas WORSE : la comparaison n’a pas réuni de quoi trancher."
              >
                {evidence.verdict ?? 'verdict absent'}
              </Badge>
              <Badge color="zinc">{evidence.status}</Badge>
              <ExecutionModeBadge mode={executionMode(evidence.executionMode)} />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact
                label="Cas comparés"
                value={evidence.caseCount === null ? null : <FactValue>{evidence.caseCount}</FactValue>}
                why="Le nombre de cas comparés n’a pas été enregistré. « 0 cas » et « on ne sait pas combien de cas » ne disent pas la même chose d’une comparaison."
              />
              <Fact
                label="Créé"
                value={isoShort(evidence.createdAt) ? <FactValue>{isoShort(evidence.createdAt)}</FactValue> : null}
                why="La date de création n’a pas été enregistrée."
              />
            </div>

            {executionMode(evidence.executionMode) !== 'live_langgraph' ? (
              <Note tone="warn" title="Cette preuve ne satisfait pas un check replay exigé">
                Seule une exécution <code>live_langgraph</code> — la référence ET le candidat
                réellement rejoués — est acceptée par une gate qui exige le replay.
              </Note>
            ) : null}
          </>
        )}
      </div>
    </Panel>
  )
}

/* ─────────────────────── Boucle d'amélioration ─────────────────────── */

function ImprovementPanel({ proposal, failure }: ImprovementPanelProps) {
  return (
    <Panel
      title="Boucle d’amélioration"
      hint={proposal ? proposal.status : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Unavailable
          reason="unread"
          detail={
            appendFailureMessage(
              'Le registre des propositions n’a pas pu être lu :',
              failure,
            ) + ' Ce n’est pas « aucune proposition ».'
          }
        />
      ) : proposal === null ? (
        <Unavailable
          reason="no-data"
          detail="Aucune boucle d’amélioration n’existe pour ce copilot. La lecture a réussi — la table est vide pour lui."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ProposalStatusBadge status={proposal.status} />
            {isProposalOpen(proposal) ? (
              <Badge
                color="amber"
                title="Une boucle ouverte attend une décision humaine. La base n’en tolère qu’une par copilot — une nouvelle analyse serait refusée avec un 409."
              >
                boucle ouverte
              </Badge>
            ) : null}
          </div>

          <Note
            tone={isProposalOpen(proposal) ? 'warn' : 'info'}
            title="La décision humaine est le garde-fou central"
          >
            {proposalNextAction(proposal)}
          </Note>

          <Text>{proposal.summary}</Text>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact
              label="Version de base"
              value={<FactValue>{proposal.baseVersionId}</FactValue>}
            />
            <Fact
              label="Version V2"
              value={proposal.v2VersionId ? <FactValue>{proposal.v2VersionId}</FactValue> : null}
              why="La V2 n’a pas encore été matérialisée : la proposition existe, le brouillon non."
            />
            <Fact
              label="Décidée par"
              value={proposal.decidedBy ? <FactValue>{proposal.decidedBy}</FactValue> : null}
              why="Personne n’a encore décidé. C’est exactement ce que la boucle attend."
            />
            <Fact
              label="Décidée le"
              value={isoShort(proposal.decidedAt) ? <FactValue>{isoShort(proposal.decidedAt)}</FactValue> : null}
              why="Aucune décision n’a été enregistrée."
            />
          </div>

          {proposal.failureAnalysis.length > 0 ? (
            <div>
              <Text className="text-xs">Analyse des échecs</Text>
              <ul className="mt-1 flex flex-col gap-1">
                {proposal.failureAnalysis.slice(0, 8).map((entry, i) => (
                  <li key={`${entry.caseId ?? 'entry'}-${i}`}>
                    <Text className="truncate" title={entry.rootCause}>
                      {entry.rootCause}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

/* ─────────────────────── Historique des gates ─────────────────────── */

function GateHistoryPanel({ history, failure }: GateHistoryPanelProps) {
  return (
    <Panel
      title="Historique des gates"
      hint={failure === null ? history.length + ' évaluation(s)' : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Unavailable
          reason="unread"
          detail={appendFailureMessage('L’historique des évaluations n’a pas pu être lu :', failure)}
        />
      ) : history.length === 0 ? (
        <Unavailable
          reason="no-data"
          detail="Aucune évaluation de gate n’a jamais été persistée pour ce copilot. La lecture a réussi — il n’y a rien."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {history.map((entry) => (
            <li key={entry.id} className="flex min-w-0 items-center gap-2">
              <Text className="shrink-0 tabular-nums">{isoShort(entry.evaluatedAt) ?? '—'}</Text>
              <Text className="min-w-0 flex-1 truncate" title={entry.versionId}>
                {entry.versionId}
              </Text>
              <Badge
                color={entry.promotable ? 'emerald' : 'red'}
                title="Une évaluation archivée est une OBSERVATION datée. Elle ne rouvre aucun droit : la RPC exige une évaluation FRAÎCHE et passante."
              >
                {entry.overall}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ─────────────────────── Versions & suites ─────────────────────── */

function VersionsPanel({ detail }: VersionsPanelProps) {
  const { versions, versionsFailure, productionVersionId, candidateVersion } = detail

  return (
    <Panel
      title="Versions"
      // Un compte n'est affiché que s'il a été LU. « 0 persistée(s) » sur une
      // lecture échouée serait un chiffre fabriqué.
      hint={versionsFailure === null ? versions.length + ' persistée(s)' : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {versionsFailure !== null ? (
        <Unavailable
          reason="unread"
          detail={
            appendFailureMessage(
              'Le registre des versions n’a pas pu être lu :',
              versionsFailure,
            ) + ' Ce n’est pas « aucune version ».'
          }
        />
      ) : versions.length === 0 ? (
        <Unavailable
          reason="no-data"
          detail="Aucune version n’est persistée pour ce copilot. La lecture a réussi — il n’y a rien."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {versions.map((v) => (
            <li key={v.id} className="flex min-w-0 items-center gap-2">
              <Strong className="shrink-0">{v.label}</Strong>
              <Badge color={v.stage === 'production' ? 'emerald' : 'zinc'}>{v.stage}</Badge>
              {v.id === productionVersionId ? (
                <Badge color="emerald" title="Version qui sert réellement la production.">
                  en service
                </Badge>
              ) : null}
              {v.id === candidateVersion?.id && v.id !== productionVersionId ? (
                <Badge color="sky" title="Version candidate évaluée par cette fiche.">
                  candidat
                </Badge>
              ) : null}
              <span className="min-w-0 flex-1" />
              <Text className="shrink-0 tabular-nums">{isoShort(v.createdAt) ?? '—'}</Text>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function SuitesPanel({ detail }: SuitesPanelProps) {
  const { testSuites, testSuitesFailure, benchmarkSuites, benchmarkSuitesFailure } = detail
  const anyFailure = testSuitesFailure ?? benchmarkSuitesFailure

  return (
    <Panel
      title="Suites"
      hint={
        anyFailure === null
          ? testSuites.length + ' test · ' + benchmarkSuites.length + ' benchmark'
          : undefined
      }
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {anyFailure !== null ? (
        <Unavailable
          reason="unread"
          detail={
            appendFailureMessage(
              'Le registre des suites n’a pas pu être lu :',
              anyFailure,
            ) +
            ' Ce n’est pas « aucune suite n’existe » — et la génération, qui est facturée, reste éteinte tant qu’on ne sait pas ce qui existe déjà.'
          }
        />
      ) : testSuites.length === 0 && benchmarkSuites.length === 0 ? (
        <Unavailable
          reason="no-data"
          detail="Aucune suite n’existe pour ce copilot. La lecture a réussi. La génération est le premier geste — elle crée la suite, elle ne l’exécute pas."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {testSuites.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {testSuites.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2">
                  <Text className="min-w-0 flex-1 truncate">{s.name}</Text>
                  <Badge color="zinc">{s.kind}</Badge>
                  <Badge color="zinc">{s.caseIds.length} cas</Badge>
                </li>
              ))}
            </ul>
          ) : null}
          {benchmarkSuites.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {benchmarkSuites.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2">
                  <Text className="min-w-0 flex-1 truncate">{s.name}</Text>
                  <Badge color="zinc">{s.taskCount} tâches</Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

/* ─────────────────────────── Écran ─────────────────────────── */

/**
 * Construit la cible du poste de commande à partir des lectures serveur.
 *
 * Rien n'est dérivé une seconde fois : `promotable` vient de la gate de
 * promotion (ou, à défaut, de la gate de release — mais JAMAIS d'un calcul
 * maison), et les raisons de refus viennent des conditions nommées.
 */
function buildConsoleTarget(detail: QualificationDetail): ConsoleTarget {
  const conditions = detail.agent ? runGuardConditions(detail.agent) : []
  const runBlockers = conditions.filter((c) => !c.satisfied).map((c) => c.label + ' — ' + c.observed)

  const promotable = resolvePromotable(detail)

  // Une lecture de versions échouée ne rend pas « aucune version archivée » :
  // le retour arrière reste éteint avec sa raison plutôt que d'être proposé sur
  // une cible qu'on n'a pas pu lire.
  const archived =
    detail.versionsFailure === null
      ? (detail.versions.find((v) => v.stage === 'archived') ?? null)
      : null

  // Les suites ont-elles été LUES ? Sans cette réponse, `testSuiteId === null`
  // veut dire deux choses opposées — « aucune suite n'existe » (la génération
  // facturée est le bon geste) et « on n'a pas pu lire » (la génération
  // regénérerait peut-être des suites qui existent déjà, pour de l'argent réel).
  const testState = suiteReadState(detail.testSuites, detail.testSuitesFailure)
  const benchState = suiteReadState(detail.benchmarkSuites, detail.benchmarkSuitesFailure)

  return {
    copilotId: detail.copilotId,
    candidateVersionId: detail.candidateVersion?.id ?? null,
    candidateLabel: detail.candidateVersion?.label ?? null,
    suitesRead: testState.read && benchState.read,
    canGenerateSuites: canGenerateSuites(testState, benchState),
    testSuiteId: testState.firstId,
    benchmarkSuiteId: benchState.firstId,
    versionsRead: detail.versionsFailure === null,
    productionVersionId: detail.productionVersionId,
    productionRead: detail.productionRead,
    rollbackTargetId: archived?.id ?? null,
    rollbackTargetLabel: archived?.label ?? null,
    openProposalId: openProposalIdFrom(detail.proposal),
    proposalId: detail.proposal?.id ?? null,
    proposalStatus: detail.proposal?.status ?? null,
    promotable,
    runBlockers,
  }
}

export default function QualificationDetailScreen({ detail }: QualificationDetailScreenProps) {
  const target = buildConsoleTarget(detail)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <DetailHeader detail={detail} />

      {/* Le poste de commande est borné à ~40 % de la colonne : sans plafond il
       * prenait toute la hauteur et laissait 41 px aux dix panneaux de preuve,
       * réduits à leur seul titre. Une box fixe dont la data scrolle dedans —
       * pas une box qui écrase ses voisines. */}
      <Panel
        title="Poste de commande"
        hint="fixture par défaut"
        className="max-h-[40%] min-h-0 shrink-0"
        bodyClassName="scroll-thin overflow-y-auto"
      >
        <QualificationConsole target={target} />
      </Panel>

      <Divider soft />

      {/* Grille dense : `flex-1` lui donne la hauteur restante — sans lui elle
       * ne réclamait que son contenu minimal. `auto-rows-fr` répartit à parts
       * égales, `overflow-y-auto` absorbe le débordement des rangées basses sur
       * les viewports courts. Chaque panneau borne sa hauteur, seule sa liste
       * défile. */}
      <div className="scroll-thin grid min-h-0 flex-1 auto-rows-fr grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2 xl:grid-cols-3">
        <RunGuardPanel agent={detail.agent} />
        <ReleaseGatePanel gate={detail.releaseGate} failure={detail.releaseGateFailure} />
        <PromotionGatePanel gate={detail.promotionGate} failure={detail.promotionGateFailure} />
        <QualificationRunPanel run={detail.qualificationRun} failure={detail.qualificationFailure} />
        <ShadowPanel evidence={detail.shadow} failure={detail.shadowFailure} />
        <ReplayPanel
          evidence={detail.replay}
          failure={detail.replayFailure}
          productionVersionId={detail.productionVersionId}
          productionRead={detail.productionRead}
        />
        <ImprovementPanel proposal={detail.proposal} failure={detail.proposalFailure} />
        <GateHistoryPanel history={detail.gateHistory} failure={detail.gateHistoryFailure} />
        <VersionsPanel detail={detail} />
        <SuitesPanel detail={detail} />
      </div>
    </div>
  )
}
