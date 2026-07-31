/**
 * Fiche d'un agent — maître-détail, hauteur bornée, la donnée défile dans ses box.
 *
 * Server Component pur : il reçoit `AgentDetail` (le résolveur UNIQUE de toutes
 * les sections) plus la gate de release, et il distribue. Il ne recalcule NI le
 * statut, NI l'exécutabilité, NI la promouvabilité — ce sont les dérivations
 * canoniques, et les refaire ici est ce qui produit deux vérités sous un seul
 * label.
 *
 * LECTURE SEULE. Aucun bouton d'action n'existe sur cet écran : pas de run, pas
 * de promotion, pas de qualification. Les mutations arrivent plus tard avec leur
 * dialogue de confirmation et leur coût affiché ; les esquisser ici en inerte
 * dessinerait une capacité qui n'existe pas.
 *
 * CE QUE L'ÉCRAN REFUSE DE FAIRE
 * ------------------------------
 * · Rendre un `null` comme un `0`. Chaque mesure passe par `Fact`, dont le
 *   contrat est que `null` devient « Indisponible ».
 * · Rendre `active_in_consumer` en rouge. Le verdict d'activation vaut `true`
 *   ou « Inconnue », jamais `false` : le silence d'un consommateur est ambigu.
 *   L'étape rend son état, sa raison, l'horodatage de la dernière preuve et sa
 *   péremption — et une lecture EN PANNE se dit « Lecture impossible », jamais
 *   « Inconnue ».
 * · Rendre un check `missing` comme un `pass`. Trois états, trois couleurs,
 *   trois mots.
 */
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading, Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel, Unavailable } from '@/components/cockpit/primitives'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { QualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import {
  Fact,
  FactValue,
  GateStatusBadge,
  LifecycleStatusBadge,
  NotMeasured,
  ProviderBadge,
  RuntimeStatusBadge,
  StageBadge,
} from './atoms'
import {
  isConsumerReportedStage,
  sortChecks,
  stageDisplay,
  summarizeGate,
  STAGE_DISPLAY_MEANING,
} from './evidence-model'
import { isUnavailable } from './roster-model'

/** Une date ISO → texte court et déterministe (UTC, sans locale). */
function isoShort(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
}

/* ─────────────────────────── En-tête ─────────────────────────── */

function DetailHeader({ detail }: { detail: AgentDetail }) {
  const { copilot, agent, project } = detail

  return (
    <div className="shrink-0">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Heading level={1} className="min-w-0 truncate">
          {copilot.name}
        </Heading>
        {/* Statut RUNTIME et statut de CYCLE DE VIE, côte à côte. L'un ne
            remplace jamais l'autre : ils répondent à deux questions. */}
        {agent ? (
          <RuntimeStatusBadge status={agent.status} />
        ) : (
          <Badge
            color="red"
            title="Aucune ligne canonique ne résout pour ce copilot : il n’est pas dans le catalogue runtime."
          >
            hors catalogue
          </Badge>
        )}
        <LifecycleStatusBadge status={copilot.status} />
      </div>

      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Text className="truncate">
          {agent?.description ?? copilot.description ?? 'Aucune description'}
        </Text>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {agent ? <ProviderBadge provider={agent.provider} /> : null}
        {project ? (
          <Badge color="zinc" title="Projet consommateur dans lequel cet agent est livré.">
            {project.name}
          </Badge>
        ) : (
          <Badge
            color="zinc"
            title="Aucun projet d’affectation résolu : le copilot est sur le banc de validation, ou son projet lié n’existe plus. L’affectation à un projet EST l’acte de validation."
          >
            banc de validation
          </Badge>
        )}
      </div>
    </div>
  )
}

/* ─────────────────── Exécutabilité & blockers ─────────────────── */

/**
 * Pourquoi un run ne peut pas partir — le miroir exact des 409 de la garde
 * d'exécution. C'est le panneau qui explique un « non lançable » au lieu de le
 * laisser deviner.
 */
function ExecutabilityPanel({ detail }: { detail: AgentDetail }) {
  const { executable, blockers, agent } = detail

  return (
    <Panel
      title="Exécutabilité"
      hint={executable ? 'lançable' : `${blockers.length} obstacle(s)`}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            color={executable ? 'emerald' : 'red'}
            title="La règle exacte de POST /copilots/:id/run : statut actif, aucun outil non résolu, runtime langgraph."
          >
            {executable ? 'la garde accepterait un lancement' : 'la garde refuserait un lancement'}
          </Badge>
          {agent?.runtime ? (
            <Badge
              color={agent.runtime === 'langgraph' ? 'emerald' : 'red'}
              title="LangGraph est le seul runtime produit exécutable."
            >
              runtime {agent.runtime}
            </Badge>
          ) : (
            <Badge color="red" title="La colonne runtime est vide — c’est en soi pourquoi l’agent ne peut pas tourner.">
              runtime non résolu
            </Badge>
          )}
          {/*
            Signal de provisioning — n'a de sens que sur langgraph, d'où le
            `=== false` strict : `null` (autre runtime, ou colonne non lue) ne
            doit rien afficher, sous peine de transformer un « non applicable »
            en alerte.
          */}
          {agent?.runtimeProvisioned === false ? (
            <Badge
              color="amber"
              title="copilots.assistant_id est vide : le run part sur le graphe nu, avec les outils génériques hérités."
            >
              aucun assistant provisionné
            </Badge>
          ) : null}
        </div>

        {agent?.runtimeProvisioned === false ? (
          <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2">
            <Strong className="block">Aucun assistant LangGraph provisionné</Strong>
            <Text className="mt-0.5">
              Le runtime est LangGraph mais <code>assistant_id</code> est vide. Un run n’échoue pas
              pour autant : il s’exécute contre le graphe nu, hérite des outils génériques hérités,
              et répond « pas de données » avec zéro appel d’outil — en paraissant sain.
            </Text>
          </div>
        ) : null}

        {blockers.length === 0 ? (
          <Text>
            Aucun obstacle : l’agent est actif, tous ses outils déclarés résolvent, et son runtime
            est LangGraph.
          </Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {blockers.map((b) => (
              <li
                key={b.code}
                className="rounded-md border border-[#e8455f]/25 bg-[#e8455f]/5 px-3 py-2"
              >
                <Strong className="block">{b.label}</Strong>
                <Text className="mt-0.5">{b.detail}</Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}

/* ─────────────────────────── Outils ─────────────────────────── */

function ToolsPanel({ detail }: { detail: AgentDetail }) {
  const { agent, tools } = detail
  const resolved = agent?.tools ?? []
  const unresolvedIds = agent?.unresolvedToolIds ?? []
  const nameById = new Map(tools.map((t) => [t.id, t.name]))

  return (
    <Panel
      title="Outils"
      hint={agent ? `${resolved.length} résolu(s) · ${unresolvedIds.length} non résolu(s)` : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {agent === undefined ? (
        <Unavailable
          reason="unread"
          detail="Aucune ligne canonique ne résout pour ce copilot — la liste d’outils montée ne peut pas être établie."
        />
      ) : resolved.length === 0 && unresolvedIds.length === 0 ? (
        <Unavailable reason="no-data" detail="Le manifeste ne déclare aucun outil." />
      ) : (
        <div className="flex flex-col gap-3">
          {unresolvedIds.length > 0 ? (
            <div className="rounded-md border border-[#e8455f]/25 bg-[#e8455f]/5 px-3 py-2">
              <Strong className="block">
                {unresolvedIds.length} outil(s) déclaré(s) sans handler exécutable
              </Strong>
              <Text className="mt-0.5">
                Un outil est résolu seulement si une ligne `tools` existe ET que le runner a un
                handler sous ce nom. C’est la cause concrète d’un agent « dégradé ».
              </Text>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {unresolvedIds.map((id) => (
                  <li key={id}>
                    <Badge color="red">{nameById.get(id) ?? id}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {resolved.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {resolved.map((t) => (
                <li key={t.id} className="flex min-w-0 items-center gap-2">
                  <Strong className="min-w-0 flex-1 truncate">{t.name}</Strong>
                  {/* `mutates` est fail-closed : seul un `false` explicite —
                      un acte auditable de l'auteur — prouve qu'un outil n'écrit
                      rien. Un NULL est une présomption, pas une preuve. */}
                  <Badge
                    color={t.mutates ? 'amber' : 'emerald'}
                    title={
                      t.mutates
                        ? 'Cet outil peut écrire, ou sa nature n’est pas prouvée (fail-closed : seul un `mutates = false` explicite prouve une lecture seule).'
                        : 'Nature prouvée en lecture seule par un `mutates = false` explicite.'
                    }
                  >
                    {t.mutates ? 'mutant' : 'lecture seule'}
                  </Badge>
                  <Badge color={t.riskLevel === 'high' || t.riskLevel === 'critical' ? 'red' : 'zinc'}>
                    {t.riskLevel}
                  </Badge>
                  {t.requiresConfirmation ? <Badge color="sky">confirmation</Badge> : null}
                  {!t.enabled ? <Badge color="zinc">désactivé</Badge> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
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
function ReleaseGatePanel({ gate, gateFailure }: { gate: ReleaseGate | null; gateFailure: string | null }) {
  if (gate === null) {
    return (
      <Panel title="Gate de release" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
        <Unavailable
          reason={gateFailure ? 'unread' : 'no-data'}
          detail={
            gateFailure
              ? `La gate n’a pas pu être évaluée : ${gateFailure}`
              : 'Aucune version candidate ne résout pour ce copilot — il n’y a rien à évaluer.'
          }
        />
      </Panel>
    )
  }

  const summary = summarizeGate(gate.checks)

  return (
    <Panel
      title="Gate de release"
      hint={`${summary.passed}/${summary.total} vérifiés`}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            color={summary.promotable ? 'emerald' : 'red'}
            title="Promouvable seulement quand TOUS les checks passent. Un signal non mesuré bloque au même titre qu’un échec."
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
          <Badge color="zinc">{gate.evidence.candidateStage}</Badge>
        </div>

        <ul className="flex flex-col gap-1.5">
          {sortChecks(gate.checks).map((c) => (
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

        {/* La preuve est filtrée `execution_mode = live` : une fixture ne
            satisfait jamais une promotion de production. Le dire évite de
            chercher pourquoi un run « vert » n'apparaît pas ici. */}
        <Text className="text-xs">
          Les checks lisent le dernier test run et le dernier benchmark épinglés au candidat et
          filtrés sur une exécution live — une preuve fixture ne peut jamais débloquer une
          promotion.
        </Text>
      </div>
    </Panel>
  )
}

/* ─────────────────── Qualification ─────────────────── */

function QualificationPanel({
  run,
  failure,
}: {
  run: QualificationRun | null
  failure: string | null
}) {
  return (
    <Panel
      title="Qualification"
      hint={run ? run.status : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {failure !== null ? (
        <Unavailable reason="unread" detail={`Le registre de qualification n’a pas pu être lu : ${failure}`} />
      ) : run === null ? (
        <Unavailable
          reason="no-data"
          detail="Aucune qualification n’a été lancée pour la version courante. La lecture a réussi — il n’y a rien, ce n’est pas une panne."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={run.status === 'promotable' ? 'emerald' : run.status === 'blocked' ? 'red' : 'zinc'}>
              {run.status}
            </Badge>
            {/* La politique de preuve est un COUPLE d'exigences, pas un mot :
                shadow et replay s'exigent indépendamment. La résolution est
                fail-closed (strict quand elle est indéterminable), donc afficher
                ce qui est réellement exigé vaut mieux qu'une étiquette globale. */}
            <Badge
              color={run.policy.requireShadow ? 'amber' : 'zinc'}
              title="Une preuve shadow est-elle exigée pour promouvoir ce candidat ?"
            >
              shadow {run.policy.requireShadow ? 'exigé' : 'non exigé'}
            </Badge>
            <Badge
              color={run.policy.requireReplay ? 'amber' : 'zinc'}
              title="Une comparaison replay est-elle exigée pour promouvoir ce candidat ?"
            >
              replay {run.policy.requireReplay ? 'exigé' : 'non exigé'}
            </Badge>
            <Badge color="zinc">curseur {run.stepCursor}</Badge>
          </div>

          {run.steps.length === 0 ? (
            <Text>Aucune étape n’a encore produit de verdict.</Text>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {run.steps.map((s) => (
                <li key={`${s.step}-${s.at}`} className="flex min-w-0 items-center gap-2">
                  <Strong className="shrink-0">{s.step}</Strong>
                  <Text className="min-w-0 flex-1 truncate" title={s.reason}>
                    {s.reason}
                  </Text>
                  {/* `NOT_AVAILABLE` est une évidence ABSENTE, pas un échec :
                      chaque étape consomme le verdict honnête d'un moteur
                      existant, et une preuve manquante se dit manquante. */}
                  <Badge
                    color={
                      s.status === 'PASS'
                        ? 'emerald'
                        : s.status === 'FAIL'
                          ? 'red'
                          : 'amber'
                    }
                    title={s.sourceOfTruth}
                  >
                    {s.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  )
}

/* ─────────────────── Cycle de vie ─────────────────── */

/**
 * La trace de cycle de vie, chaque étape avec SA source et SON état de preuve.
 *
 * `active_in_consumer` n'est PLUS une inconnue structurelle : la route
 * consommateur authentifiée alimente `consumer-activation.ts`, dont le verdict
 * est recopié tel quel. L'écran rend donc quatre choses pour cette étape —
 * l'état, la RAISON, l'horodatage de la dernière preuve, et la péremption
 * (`stale`) explicitement — au lieu d'un badge gris muet.
 *
 * Ce qu'il ne fait toujours pas : rendre cette étape en rouge. Le verdict n'est
 * jamais `false`, donc « pas atteinte » ne peut pas s'afficher ici. Et un
 * heartbeat ne vaut pas une exécution : la raison rendue vient de l'agrégation,
 * pas d'une reformulation locale.
 */
function LifecyclePanel({ detail }: { detail: AgentDetail }) {
  const { lifecycle } = detail

  return (
    <Panel
      title="Cycle de vie"
      hint={`${lifecycle.stages.filter((s) => stageDisplay(s) === 'reached').length}/${lifecycle.stages.length} atteintes`}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <ul className="flex flex-col gap-1.5">
        {lifecycle.stages.map((stage) => {
          const display = stageDisplay(stage)
          const consumerReported = isConsumerReportedStage(stage)
          const consumer = stage.consumer
          return (
            <li key={stage.key} className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Strong className="truncate">{stage.label}</Strong>
                  {consumerReported ? (
                    <Badge
                      color="sky"
                      title="Cette étape se lit UNIQUEMENT sur des événements rapportés par le consommateur et authentifiés (installation_id vérifié). Jamais sur une livraison, un statut Aigent ou un run interne. Un heartbeat prouve un runtime vivant, pas une exécution."
                    >
                      rapportée par le consommateur
                    </Badge>
                  ) : null}
                  {/* La péremption est rendue EXPLICITEMENT : une preuve trop
                      vieille ramène le verdict à « Inconnue », et l'écran doit
                      dire pourquoi plutôt que de laisser croire à une absence. */}
                  {consumer?.stale ? (
                    <Badge
                      color="amber"
                      title={`Une preuve d’exécution authentifiée existe mais elle est plus ancienne que la fenêtre de ${consumer.recencyWindowDays ?? '?'} jours. Le verdict est retombé à « Inconnue » : on a cessé de savoir, on n’a pas appris le contraire.`}
                    >
                      preuve périmée
                    </Badge>
                  ) : null}
                </div>
                <Text className="text-xs" title={`source : ${stage.evidence.source}`}>
                  {stage.evidence.detail}
                </Text>
                {consumer ? (
                  <Text className="text-xs">
                    {consumer.lastActivityAt
                      ? `Dernière preuve authentifiée : ${consumer.lastActivityAt}`
                      : 'Aucune preuve authentifiée horodatée.'}
                    {consumer.observedInstallationCount === null
                      ? ''
                      : ` · ${consumer.observedInstallationCount} installation(s) observée(s)`}
                  </Text>
                ) : null}
              </div>
              <StageBadge
                display={display}
                title={`${STAGE_DISPLAY_MEANING[display]} — source : ${stage.evidence.source}`}
              />
            </li>
          )
        })}
      </ul>

      <Divider soft className="my-3" />

      <Fact
        label="Dérive de version (livrée vs rapportée)"
        value={
          lifecycle.versionDrift.state === 'measured' ? (
            <Badge color={lifecycle.versionDrift.driftDetected ? 'red' : 'emerald'}>
              {lifecycle.versionDrift.driftDetected ? 'dérive détectée' : 'aucune dérive'}
            </Badge>
          ) : null
        }
        why={lifecycle.versionDrift.detail}
      />
    </Panel>
  )
}

/* ─────────────────── Mesures & runs ─────────────────── */

function MetricsPanel({ detail }: { detail: AgentDetail }) {
  const { metrics, agent } = detail

  return (
    <Panel title="Mesures" hint={`${metrics.totalRuns} run(s) lus`} className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {/* `runs24h` est un compte MESURÉ : un 0 réel est un 0, pas une absence. */}
        <Fact label="Runs 24 h" value={<FactValue>{metrics.runs24h}</FactValue>} />
        <Fact label="Runs au total" value={<FactValue>{metrics.totalRuns}</FactValue>} />
        <Fact
          label="Taux de succès"
          value={metrics.successRate === null ? null : <FactValue>{formatPercent(metrics.successRate)}</FactValue>}
          why="Aucun run n’a atteint un verdict (terminé ou échoué) — il n’y a rien sur quoi calculer un taux."
        />
        <Fact
          label="Latence moyenne"
          value={
            metrics.avgDurationMs === null ? null : <FactValue>{Math.round(metrics.avgDurationMs)} ms</FactValue>
          }
          why="Aucun run ne porte de latence mesurée."
        />
        <Fact
          label="Coût 24 h"
          value={metrics.cost24hUsd === null ? null : <FactValue>{formatUsd(metrics.cost24hUsd)}</FactValue>}
          why="Aucun run de la fenêtre ne porte de coût mesuré — un coût inconnu n’est pas un coût nul."
          hint={
            metrics.runsWithoutCost > 0
              ? `${metrics.runsWithoutCost} run(s) de la fenêtre sans coût enregistré`
              : undefined
          }
        />
        {/* Le piège de l'assistant manquant : un agent langgraph sans assistant
            provisionné tourne contre le graphe nu et termine « sainement » avec
            zéro appel d'outil. Un 0 MESURÉ ici est donc un signal, pas du bruit —
            et il se distingue d'un « non mesuré ». */}
        <Fact
          label="Appels d’outils"
          value={
            metrics.toolCallCountState === 'MEASURED' ? (
              <FactValue>{metrics.toolCallCount}</FactValue>
            ) : null
          }
          why="Aucun run terminé n’existe : il n’y a rien à mesurer. Ce n’est pas « zéro outil appelé »."
          hint={
            metrics.toolCallCountState === 'MEASURED'
              ? metrics.toolCallCount === 0
                ? `mesuré sur ${metrics.completedRuns} run(s) terminé(s) — un agent qui termine sans appeler d’outil peut tourner contre le graphe nu`
                : `mesuré sur ${metrics.completedRuns} run(s) terminé(s)`
              : undefined
          }
        />
        <Fact
          label="Modèle configuré"
          value={agent && !isUnavailable(agent, 'configuredModel') ? <FactValue>{agent.configuredModel}</FactValue> : null}
          why="Aucun modèle n’est résolu depuis les données persistées — jamais remplacé par un modèle par défaut."
        />
        {/* Modèle CONFIGURÉ ≠ modèle EXÉCUTÉ. Le second n'est retenu que si le
            runner l'a marqué vérifié ; sinon il reste non prouvé. */}
        <Fact
          label="Modèle prouvé au run"
          value={agent?.executedModel ? <FactValue>{agent.executedModel}</FactValue> : null}
          why="Le dernier run n’a pas prouvé le modèle exécuté (run ancien, ou runner qui ne l’a pas marqué vérifié). Non prouvé n’est pas faux."
        />
        <Fact
          label="Dernier run"
          value={isoShort(agent?.lastRunAt ?? null) ? <FactValue>{isoShort(agent?.lastRunAt ?? null)}</FactValue> : null}
          why="Aucun run d’opérateur n’a été enregistré pour cet agent."
          hint={agent?.lastRunStatus ?? undefined}
        />
      </div>
    </Panel>
  )
}

function RunsPanel({ detail }: { detail: AgentDetail }) {
  const { runs } = detail

  return (
    <Panel
      title="Runs récents"
      hint={`${runs.length} lus`}
      className="min-h-0"
      padded={false}
      bodyClassName="scroll-thin overflow-y-auto px-4 py-2"
    >
      {runs.length === 0 ? (
        <Unavailable reason="no-data" detail="Aucun run n’est enregistré pour cet agent." />
      ) : (
        <ul className="flex flex-col gap-1">
          {runs.slice(0, 25).map((run) => (
            <li key={run.id} className="flex min-w-0 items-center gap-2 border-b border-zinc-950/5 py-1 last:border-b-0 dark:border-white/5">
              <Text className="shrink-0 tabular-nums">{isoShort(run.startedAt) ?? '—'}</Text>
              <Text className="min-w-0 flex-1 truncate" title={run.inputSummary}>
                {run.userLabel || run.inputSummary || run.id}
              </Text>
              {run.unsafeAttemptCount > 0 ? (
                <Badge color="red" title="Tentatives d’action non sûres pendant ce run.">
                  {run.unsafeAttemptCount} unsafe
                </Badge>
              ) : null}
              <Text className="shrink-0 tabular-nums">
                {run.costUsd === null ? <NotMeasured why="Le coût de ce run n’a pas pu être mesuré." /> : formatUsd(run.costUsd)}
              </Text>
              <Badge
                color={
                  run.status === 'completed'
                    ? 'emerald'
                    : run.status === 'failed'
                      ? 'red'
                      : run.status === 'running'
                        ? 'sky'
                        : 'amber'
                }
              >
                {run.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ─────────────────── Versions, suites, livraison, télémétrie ─────────────────── */

function VersionsPanel({ detail }: { detail: AgentDetail }) {
  const { versions, currentVersion, copilot } = detail

  return (
    <Panel
      title="Versions"
      hint={`${versions.length} persistée(s)`}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {versions.length === 0 ? (
        <Unavailable reason="no-data" detail="Aucune version n’est persistée pour ce copilot." />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {versions.map((v) => {
            // Le blob `scores` n'est une MESURE que si `scoresEvidence === 'runs'`.
            // Sinon c'est la ligne de base stockée, qui ne prouve rien — et
            // l'afficher comme un score serait un faux zéro.
            const measured = v.scoresEvidence === 'runs'
            return (
              <li key={v.id} className="flex min-w-0 items-center gap-2">
                <Strong className="shrink-0">{v.label}</Strong>
                <Badge color={v.stage === 'production' ? 'emerald' : 'zinc'}>{v.stage}</Badge>
                {v.id === copilot.productionVersionId ? (
                  <Badge color="emerald" title="Version qui sert réellement la production.">
                    en service
                  </Badge>
                ) : null}
                {v.id === currentVersion?.id && v.id !== copilot.productionVersionId ? (
                  <Badge color="sky" title="Version courante résolue (dernière), pas nécessairement celle qui sert.">
                    courante
                  </Badge>
                ) : null}
                <span className="min-w-0 flex-1" />
                <Text className="shrink-0 tabular-nums">
                  {measured && v.scores.testPassRate !== null ? (
                    formatPercent(v.scores.testPassRate)
                  ) : (
                    <NotMeasured why="Aucun score adossé à des runs réels n’est attaché à cette version — la ligne de base stockée n’est pas une mesure." />
                  )}
                </Text>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function SuitesPanel({ detail }: { detail: AgentDetail }) {
  const { testSuites, benchmarkSuites } = detail

  return (
    <Panel title="Tests & benchmarks" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
      <div className="flex flex-col gap-3">
        <div>
          <Subheading level={3}>Suites de test</Subheading>
          {testSuites.length === 0 ? (
            <Text className="mt-1">Aucune suite de test générée.</Text>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {testSuites.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2">
                  <Text className="min-w-0 flex-1 truncate">{s.name}</Text>
                  <Badge color="zinc">{s.kind}</Badge>
                  <Badge color="zinc">{s.caseIds.length} cas</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Subheading level={3}>Suites de benchmark</Subheading>
          {benchmarkSuites.length === 0 ? (
            <Text className="mt-1">Aucune suite de benchmark générée.</Text>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {benchmarkSuites.map((s) => (
                <li key={s.id} className="flex min-w-0 items-center gap-2">
                  <Text className="min-w-0 flex-1 truncate">{s.name}</Text>
                  <Badge color="zinc">{s.taskCount} tâches</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  )
}

function DeliveryPanel({ detail }: { detail: AgentDetail }) {
  const { delivery } = detail

  return (
    <Panel title="Livraison" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
      {delivery === null ? (
        <Unavailable
          reason="no-data"
          detail="Cet agent n’a jamais été livré — aucune poussée vers un dépôt consommateur."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color="zinc">{delivery.mode}</Badge>
            <Badge color="zinc">{delivery.status}</Badge>
          </div>
          <Fact label="Dépôt cible" value={<FactValue>{delivery.targetRepo}</FactValue>} />
          <Fact label="Branche" value={<FactValue>{delivery.deliveryBranch ?? delivery.targetBranch}</FactValue>} />
          {delivery.prUrl ? (
            <div>
              <Text className="text-xs">Pull request</Text>
              {/* Lien EXTERNE et vivant — jamais réécrit en route locale. */}
              <Link href={delivery.prUrl} className="underline">
                {delivery.prNumber ? `#${delivery.prNumber}` : delivery.prUrl}
              </Link>
            </div>
          ) : null}
          {/* LIVRÉ ≠ DÉPLOYÉ : une poussée ne prouve rien sur ce que le
              consommateur en a fait. */}
          <Text className="text-xs">
            Une livraison prouve qu’Aigent a poussé un commit ou ouvert une PR. Elle ne prouve pas
            que le consommateur l’a mergée, déployée, ni même regardée.
          </Text>
        </div>
      )}
    </Panel>
  )
}

function TelemetryPanel({ detail }: { detail: AgentDetail }) {
  const { telemetry } = detail

  return (
    <Panel
      title="Télémétrie runtime"
      hint={telemetry ? `${telemetry.totalRuns} run(s) rapporté(s)` : undefined}
      className="min-h-0"
      bodyClassName="scroll-thin overflow-y-auto"
    >
      {/* `null` = la LECTURE a échoué, jamais « l'agent n'a rien rapporté ». Un
          agent à zéro événement obtient un vrai résumé avec `totalRuns: 0`. */}
      {telemetry === null ? (
        <Unavailable
          reason="unread"
          detail="Le canal de télémétrie n’a pas pu être lu. Ce n’est pas « aucun run rapporté » — c’est une absence de lecture."
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Fact label="Runs rapportés" value={<FactValue>{telemetry.totalRuns}</FactValue>} />
          <Fact label="Terminés" value={<FactValue>{telemetry.completedRuns}</FactValue>} />
          <Fact label="Échoués" value={<FactValue>{telemetry.failedRuns}</FactValue>} />
          <Fact
            label="Taux de succès"
            value={telemetry.successRate === null ? null : <FactValue>{formatPercent(telemetry.successRate)}</FactValue>}
            why="Aucun run terminal dans la fenêtre — rien sur quoi calculer un taux."
          />
          <Fact
            label="Latence p95"
            value={telemetry.p95LatencyMs === null ? null : <FactValue>{Math.round(telemetry.p95LatencyMs)} ms</FactValue>}
            why="Aucune latence n’a été rapportée."
          />
          <Fact
            label="Coût cumulé"
            value={telemetry.totalCostUsd === null ? null : <FactValue>{formatUsd(telemetry.totalCostUsd)}</FactValue>}
            why="Aucun événement de la fenêtre ne portait assez d’information (provider + modèle + tokens) pour être valorisé. Un coût non calculable n’est pas un coût nul."
            hint={telemetry.costEstimated ? 'estimation conservatrice, jamais une facture' : undefined}
          />
          <Fact
            label="Dernier événement"
            value={isoShort(telemetry.lastSeenAt) ? <FactValue>{isoShort(telemetry.lastSeenAt)}</FactValue> : null}
            why="Aucun événement de télémétrie n’a jamais été reçu pour cet agent."
          />
        </div>
      )}
    </Panel>
  )
}

function ConfigurationPanel({ detail }: { detail: AgentDetail }) {
  const { manifest, agent } = detail

  return (
    <Panel title="Configuration" className="min-h-0" bodyClassName="scroll-thin overflow-y-auto">
      {manifest === undefined ? (
        <Unavailable
          reason="no-data"
          detail="Aucun manifeste ne résout pour ce copilot — c’est en soi une exigence dure manquante."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Fact
              label="Politique de confirmation"
              value={<FactValue>{manifest.confirmationPolicy}</FactValue>}
            />
            <Fact label="Étapes max / run" value={<FactValue>{manifest.maxStepsPerRun}</FactValue>} />
            <Fact
              label="Nature des outils"
              value={
                agent && isUnavailable(agent, 'readOnly') ? null : (
                  <Badge color={agent?.readOnly ? 'emerald' : 'amber'}>
                    {agent?.readOnly ? 'lecture seule prouvée' : 'au moins un outil mutant'}
                  </Badge>
                )
              }
              why="La nature des outils montés est inconnaissable (aucun manifeste, ou un niveau de risque hors du vocabulaire du schéma). Ce n’est pas « lecture seule »."
            />
            <Fact
              label="Approbation humaine"
              value={
                agent && isUnavailable(agent, 'requiresHumanApproval') ? null : (
                  <Badge color="zinc">{agent?.requiresHumanApproval ? 'requise' : 'non requise'}</Badge>
                )
              }
              why="Politique inconnue — fail-closed, l’approbation est présumée requise."
            />
          </div>

          {manifest.systemPromptSummary ? (
            <div>
              <Text className="text-xs">Résumé du prompt système</Text>
              <Text className="mt-0.5">{manifest.systemPromptSummary}</Text>
            </div>
          ) : null}

          {manifest.forbiddenActions.length > 0 ? (
            <div>
              <Text className="text-xs">Actions interdites</Text>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {manifest.forbiddenActions.map((a) => (
                  <li key={a}>
                    <Badge color="red">{a}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {agent && agent.capabilities.length > 0 ? (
            <div>
              <Text className="text-xs">Compétences déclarées</Text>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {agent.capabilities.map((c) => (
                  <li key={c}>
                    <Badge color="zinc">{c}</Badge>
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

/* ─────────────────────────── Écran ─────────────────────────── */

export default function AgentDetailScreen({
  detail,
  gate,
  gateFailure,
  qualification,
  qualificationFailure,
}: {
  detail: AgentDetail
  gate: ReleaseGate | null
  gateFailure: string | null
  qualification: QualificationRun | null
  qualificationFailure: string | null
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <DetailHeader detail={detail} />

      {/* Grille dense : chaque panneau borne sa hauteur, seule sa liste défile. */}
      <div className="grid min-h-0 grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
        <ExecutabilityPanel detail={detail} />
        <MetricsPanel detail={detail} />
        <ToolsPanel detail={detail} />
        <ReleaseGatePanel gate={gate} gateFailure={gateFailure} />
        <QualificationPanel run={qualification} failure={qualificationFailure} />
        <LifecyclePanel detail={detail} />
        <VersionsPanel detail={detail} />
        <RunsPanel detail={detail} />
        <SuitesPanel detail={detail} />
        <DeliveryPanel detail={detail} />
        <TelemetryPanel detail={detail} />
        <ConfigurationPanel detail={detail} />
      </div>
    </div>
  )
}
