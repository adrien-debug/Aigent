/**
 * Fiche d'un agent — page produit, sections longues, scroll document naturel.
 *
 * Server Component pur : il reçoit `AgentDetail` plus la gate de release et les
 * distribue sans recalculer les verdicts canoniques. Le détail complet vient
 * par disclosure progressive : overview, activity, qualification, configuration.
 */
import type { ComponentProps, ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Divider } from '@/components/ui/divider'
import { Heading, Subheading } from '@/components/ui/heading'
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
import {
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

function Surface({
  children,
  className = '',
}: Readonly<{
  children: ReactNode
  className?: string
}>) {
  return <div className={`rounded-2xl border border-zinc-950/6 bg-white shadow-sm ${className}`}>{children}</div>
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
      <div className="max-w-3xl">
        <Text className="text-sm font-medium text-zinc-500">{title}</Text>
        <Subheading level={2} className="mt-1">
          {title}
        </Subheading>
        <Text className="mt-2 text-base/7 text-zinc-600">{description}</Text>
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
      <Text className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</Text>
      <div className="mt-1 min-w-0 wrap-break-word">{value ?? <NotMeasured />}</div>
      {hint ? <Text className="mt-1 text-xs text-zinc-500">{hint}</Text> : null}
    </div>
  )
}

function InlineStatus({ tone, children }: Readonly<{ tone: Tone; children: ReactNode }>) {
  const classes =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-zinc-600'
  return <Text className={classes}>{children}</Text>
}

