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
import { Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
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
import { sortChecks, stageDisplay, summarizeGate, STAGE_DISPLAY_MEANING } from './evidence-model'
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

function Surface({
  children,
  className = '',
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  // `aig-panel` remplace le trio fond blanc / anneau / ombre codé en dur : le
  // fond, le liseré, le rayon et l'élévation viennent d'un seul jeton, donc
  // cette fiche ne peut plus diverger du roster ni des panneaux du cockpit.
  return <div className={`aig-panel ${className}`}>{children}</div>
}

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
 * Teintes remontées d'un cran (600/700 → 400) : elles étaient calibrées pour un
 * fond blanc et passaient sous le seuil de lisibilité sur le graphite. Le
 * neutre passe par la grammaire, les deux tons de gravité restent explicites —
 * un statut « danger » ne doit jamais se confondre avec un texte secondaire.
 */
function inlineStatusClasses(tone: Tone): string {
  if (tone === 'danger') return 'text-red-400'
  if (tone === 'warning') return 'text-amber-400'
  return 'aig-text-muted'
}

function InlineStatus({ tone, children }: Readonly<{ tone: Tone; children: ReactNode }>) {
  return <Text className={inlineStatusClasses(tone)}>{children}</Text>
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
          {project ? (
            <Badge color="zinc">{project.name}</Badge>
          ) : (
            <Badge color="zinc">banc de validation</Badge>
          )}
          {agent ? <ProviderBadge provider={agent.provider} /> : null}
        </>
      }
    />
  )
}

function OverviewSection({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { agent, project, currentVersion, delivery, lifecycle } = detail
  const consumerStage = lifecycle.stages.find((stage) => stage.key === 'active_in_consumer')
  const consumerDisplay = consumerStage ? stageDisplay(consumerStage) : 'unknown'
  const reachedCount = lifecycle.stages.filter((stage) => stageDisplay(stage) === 'reached').length

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Aperçu"
        description="Identité, projet cible, runtime et état de service. Cette section répond à la question : que sert cet agent aujourd’hui et dans quel état ?"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Surface className="p-5">
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
        </Surface>

        <Surface className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={detail.executable ? 'emerald' : 'red'}>
              {detail.executable ? 'lancable maintenant' : 'lancement bloque'}
            </Badge>
            <StageBadge
              display={consumerDisplay}
              title={consumerStage ? STAGE_DISPLAY_MEANING[consumerDisplay] : undefined}
            />
            <Badge color="zinc">
              {reachedCount}/{lifecycle.stages.length} etapes atteintes
            </Badge>
          </div>

          <div className="mt-4 space-y-3">
            <InlineStatus tone={detail.blockers.length > 0 ? 'danger' : 'default'}>
              {detail.blockers.length > 0
                ? `${detail.blockers.length} obstacle(s) concret(s) empechent un lancement.`
                : 'Aucun obstacle runtime connu a ce stade.'}
            </InlineStatus>
            {/* Un obstacle DOIT ressortir : `aig-panel-raised` monte la boîte
                d'un palier, le liseré rouge porte la gravité. Le couple
                `border-red-200 / bg-red-50` était un aplat pâle pensé pour un
                fond blanc — sur graphite il éblouissait. */}
            {detail.blockers.length > 0 ? (
              <ul className="space-y-2">
                {detail.blockers.slice(0, 3).map((blocker) => (
                  <li key={blocker.code} className="aig-panel-raised border-red-500/40 px-3 py-2">
                    <Strong className="block">{blocker.label}</Strong>
                    <Text className="mt-1 text-sm text-red-400">{blocker.detail}</Text>
                  </li>
                ))}
              </ul>
            ) : null}
            <Divider soft />
            <DetailField
              label="Livraison"
              value={
                delivery ? (
                  <Strong>{delivery.targetRepo}</Strong>
                ) : (
                  <Badge color="zinc">jamais livre</Badge>
                )
              }
              hint={delivery ? delivery.status : 'Aucune poussée ou PR consumer enregistrée.'}
            />
          </div>
        </Surface>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Surface>
          <div className="aig-line-soft border-b px-5 py-4">
            <Subheading level={3}>Derniers runs</Subheading>
            <Text className="mt-1">
              Les runs sont listes avant toute interpretation secondaire.
            </Text>
          </div>

          <div className="grid gap-4 aig-line-soft border-b px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <DetailField label="Runs 24 h" value={<Strong>{metrics.runs24h}</Strong>} />
            <DetailField
              label="Succes"
              value={
                metrics.successRate === null ? null : (
                  <Strong>{formatPercent(metrics.successRate)}</Strong>
                )
              }
            />
            <DetailField
              label="Latence moyenne"
              value={
                metrics.avgDurationMs === null ? null : (
                  <Strong>{Math.round(metrics.avgDurationMs)} ms</Strong>
                )
              }
            />
            <DetailField
              label="Cout 24 h"
              value={
                metrics.cost24hUsd === null ? null : (
                  <Strong>{formatUsd(metrics.cost24hUsd)}</Strong>
                )
              }
            />
          </div>

          <div className="px-5 py-2">
            {runs.length === 0 ? (
              <div className="py-8">
                <Unavailable reason="no-data" detail="Aucun run n'est enregistre pour cet agent." />
              </div>
            ) : (
              <ul className="divide-y divide-white/6">
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
        </Surface>

        <Surface className="p-5">
          <Subheading level={3}>Evenements importants</Subheading>
          <Text className="mt-1">
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
        </Surface>
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
          <ul className="divide-y divide-white/6">
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
        <Surface className="p-5">
          <Subheading level={3}>Confiance de release</Subheading>
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
                {gateSummary && gateSummary.blocking > 0 ? (
                  <Badge color="amber">{gateSummary.blocking} blocage(s)</Badge>
                ) : null}
                <Badge color="zinc">candidat {gate.evidence.candidateLabel}</Badge>
              </div>
              <ul className="divide-y divide-white/6">
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
        </Surface>

        <Surface className="p-5">
          <Subheading level={3}>Tests et preuves</Subheading>
          {testsBody}
        </Surface>
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
          <div className="aig-panel-raised border-red-500/40 px-4 py-3">
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
          <ul className="divide-y divide-white/6">
            {resolvedTools.map((tool) => (
              <li key={tool.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Strong className="block truncate">{tool.name}</Strong>
                  <Text className="mt-1 aig-text-muted text-sm">
                    {tool.enabled ? 'active' : 'desactive'}
                    {tool.requiresConfirmation ? ' · confirmation' : ''}
                  </Text>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge color={tool.mutates ? 'amber' : 'emerald'}>
                    {tool.mutates ? 'mutant' : 'lecture seule'}
                  </Badge>
                  <Badge color={toolRiskBadgeColor(tool.riskLevel)}>{tool.riskLevel}</Badge>
                </div>
              </li>
            ))}
          </ul>
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
        <Surface className="p-5">
          <Subheading level={3}>Paramètres actifs</Subheading>
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
        </Surface>

        <Surface>
          <div className="aig-line-soft border-b px-5 py-4">
            <Subheading level={3}>Outils montés</Subheading>
            <Text className="mt-1">
              {agent
                ? toolsCountHint(resolvedTools.length, unresolvedIds.length)
                : 'Outils non résolus'}
            </Text>
          </div>

          <div className="px-5 py-4">{mountedToolsBody}</div>
        </Surface>
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
