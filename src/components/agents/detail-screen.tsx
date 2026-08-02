/**
 * Fiche d'un agent — page produit, sections longues, scroll document naturel.
 *
 * Server Component pur : il reçoit `AgentDetail` plus la gate de release et les
 * distribue sans recalculer les verdicts canoniques. Le détail complet vient
 * par disclosure progressive : overview, activity, qualification, configuration.
 */
import type { ComponentProps, ReactNode } from 'react'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { UNAVAILABLE_LABEL, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { formatDuration } from '@/lib/runs-console/runs-metrics'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { QualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import {
  GateStatusBadge,
  LifecycleStatusBadge,
  NotMeasured,
  ProviderBadge,
  RuntimeStatusBadge,
  StageBadge,
} from './atoms'
import {
  blockerNature,
  serviceVerdict,
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

type BadgeColor = ComponentProps<typeof Badge>['color']

function qualificationStatusColor(status: QualificationRun['status']): BadgeColor {
  if (status === 'promotable') return 'emerald'
  if (status === 'blocked') return 'red'
  return 'zinc'
}

function qualificationStepColor(status: string): BadgeColor {
  if (status === 'PASS') return 'emerald'
  if (status === 'FAIL') return 'red'
  return 'amber'
}

function runStatusColor(status: string): BadgeColor {
  if (status === 'completed') return 'emerald'
  if (status === 'failed') return 'red'
  if (status === 'running') return 'sky'
  return 'amber'
}

function toolRiskBadgeColor(riskLevel: string): BadgeColor {
  if (riskLevel === 'high' || riskLevel === 'critical') return 'red'
  return 'zinc'
}

function toolsCountHint(resolved: number, unresolved: number): string {
  return resolved + ' résolu(s) · ' + unresolved + ' non résolu(s)'
}

function metricsToolCallHint(
  state: AgentDetail['metrics']['toolCallCountState'],
  toolCallCount: number | null,
  completedRuns: number,
): string | undefined {
  if (state !== 'MEASURED') return undefined
  if (toolCallCount === 0) {
    return (
      'mesuré sur ' +
      completedRuns +
      ' run(s) terminé(s) — un agent qui termine sans appeler d’outil peut tourner contre le graphe nu'
    )
  }
  return 'mesuré sur ' + completedRuns + ' run(s) terminé(s)'
}

type Tone = 'default' | 'danger' | 'warning'

function SectionHeader({
  title,
  description,
  action,
}: Readonly<{
  title: string
  description: string
  action?: ReactNode
}>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      {/* UN seul titre. Le surtitre rendait `title` une deuxième fois juste
          au-dessus du `Subheading` : à l'écran on lisait « Overview /
          Overview », « Activity / Activity ». Un surtitre n'a de sens que
          s'il porte une information que le titre n'a pas — sinon c'est du
          bruit qui double la hauteur de chaque en-tête de section. */}
      <div className="max-w-3xl">
        <Subheading level={2}>{title}</Subheading>
        <Text className="mt-2 aig-text-muted text-base/7">{description}</Text>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function DetailField({
  label,
  value,
  hint,
}: Readonly<{
  label: string
  value: ReactNode | null
  hint?: string
}>) {
  return (
    <div className="min-w-0">
      <Text className="aig-text-faint text-xs font-medium uppercase tracking-wide">{label}</Text>
      <div className="mt-1 min-w-0 wrap-break-word">{value ?? <NotMeasured />}</div>
      {hint ? <Text className="aig-text-faint mt-1 text-xs">{hint}</Text> : null}
    </div>
  )
}

/**
 * Une mesure de fenêtre, à la taille de son importance.
 *
 * `value === null` reste `NotMeasured` — la garde est DANS la fonction, comme
 * dans `DetailField`, donc aucun appelant ne peut l'oublier et aucun `0` ne
 * peut s'y substituer. L'absence n'emprunte PAS la taille du grand chiffre :
 * un « indisponible » à 36 px se lirait comme une mesure.
 */
function Metric({
  label,
  value,
  hint,
}: Readonly<{
  label: string
  value: ReactNode | null
  hint?: string
}>) {
  return (
    <div className="min-w-0">
      {value === null ? (
        <div className="pt-1">
          <NotMeasured />
        </div>
      ) : (
        <div className="aig-display truncate text-2xl font-semibold sm:text-3xl">{value}</div>
      )}
      <Text className="aig-text-muted mt-1 truncate text-sm">{label}</Text>
      {hint ? <Text className="aig-text-faint mt-0.5 text-xs">{hint}</Text> : null}
    </div>
  )
}

/**
 * Teintes remontées d'un cran (600/700 → 400) : elles étaient calibrées pour un
 * fond blanc et passaient sous le seuil de lisibilité sur le graphite. Le
 * neutre passe par la grammaire, les deux tons de gravité restent explicites —
 * un statut « danger » ne doit jamais se confondre avec un texte secondaire.
 */
function InlineStatus({ tone, children }: Readonly<{ tone: Tone; children: ReactNode }>) {
  const color = tone === 'danger' ? SEVERITY.bad : tone === 'warning' ? SEVERITY.warn : undefined
  return (
    <Text className={tone === 'default' ? 'aig-text-muted' : undefined} style={color ? { color } : undefined}>
      {children}
    </Text>
  )
}

/**
 * L'en-tête de la fiche, porté par `PageHeader`.
 *
 * L'écran ne recompose plus sa propre hiérarchie typographique : le titre, la
 * description et les actions passent par le contrat commun du shell. Ce qui est
 * PROPRE à cette fiche — l'avatar, le lien de retour, les badges de statut et de
 * rattachement — vit dans `meta`, la rangée prévue pour le contexte de page.
 * Rien n'est retiré de l'affichage : c'est le même contenu, dans le cadre
 * unique.
 */
function OverviewHeader({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { copilot, agent, project } = detail

  return (
    <PageHeader
      title={copilot.name}
      description={
        agent?.description ?? copilot.description ?? 'Aucune description disponible pour cet agent.'
      }
      actions={
        <>
          <Button outline href={`/qualification/${copilot.id}`}>
            Qualification
          </Button>
          <Button color="dark/zinc" href={`/delivery/${copilot.id}`}>
            Livraison
          </Button>
        </>
      }
      meta={
        <>
          {/* Avatar posé au palier `raised` : le peint-pour-fond-blanc
              (`bg-zinc-950/3`) devenait invisible sur graphite. */}
          <Avatar
            square
            initials={initialsOf(copilot.name)}
            className="aig-raised size-8 shrink-0 outline-0"
          />
          <Link
            href="/agents"
            className="aig-text-muted text-sm underline-offset-4 hover:underline"
          >
            Agents
          </Link>
          {agent ? (
            <RuntimeStatusBadge status={agent.status} />
          ) : (
            <Badge color="red">hors catalogue</Badge>
          )}
          <LifecycleStatusBadge status={copilot.status} />
          <Text className="aig-text-faint text-xs">
            {project ? project.name : 'banc de validation'}
          </Text>
          {agent ? <ProviderBadge provider={agent.provider} /> : null}
        </>
      }
    />
  )
}

/**
 * L'ÉTAT DE SERVICE — la zone dominante de la fiche.
 *
 * Cette page empilait quatre sections de panneaux de rang strictement égal :
 * l'information qui décide de tout — cet agent peut-il partir, et sinon
 * pourquoi — avait le même poids visuel qu'une liste de métadonnées. Elle prend
 * la scène, avec le verdict en grand et les obstacles montés d'un palier.
 *
 * Rien n'est retiré : les six champs d'identité, les badges de cycle de vie et
 * la ligne de livraison sont tous rendus, au second rang.
 */
function OverviewSection({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { agent, project, currentVersion, delivery, lifecycle } = detail
  const consumerStage = lifecycle.stages.find((stage) => stage.key === 'active_in_consumer')
  const consumerDisplay = consumerStage ? stageDisplay(consumerStage) : 'unknown'
  const reachedCount = lifecycle.stages.filter((stage) => stageDisplay(stage) === 'reached').length

  /*
   * TROIS VERDICTS, PAS DEUX. `detail.executable` répond « un run peut-il
   * partir ? » — une question binaire dont la réponse est juste. Mais l'écran
   * la peignait telle quelle : toute réponse négative sortait en rouge critique
   * sous « Lancement bloqué », qu'un outil soit réellement inexécutable ou
   * qu'une version n'ait simplement jamais été résolue.
   *
   * `serviceVerdict` distingue la NATURE des obstacles : un fait mesuré et
   * négatif (rouge, mérité) d'une absence de mesure (neutre). Le contrat de
   * données n'est pas touché — `detail.executable` et `detail.blockers` sont
   * lus tels quels, et TOUS les obstacles restent affichés.
   */
  const verdict = serviceVerdict(detail.blockers, agent?.status)
  const blocked = verdict === 'blocked'
  const unmeasured = verdict === 'unmeasured'

  // Le mot d'absence vient de `UNAVAILABLE_LABEL`, jamais d'un littéral : le
  // produit n'épelle ce mot qu'UNE fois (invariant tenu par `cost-truth.test`).
  const VERDICT_TITLE: Record<typeof verdict, string> = {
    launchable: 'Lançable maintenant',
    blocked: 'Lancement bloqué',
    unmeasured: UNAVAILABLE_LABEL,
  }

  return (
    <section className="aig-stage aig-accent-edge p-5 sm:p-6" aria-label="État de service">
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        {/* Le verdict — le seul grand caractère de la fiche. */}
        <div className="min-w-0 xl:w-[22rem] xl:shrink-0">
          <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
            État de service
          </Text>

          {/* Seul un blocage PROUVÉ prend la couleur de sévérité. Une absence
              reste dans le graphite du texte : elle se lit, elle n'alarme pas. */}
          <p
            className="aig-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
            style={blocked ? { color: SEVERITY.bad } : undefined}
          >
            {VERDICT_TITLE[verdict]}
          </p>

          {unmeasured ? (
            <Text className="aig-text-muted mt-1 text-sm">
              Aucune mesure runtime disponible pour cet agent.
            </Text>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StageBadge
              display={consumerDisplay}
              title={consumerStage ? STAGE_DISPLAY_MEANING[consumerDisplay] : undefined}
            />
            <Badge color="zinc">
              {reachedCount}/{lifecycle.stages.length} etapes atteintes
            </Badge>
          </div>

          <div className="mt-4">
            <InlineStatus tone={blocked ? 'danger' : 'default'}>
              {blocked
                ? `${detail.blockers.length} obstacle(s) concret(s) empechent un lancement.`
                : unmeasured
                  ? `${detail.blockers.length} prérequis non mesuré(s) — rien n’a échoué, rien n’a été lu.`
                  : 'Aucun obstacle runtime connu a ce stade.'}
            </InlineStatus>
          </div>

          {/* Un obstacle DOIT ressortir : `aig-panel-raised` monte la boîte
              d'un palier, le liseré rouge porte la gravité. Le couple
              `border-red-200 / bg-red-50` était un aplat pâle pensé pour un
              fond blanc — sur graphite il éblouissait.
              CHAQUE obstacle porte désormais SA propre nature : dans un agent
              `degraded`, l'outil inexécutable est rouge et le prérequis non
              résolu qui l'accompagne reste neutre. Peindre toute la liste en
              rouge parce qu'un seul élément est prouvé serait la même faute à
              une échelle plus fine. */}
          {detail.blockers.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {detail.blockers.slice(0, 3).map((blocker) => {
                const proven = blockerNature(blocker.code, agent?.status) === 'proven'
                return (
                  <li key={blocker.code} className="aig-line border-l pl-3">
                    <Strong className="block">{blocker.label}</Strong>
                    <Text
                      className={proven ? 'mt-1 text-sm' : 'aig-text-muted mt-1 text-sm'}
                      style={proven ? { color: SEVERITY.bad } : undefined}
                    >
                      {blocker.detail}
                    </Text>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        {/* L'identité au second rang, dans un creux qui l'accueille : elle
            situe l'agent, elle ne décide de rien. */}
        <div className="aig-inset min-w-0 flex-1 p-4 sm:p-5">
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <DetailField label="Projet" value={project ? <Strong>{project.name}</Strong> : null} />
            <DetailField
              label="Runtime"
              value={agent?.runtime ? <Strong>{agent.runtime}</Strong> : null}
            />
            <DetailField
              label="Version"
              value={currentVersion ? <Strong>{currentVersion.label}</Strong> : null}
              hint={currentVersion?.stage ?? undefined}
            />
            <DetailField
              label="Modèle configuré"
              value={
                agent && !isUnavailable(agent, 'configuredModel') ? (
                  <Strong>{agent.configuredModel}</Strong>
                ) : null
              }
            />
            <DetailField
              label="Modèle prouvé"
              value={agent?.executedModel ? <Strong>{agent.executedModel}</Strong> : null}
            />
            <DetailField
              label="Assistant LangGraph"
              value={
                agent && agent.runtimeProvisioned !== null ? (
                  <Badge color={agent.runtimeProvisioned ? 'emerald' : 'amber'}>
                    {agent.runtimeProvisioned ? 'provisionne' : 'manquant'}
                  </Badge>
                ) : null
              }
            />
          </div>

          <div className="aig-hairline my-4" />

          <DetailField
            label="Livraison"
            value={
              delivery ? <Strong>{delivery.targetRepo}</Strong> : <Badge color="zinc">jamais livre</Badge>
            }
            hint={delivery ? delivery.status : 'Aucune poussée ou PR consumer enregistrée.'}
          />
        </div>
      </div>
    </section>
  )
}

function ActivitySection({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { runs, metrics, telemetry, lifecycle, delivery } = detail
  const events = [
    metrics.lastRun
      ? {
          key: 'last-run',
          title: 'Dernier run operateur',
          detail: `${isoShort(metrics.lastRun.startedAt) ?? 'date inconnue'} · ${metrics.lastRun.status}`,
        }
      : null,
    telemetry
      ? {
          key: 'telemetry',
          title: 'Dernière télémétrie',
          detail:
            telemetry.lastSeenAt === null
              ? 'Aucun evenement runtime rapporte'
              : `${isoShort(telemetry.lastSeenAt) ?? telemetry.lastSeenAt} · ${telemetry.totalRuns} run(s) rapportes`,
        }
      : {
          key: 'telemetry-unread',
          title: 'Telemetrie runtime',
          detail: 'Lecture impossible du canal de telemetrie',
        },
    delivery
      ? {
          key: 'delivery',
          title: 'Dernière livraison',
          detail: `${delivery.targetRepo} · ${delivery.status}`,
        }
      : null,
    ...lifecycle.stages
      .filter((stage) => {
        const display = stageDisplay(stage)
        return display === 'reached' || display === 'unavailable'
      })
      .slice(0, 2)
      .map((stage) => ({
        key: stage.key,
        title: stage.label,
        detail: stage.evidence.detail,
      })),
  ].filter((item): item is { key: string; title: string; detail: string } => item !== null)

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Activité"
        description="Derniers runs et événements importants. L’objectif ici est de voir ce qui s’est passé récemment avant de rentrer dans les preuves détaillées."
      />

      {/* Les quatre mesures de la fenêtre passent en grands chiffres et
          quittent la boîte de la liste : c'était l'information la plus dense de
          la section, rendue en corps de légende dans un liseré interne. Chaque
          absence garde son rendu propre — `Metric` ne coerce rien. */}
      <div className="aig-quiet grid grid-cols-2 gap-x-6 gap-y-5 p-4 sm:grid-cols-4 sm:p-5">
        <Metric label="Runs 24 h" value={<>{metrics.runs24h}</>} />
        <Metric
          label="Succes"
          value={metrics.successRate === null ? null : <>{formatPercent(metrics.successRate)}</>}
        />
        <Metric
          label="Latence moyenne"
          value={
            metrics.avgDurationMs === null ? null : <>{Math.round(metrics.avgDurationMs)} ms</>
          }
        />
        <Metric
          label="Cout 24 h"
          value={metrics.cost24hUsd === null ? null : <>{formatUsd(metrics.cost24hUsd)}</>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
            <Subheading level={3}>Derniers runs</Subheading>
            <Text className="aig-text-muted text-sm">
              Listés avant toute interprétation secondaire.
            </Text>
          </div>

          {/* Le flux de runs dans un CREUX, à hauteur bornée : la boîte ne
              grandit pas avec la donnée, la donnée défile dedans. */}
          <div className="aig-inset min-h-0 flex-1 overflow-hidden">
            {runs.length === 0 ? (
              <div className="p-4">
                <Unavailable reason="no-data" detail="Aucun run n'est enregistre pour cet agent." />
              </div>
            ) : (
              <ul className="scroll-thin max-h-[26rem] divide-y divide-[color:var(--aig-line-soft)] overflow-y-auto px-4">
                {runs.slice(0, 12).map((run) => (
                  <li key={run.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Strong className="truncate">
                          {run.userLabel || run.inputSummary || run.id}
                        </Strong>
                        <Badge color={runStatusColor(run.status)}>{run.status}</Badge>
                        {run.unsafeAttemptCount > 0 ? (
                          <Badge color="red">{run.unsafeAttemptCount} unsafe</Badge>
                        ) : null}
                      </div>
                      <Text className="mt-1 truncate">
                        {isoShort(run.startedAt) ?? 'date inconnue'} UTC
                      </Text>
                    </div>
                    <div className="flex shrink-0 items-center aig-text-faint gap-3 text-sm">
                      <span>
                        {run.latencyMs === null ? <NotMeasured /> : formatDuration(run.latencyMs)}
                      </span>
                      <span>{run.costUsd === null ? <NotMeasured /> : formatUsd(run.costUsd)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0 p-1">
          <Subheading level={3}>Evenements importants</Subheading>
          <div className="aig-hairline my-2" />
          <Text className="aig-text-muted mt-1 text-sm">
            Les signaux qui changent la lecture de la page sans transformer chaque fait en panneau.
          </Text>
          <ul className="mt-4 space-y-4">
            {events.map((event) => (
              <li key={event.key} className="aig-line border-l pl-4">
                <Strong className="block">{event.title}</Strong>
                <Text className="mt-1 aig-text-muted text-sm">{event.detail}</Text>
              </li>
            ))}
          </ul>
          <Divider soft className="my-5" />
          <DetailField
            label="Appels d'outils"
            value={
              metrics.toolCallCountState === 'MEASURED' ? (
                <Strong>{metrics.toolCallCount}</Strong>
              ) : null
            }
            hint={metricsToolCallHint(
              metrics.toolCallCountState,
              metrics.toolCallCount,
              metrics.completedRuns,
            )}
          />
        </div>
      </div>
    </section>
  )
}

function QualificationSection({
  detail,
  gate,
  gateFailure,
  qualification,
  qualificationFailure,
}: Readonly<{
  detail: AgentDetail
  gate: ReleaseGate | null
  gateFailure: string | null
  qualification: QualificationRun | null
  qualificationFailure: string | null
}>) {
  const gateSummary = gate ? summarizeGate(gate.checks) : null

  let testsBody: ReactNode
  if (qualificationFailure !== null) {
    testsBody = (
      <div className="mt-4">
        <Unavailable reason="unread" detail={`Lecture impossible : ${qualificationFailure}`} />
      </div>
    )
  } else if (qualification === null) {
    testsBody = (
      <div className="mt-4 space-y-4">
        <Unavailable
          reason="no-data"
          detail="Aucune qualification n'a été lancée pour la version courante."
        />
      </div>
    )
  } else {
    testsBody = (
      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={qualificationStatusColor(qualification.status)}>
            {qualification.status}
          </Badge>
          <Badge color={qualification.policy.requireShadow ? 'amber' : 'zinc'}>
            shadow {qualification.policy.requireShadow ? 'exige' : 'non exige'}
          </Badge>
          <Badge color={qualification.policy.requireReplay ? 'amber' : 'zinc'}>
            replay {qualification.policy.requireReplay ? 'exige' : 'non exige'}
          </Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailField label="Suites de test" value={<Strong>{detail.testSuites.length}</Strong>} />
          <DetailField
            label="Suites benchmark"
            value={<Strong>{detail.benchmarkSuites.length}</Strong>}
          />
        </div>
        {qualification.steps.length === 0 ? (
          <Text>Aucune étape ne porte encore de verdict exploitable.</Text>
        ) : (
          <ul className="aig-inset scroll-thin max-h-96 divide-y divide-[color:var(--aig-line-soft)] overflow-y-auto px-3">
            {qualification.steps.map((step) => (
              <li
                key={step.step + '-' + step.at}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <Strong className="block">{step.step}</Strong>
                  <Text className="mt-1 aig-text-muted text-sm">{step.reason}</Text>
                </div>
                <Badge color={qualificationStepColor(step.status)} title={step.sourceOfTruth}>
                  {step.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Qualification"
        description="Confiance, tests et preuves de promotion. Cette section distingue ce qui passe, ce qui échoue et ce qui n’a jamais été mesuré."
        action={
          <Button outline href={`/qualification/${detail.copilot.id}`}>
            Ouvrir la surface complète
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 p-1">
          <Subheading level={3}>Confiance de release</Subheading>
          <div className="aig-hairline my-2" />
          {gate === null ? (
            <div className="mt-4">
              <Unavailable
                reason={gateFailure ? 'unread' : 'no-data'}
                detail={
                  gateFailure
                    ? `La gate n'a pas pu etre evaluee : ${gateFailure}`
                    : 'Aucune version candidate ne résout pour ce copilot.'
                }
              />
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={gateSummary?.promotable ? 'emerald' : 'red'}>
                  {gateSummary?.promotable ? 'promouvable' : 'non promouvable'}
                </Badge>
                <Text className="aig-text-faint text-xs">
                  {gateSummary?.blocking ?? 0} blocage(s) · candidat {gate.evidence.candidateLabel}
                </Text>
              </div>
              {/* La liste des checks est un flux : elle descend dans un creux
                  à hauteur bornée plutôt que d'allonger la boîte. */}
              <ul className="aig-inset scroll-thin max-h-96 divide-y divide-[color:var(--aig-line-soft)] overflow-y-auto px-3">
                {sortChecks(gate.checks).map((check) => (
                  <li
                    key={check.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <Strong className="block">{check.label}</Strong>
                      <Text className="mt-1 aig-text-muted text-sm">
                        Observe : {check.observed} · Exige : {check.required}
                      </Text>
                    </div>
                    <GateStatusBadge status={check.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="min-w-0 p-1">
          <Subheading level={3}>Tests et preuves</Subheading>
          <div className="aig-hairline my-2" />
          {testsBody}
        </div>
      </div>
    </section>
  )
}

function ConfigurationSection({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { manifest, agent, tools, versions, currentVersion } = detail
  const resolvedTools = agent?.tools ?? []
  const unresolvedIds = agent?.unresolvedToolIds ?? []
  const toolNameById = new Map(tools.map((tool) => [tool.id, tool.name]))

  let mountedToolsBody: ReactNode
  if (agent === undefined) {
    mountedToolsBody = (
      <Unavailable
        reason="unread"
        detail="Aucune ligne canonique ne résout pour ce copilot — la liste d'outils montée ne peut pas être établie."
      />
    )
  } else if (resolvedTools.length === 0 && unresolvedIds.length === 0) {
    mountedToolsBody = (
      <Unavailable reason="no-data" detail="Le manifeste ne declare aucun outil." />
    )
  } else {
    mountedToolsBody = (
      <div className="space-y-4">
        {/* Même règle que les obstacles : la boîte ressort par l'élévation, pas
            par un aplat clair calibré pour un fond blanc. */}
        {unresolvedIds.length > 0 ? (
          <div
            className="aig-panel-raised px-4 py-3"
            style={{ borderColor: 'color-mix(in oklab, var(--aig-severity-bad) 40%, transparent)' }}
          >
            <Strong className="block">
              {unresolvedIds.length} outil(s) declare(s) sans handler executable
            </Strong>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unresolvedIds.map((id) => (
                <Badge key={id} color="red">
                  {toolNameById.get(id) ?? id}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {resolvedTools.length > 0 ? (
          <>
            {/* LES TRAITS CONSTANTS REMONTENT EN TÊTE DE SECTION.
             *
             * Chaque ligne portait deux badges — `lecture seule`/`mutant` et le
             * niveau de risque — répétés à l'identique sur toute la liste : 14
             * fois « lecture seule » et 4 fois « low » sur une seule fiche.
             * Un badge dont la valeur ne varie jamais n'informe pas, il
             * tapisse ; et il vole l'attention aux lignes qui, elles, sortent
             * du lot.
             *
             * La règle appliquée ici : ce qui est VRAI POUR TOUS se dit une
             * fois, en texte, dans l'en-tête. Seule l'EXCEPTION garde un badge.
             * Une liste entièrement homogène perd donc tous ses badges, et une
             * liste mixte n'en garde que sur les lignes qui divergent — ce qui
             * les rend enfin visibles. */}
            {(() => {
              const mutating = resolvedTools.filter((t) => t.mutates)
              const risks = new Set(resolvedTools.map((t) => t.riskLevel))
              const uniformRisk = risks.size === 1 ? [...risks][0] : null
              const traits = [
                mutating.length === 0
                  ? 'lecture seule'
                  : mutating.length === resolvedTools.length
                    ? 'tous mutants'
                    : null,
                uniformRisk ? `risque ${uniformRisk}` : null,
              ].filter(Boolean)

              return traits.length > 0 ? (
                <Text className="aig-text-muted text-sm">{traits.join(' · ')}</Text>
              ) : null
            })()}

            <ul className="divide-y divide-[color:var(--aig-line-soft)]">
              {resolvedTools.map((tool) => {
                const risks = new Set(resolvedTools.map((t) => t.riskLevel))
                const mutatingCount = resolvedTools.filter((t) => t.mutates).length
                // Un badge UNIQUEMENT si cette ligne diverge de la majorité.
                const showMutates =
                  tool.mutates && mutatingCount > 0 && mutatingCount < resolvedTools.length
                const showRisk = risks.size > 1
                return (
                  <li key={tool.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Strong className="block truncate">{tool.name}</Strong>
                      <Text className="mt-1 aig-text-muted text-sm">
                        {tool.enabled ? 'active' : 'desactive'}
                        {tool.requiresConfirmation ? ' · confirmation' : ''}
                      </Text>
                    </div>
                    {showMutates || showRisk ? (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {showMutates ? <Badge color="amber">mutant</Badge> : null}
                        {showRisk ? (
                          <Badge color={toolRiskBadgeColor(tool.riskLevel)}>{tool.riskLevel}</Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </>
        ) : null}

        {manifest && manifest.forbiddenActions.length > 0 ? (
          <>
            <Divider soft />
            <div>
              <Text className="aig-text-faint text-xs font-medium uppercase tracking-wide">
                Actions interdites
              </Text>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {manifest.forbiddenActions.map((action) => (
                  <Badge key={action} color="red">
                    {action}
                  </Badge>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Configuration"
        description="Outils, modèle et paramètres de fonctionnement. Cette section montre ce qui est monté aujourd’hui, pas toutes les métadonnées historiques."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="min-w-0 p-1">
          <Subheading level={3}>Paramètres actifs</Subheading>
          <div className="aig-hairline my-2" />
          {manifest === undefined ? (
            <div className="mt-4">
              <Unavailable
                reason="no-data"
                detail="Aucun manifeste ne resout pour ce copilot — c'est une exigence dure manquante."
              />
            </div>
          ) : (
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <DetailField
                label="Confirmation"
                value={<Strong>{manifest.confirmationPolicy}</Strong>}
              />
              <DetailField
                label="Etapes max / run"
                value={<Strong>{manifest.maxStepsPerRun}</Strong>}
              />
              <DetailField
                label="Nature des outils"
                value={
                  agent && isUnavailable(agent, 'readOnly') ? null : (
                    <Badge color={agent?.readOnly ? 'emerald' : 'amber'}>
                      {agent?.readOnly ? 'lecture seule prouvee' : 'au moins un outil mutant'}
                    </Badge>
                  )
                }
              />
              <DetailField
                label="Approbation humaine"
                value={
                  agent && isUnavailable(agent, 'requiresHumanApproval') ? null : (
                    <Badge color="zinc">
                      {agent?.requiresHumanApproval ? 'requise' : 'non requise'}
                    </Badge>
                  )
                }
              />
              <DetailField
                label="Versions"
                value={<Strong>{versions.length}</Strong>}
                hint={currentVersion ? `courante : ${currentVersion.label}` : undefined}
              />
              <DetailField
                label="Competences"
                value={
                  agent && agent.capabilities.length > 0 ? (
                    <Strong>{agent.capabilities.length}</Strong>
                  ) : null
                }
              />
            </div>
          )}

          {manifest?.systemPromptSummary ? (
            <>
              <Divider soft className="my-5" />
              <Text className="aig-text-faint text-xs font-medium uppercase tracking-wide">
                Resume du prompt systeme
              </Text>
              <Text className="aig-text-muted mt-2">{manifest.systemPromptSummary}</Text>
            </>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
            <Subheading level={3}>Outils montés</Subheading>
            <Text className="aig-text-muted text-sm">
              {agent
                ? toolsCountHint(resolvedTools.length, unresolvedIds.length)
                : 'Outils non résolus'}
            </Text>
          </div>
          <div className="aig-hairline mb-2" />

          {/* Le montage d'outils est une LISTE : creux à hauteur bornée, la
              donnée défile dedans plutôt que d'allonger la page. */}
          <div className="aig-inset scroll-thin max-h-[30rem] min-h-0 flex-1 overflow-y-auto p-4">
            {mountedToolsBody}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function AgentDetailScreen({
  detail,
  gate,
  gateFailure,
  qualification,
  qualificationFailure,
}: Readonly<{
  detail: AgentDetail
  gate: ReleaseGate | null
  gateFailure: string | null
  qualification: QualificationRun | null
  qualificationFailure: string | null
}>) {
  return (
    <>
      {/* `PageHeader` porte déjà la gouttière mobile et le sticky ; `PageBody`
          porte la gouttière commune. Le `mx-auto max-w-6xl` a disparu avec eux :
          une console d'opérateur ne centre pas son contenu dans une colonne
          étroite (voir `PageBody` dans `app-shell.tsx`). */}
      <OverviewHeader detail={detail} />
      <PageBody className="gap-10">
        <OverviewSection detail={detail} />
        <ActivitySection detail={detail} />
        <QualificationSection
          detail={detail}
          gate={gate}
          gateFailure={gateFailure}
          qualification={qualification}
          qualificationFailure={qualificationFailure}
        />
        <ConfigurationSection detail={detail} />
      </PageBody>
    </>
  )
}