function OverviewHeader({ detail }: Readonly<{ detail: AgentDetail }>) {
  const { copilot, agent, project } = detail

  return (
    <header className="flex flex-col gap-5 border-b border-zinc-950/6 pb-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <Link href="/agents" className="text-sm text-zinc-500 underline-offset-4 hover:underline">
          Agents
        </Link>

        <div className="mt-4 flex min-w-0 items-start gap-4">
          <Avatar
            square
            initials={initialsOf(copilot.name)}
            className="size-12 shrink-0 bg-zinc-950/3 text-zinc-700 outline-zinc-950/10"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Heading level={1} className="min-w-0 truncate">
                {copilot.name}
              </Heading>
              {agent ? <RuntimeStatusBadge status={agent.status} /> : <Badge color="red">hors catalogue</Badge>}
              <LifecycleStatusBadge status={copilot.status} />
            </div>
            <Text className="mt-2 max-w-3xl text-base/7 text-zinc-600">
              {agent?.description ?? copilot.description ?? 'Aucune description disponible pour cet agent.'}
            </Text>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {project ? <Badge color="zinc">{project.name}</Badge> : <Badge color="zinc">banc de validation</Badge>}
              {agent ? <ProviderBadge provider={agent.provider} /> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button outline href={`/qualification/${copilot.id}`}>
          Qualification
        </Button>
        <Button color="dark/zinc" href={`/delivery/${copilot.id}`}>
          Livraison
        </Button>
      </div>
    </header>
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
        title="Overview"
        description="Identite, projet cible, runtime et etat de service. Cette section repond a la question : que sert cet agent aujourd'hui et dans quel etat ?"
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
              label="Modele configure"
              value={agent && !isUnavailable(agent, 'configuredModel') ? <Strong>{agent.configuredModel}</Strong> : null}
            />
            <DetailField
              label="Modele prouve"
              value={agent?.executedModel ? <Strong>{agent.executedModel}</Strong> : null}
            />
            <DetailField
              label="Assistant LangGraph"
              value={
                agent && agent.runtimeProvisioned !== null ? (
                  <Badge color={agent.runtimeProvisioned ? 'emerald' : 'amber'}>
                    {agent.runtimeProvisioned ? 'provisionne' : 'manquant'}
                  </Badge>
                ) : (
                  null
                )
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
            <Badge color="zinc">{reachedCount}/{lifecycle.stages.length} etapes atteintes</Badge>
          </div>

          <div className="mt-4 space-y-3">
            <InlineStatus tone={detail.blockers.length > 0 ? 'danger' : 'default'}>
              {detail.blockers.length > 0
                ? `${detail.blockers.length} obstacle(s) concret(s) empechent un lancement.`
                : 'Aucun obstacle runtime connu a ce stade.'}
            </InlineStatus>
            {detail.blockers.length > 0 ? (
              <ul className="space-y-2">
                {detail.blockers.slice(0, 3).map((blocker) => (
                  <li key={blocker.code} className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                    <Strong className="block">{blocker.label}</Strong>
                    <Text className="mt-1 text-sm text-red-700">{blocker.detail}</Text>
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
              hint={delivery ? delivery.status : 'Aucune poussee ou PR consumer enregistree.'}
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
          title: 'Derniere telemetrie',
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
          title: 'Derniere livraison',
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
        title="Activity"
        description="Derniers runs et evenements importants. L'objectif ici est de voir ce qui s'est passe recemment avant de rentrer dans les preuves detaillees."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Surface>
          <div className="border-b border-zinc-950/6 px-5 py-4">
            <Subheading level={3}>Derniers runs</Subheading>
            <Text className="mt-1">
              Les runs sont listes avant toute interpretation secondaire.
            </Text>
          </div>

          <div className="grid gap-4 border-b border-zinc-950/6 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4">
            <DetailField label="Runs 24 h" value={<Strong>{metrics.runs24h}</Strong>} />
            <DetailField
              label="Succes"
              value={metrics.successRate === null ? null : <Strong>{formatPercent(metrics.successRate)}</Strong>}
            />
            <DetailField
              label="Latence moyenne"
              value={metrics.avgDurationMs === null ? null : <Strong>{Math.round(metrics.avgDurationMs)} ms</Strong>}
            />
            <DetailField
              label="Cout 24 h"
              value={metrics.cost24hUsd === null ? null : <Strong>{formatUsd(metrics.cost24hUsd)}</Strong>}
            />
          </div>

          <div className="px-5 py-2">
            {runs.length === 0 ? (
              <div className="py-8">
                <Unavailable reason="no-data" detail="Aucun run n'est enregistre pour cet agent." />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-950/6">
                {runs.slice(0, 12).map((run) => (
                  <li key={run.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Strong className="truncate">{run.userLabel || run.inputSummary || run.id}</Strong>
                        <Badge color={runStatusColor(run.status)}>{run.status}</Badge>
                        {run.unsafeAttemptCount > 0 ? <Badge color="red">{run.unsafeAttemptCount} unsafe</Badge> : null}
                      </div>
                      <Text className="mt-1 truncate">
                        {isoShort(run.startedAt) ?? 'date inconnue'} UTC
                      </Text>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm text-zinc-500">
                      <span>{run.latencyMs === null ? <NotMeasured /> : formatDuration(run.latencyMs)}</span>
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
              <li key={event.key} className="border-l border-zinc-950/10 pl-4">
                <Strong className="block">{event.title}</Strong>
                <Text className="mt-1 text-sm text-zinc-600">{event.detail}</Text>
              </li>
            ))}
          </ul>
          <Divider soft className="my-5" />
          <DetailField
            label="Appels d'outils"
            value={
              metrics.toolCallCountState === 'MEASURED' ? <Strong>{metrics.toolCallCount}</Strong> : null
            }
            hint={metricsToolCallHint(metrics.toolCallCountState, metrics.toolCallCount, metrics.completedRuns)}
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

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Qualification"
        description="Confiance, tests et preuves de promotion. Cette section distingue ce qui passe, ce qui echoue et ce qui n'a jamais ete mesure."
        action={<Button outline href={`/qualification/${detail.copilot.id}`}>Ouvrir la surface complete</Button>}
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
                    : "Aucune version candidate ne resout pour ce copilot."
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
              <ul className="divide-y divide-zinc-950/6">
                {sortChecks(gate.checks).map((check) => (
                  <li key={check.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Strong className="block">{check.label}</Strong>
                      <Text className="mt-1 text-sm text-zinc-600">
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
          {qualificationFailure !== null ? (
            <div className="mt-4">
              <Unavailable reason="unread" detail={`Lecture impossible : ${qualificationFailure}`} />
            </div>
          ) : qualification === null ? (
            <div className="mt-4 space-y-4">
              <Unavailable
                reason="no-data"
                detail="Aucune qualification n'a ete lancee pour la version courante."
              />
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={qualificationStatusColor(qualification.status)}>{qualification.status}</Badge>
                <Badge color={qualification.policy.requireShadow ? 'amber' : 'zinc'}>
                  shadow {qualification.policy.requireShadow ? 'exige' : 'non exige'}
                </Badge>
                <Badge color={qualification.policy.requireReplay ? 'amber' : 'zinc'}>
                  replay {qualification.policy.requireReplay ? 'exige' : 'non exige'}
                </Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <DetailField label="Suites de test" value={<Strong>{detail.testSuites.length}</Strong>} />
                <DetailField label="Suites benchmark" value={<Strong>{detail.benchmarkSuites.length}</Strong>} />
              </div>
              {qualification.steps.length === 0 ? (
                <Text>Aucune etape ne porte encore de verdict exploitable.</Text>
              ) : (
                <ul className="divide-y divide-zinc-950/6">
                  {qualification.steps.map((step) => (
                    <li key={step.step + '-' + step.at} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <Strong className="block">{step.step}</Strong>
                        <Text className="mt-1 text-sm text-zinc-600">{step.reason}</Text>
                      </div>
                      <Badge color={qualificationStepColor(step.status)} title={step.sourceOfTruth}>
                        {step.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Configuration"
        description="Outils, modele et parametres de fonctionnement. Cette section montre ce qui est monte aujourd'hui, pas toutes les metadonnees historiques."
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Surface className="p-5">
          <Subheading level={3}>Parametres actifs</Subheading>
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
              <DetailField label="Etapes max / run" value={<Strong>{manifest.maxStepsPerRun}</Strong>} />
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
                    <Badge color="zinc">{agent?.requiresHumanApproval ? 'requise' : 'non requise'}</Badge>
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
                value={agent && agent.capabilities.length > 0 ? <Strong>{agent.capabilities.length}</Strong> : null}
              />
            </div>
          )}

          {manifest?.systemPromptSummary ? (
            <>
              <Divider soft className="my-5" />
              <Text className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Resume du prompt systeme
              </Text>
              <Text className="mt-2 text-zinc-600">{manifest.systemPromptSummary}</Text>
            </>
          ) : null}
        </Surface>

        <Surface>
          <div className="border-b border-zinc-950/6 px-5 py-4">
            <Subheading level={3}>Outils montes</Subheading>
            <Text className="mt-1">
              {agent ? toolsCountHint(resolvedTools.length, unresolvedIds.length) : "Outils non resolus"}
            </Text>
          </div>

          <div className="px-5 py-4">
            {agent === undefined ? (
              <Unavailable
                reason="unread"
                detail="Aucune ligne canonique ne resout pour ce copilot — la liste d'outils montee ne peut pas etre etablie."
              />
            ) : resolvedTools.length === 0 && unresolvedIds.length === 0 ? (
              <Unavailable reason="no-data" detail="Le manifeste ne declare aucun outil." />
            ) : (
              <div className="space-y-4">
                {unresolvedIds.length > 0 ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
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
                  <ul className="divide-y divide-zinc-950/6">
                    {resolvedTools.map((tool) => (
                      <li key={tool.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <Strong className="block truncate">{tool.name}</Strong>
                          <Text className="mt-1 text-sm text-zinc-600">
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
                      <Text className="text-xs font-medium uppercase tracking-wide text-zinc-500">
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
            )}
          </div>
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
    <div className="mx-auto flex max-w-6xl flex-col gap-10 p-6 pt-16 lg:pt-8">
      <OverviewHeader detail={detail} />
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
    </div>
  )
}
