/**
 * Onglet Télémétrie — le canal de retour, et ce qu'il a réellement reçu.
 *
 * LA RÈGLE DE CET ÉCRAN : `null` n'est pas `0`.
 * `summarizeFleetRuntimeTelemetry` rend des `number | null` et une provenance
 * par famille de mesure (`MEASURED` / `UNAVAILABLE` / `NOT_APPLICABLE`). Un
 * coût `null` signifie « aucun run n'a transporté d'usage_metadata », pas
 * « ça n'a rien coûté ». Un `?? 0` posé ici retournerait chaque absence en
 * bonne nouvelle — un coût nul, une latence nulle, une flotte gratuite.
 *
 * En revanche un `0` MESURÉ reste un `0` et s'affiche : zéro événement de
 * source consommateur sur N événements est un fait, et un fait important.
 */
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type {
  RuntimeTelemetryEvent,
  RuntimeTelemetryFleetSummary,
  TelemetryMeasurementState,
} from '@/lib/agent-mission-control/runtime-telemetry-store'
import type {
  TelemetryHealthDiagnostic,
  TelemetryHealthStatus,
} from '@/lib/agent-mission-control/telemetry-health'
import type { TelemetryTabData } from './server-reads'
import { Fact, FactValue, LoadedBlock, ProvenEmpty } from './atoms'

/* ─────────────────────────── Santé du canal ─────────────────────────── */

const HEALTH_COLOR: Record<TelemetryHealthStatus, 'emerald' | 'amber' | 'red' | 'zinc'> = {
  healthy: 'emerald',
  loop_muted: 'amber',
  incomplete_configuration: 'amber',
  not_configured: 'red',
  // `unavailable` = on ne SAIT pas. Ni vert (faux rassurant) ni rouge (fausse
  // panne) : gris, le registre de l'ignorance.
  unavailable: 'zinc',
}

const HEALTH_LABEL: Record<TelemetryHealthStatus, string> = {
  healthy: 'canal sain',
  loop_muted: 'boucle muette',
  incomplete_configuration: 'configuration incomplète',
  not_configured: 'canal non configuré',
  unavailable: 'état inconnu',
}

const HEALTH_MEANING: Record<TelemetryHealthStatus, string> = {
  healthy: 'Le jeton d’ingestion est présent, des agents rapportent, et un événement est arrivé récemment.',
  loop_muted:
    'Le canal est configuré et des agents le déclarent, mais rien n’est arrivé depuis longtemps — la boucle d’amélioration ne reçoit plus rien.',
  incomplete_configuration:
    'Le jeton d’ingestion est présent mais aucun agent ne déclare de télémétrie : le canal existe et personne ne l’emprunte.',
  not_configured:
    'AIGENT_RUNTIME_TELEMETRY_TOKEN est absent de cet environnement : aucun agent déployé ne peut rapporter ici.',
  unavailable:
    'La lecture des événements a échoué. L’état du canal est INCONNU — ce n’est ni « sain » ni « muet », et l’afficher comme l’un des deux serait une invention.',
}

function measurementBadgeColor(state: TelemetryMeasurementState): 'emerald' | 'amber' | 'zinc' {
  if (state === 'MEASURED') return 'emerald'
  if (state === 'UNAVAILABLE') return 'amber'
  return 'zinc'
}

function measurementBadgeLabel(state: TelemetryMeasurementState): string {
  if (state === 'MEASURED') return 'mesuré'
  if (state === 'UNAVAILABLE') return 'absent'
  return 'sans objet'
}

function measurementTitle(state: TelemetryMeasurementState): string {
  if (state === 'MEASURED') {
    return 'Cette famille de mesure a réellement été observée sur la fenêtre.'
  }
  if (state === 'UNAVAILABLE') {
    return 'Les événements ne transportaient pas cette information : la valeur est absente, jamais zéro.'
  }
  return 'Cette mesure ne s’applique pas à cette fenêtre.'
}

function HealthPanel({ health }: Readonly<{ health: TelemetryHealthDiagnostic }>) {
  return (
    <Panel
      title="Santé du canal de retour"
      hint="diagnostic dérivé, pas un statut posé"
      className="min-h-0 shrink-0"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge color={HEALTH_COLOR[health.status]} title={HEALTH_MEANING[health.status]}>
            {HEALTH_LABEL[health.status]}
          </Badge>
        </div>
        <Text>{health.summary}</Text>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact
            label="Agents qui rapportent"
            value={
              health.agentsWithTelemetryDeclared === null ? null : (
                <FactValue>{health.agentsWithTelemetryDeclared}</FactValue>
              )
            }
            why="Le nombre d’agents rapporteurs n’a pas pu être lu. Il n’est pas zéro — il est inconnu."
          />
          <Fact
            label="Silence depuis"
            value={
              health.daysSinceLastEvent === null ? null : (
                <FactValue>{health.daysSinceLastEvent.toFixed(1)} j</FactValue>
              )
            }
            why="Aucun événement n’a jamais été reçu, ou la lecture a échoué : l’ancienneté ne se calcule pas."
          />
        </div>
      </div>
    </Panel>
  )
}

/* ───────────────────────── Agrégats de la flotte ────────────────────── */

function FleetPanel({ fleet }: Readonly<{ fleet: TelemetryTabData['fleet'] }>) {
  return (
    <Panel
      title="Runs rapportés"
      hint="fenêtre : 2000 derniers événements"
      className="min-h-0 shrink-0"
    >
      <LoadedBlock loaded={fleet} what="L’agrégat de la flotte">
        {(data: RuntimeTelemetryFleetSummary) =>
          data.totalRuns === 0 ? (
            <ProvenEmpty detail="Aucun run n’a été rapporté sur cette fenêtre. La lecture a réussi : le canal est silencieux, il n’est pas cassé." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {/* Comptages : mesurés par construction, un 0 y est un vrai 0. */}
                <Fact label="Runs" value={<FactValue>{data.totalRuns}</FactValue>} />
                <Fact label="Terminés" value={<FactValue>{data.completedRuns}</FactValue>} />
                <Fact label="Échoués" value={<FactValue>{data.failedRuns}</FactValue>} />
                <Fact label="Agents rapporteurs" value={<FactValue>{data.reportingAgents}</FactValue>} />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact
                  label="Taux de succès"
                  value={
                    data.successRate === null ? null : (
                      <FactValue>{(data.successRate * 100).toFixed(1)} %</FactValue>
                    )
                  }
                  why="Aucun run terminal sur la fenêtre : un taux ne se calcule pas sur zéro dénominateur."
                />
                <Fact
                  label="Latence moyenne"
                  value={
                    data.avgLatencyMs === null ? null : (
                      <FactValue>{Math.round(data.avgLatencyMs)} ms</FactValue>
                    )
                  }
                  why="Aucun événement ne transportait de latence."
                />
                <Fact
                  label="Latence p95"
                  value={
                    data.p95LatencyMs === null ? null : (
                      <FactValue>{Math.round(data.p95LatencyMs)} ms</FactValue>
                    )
                  }
                  why="Aucun événement ne transportait de latence."
                />
                <Fact
                  label="Coût cumulé"
                  value={
                    data.totalCostUsd === null ? null : <FactValue>{formatUsd(data.totalCostUsd)}</FactValue>
                  }
                  why="Aucun événement ne transportait d’usage_metadata : le coût est absent, pas nul."
                  hint={data.costEstimated ? 'estimation tarifaire, pas une facturation' : undefined}
                />
              </div>

              {/*
                La provenance des mesures, dite explicitement. C'est ce qui
                distingue « mesuré à zéro » de « pas mesurable » sur cet écran, et
                ça évite d'avoir à le deviner d'un tiret.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <Text className="text-xs">Provenance :</Text>
                {(
                  [
                    ['jetons', data.measurement.tokens],
                    ['coût', data.measurement.cost],
                    ['erreurs', data.measurement.errorCategories],
                    ['signaux d’outil', data.measurement.toolSignals],
                  ] as const
                ).map(([label, state]) => (
                  <Badge
                    key={label}
                    color={measurementBadgeColor(state)}
                    title={measurementTitle(state)}
                  >
                    {label} · {measurementBadgeLabel(state)}
                  </Badge>
                ))}
              </div>

              {data.topErrorCategories.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Text className="text-xs">Erreurs dominantes :</Text>
                  {data.topErrorCategories.map((cat) => (
                    <Badge key={cat.category} color="red">
                      {cat.category} · {cat.count}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }
      </LoadedBlock>
    </Panel>
  )
}

/* ──────────────────────── Provenance des événements ─────────────────── */

/**
 * D'où viennent réellement les événements.
 *
 * Le canal est UNIQUE pour deux sources : les agents déployés chez un
 * consommateur, et les runs internes d'Aigent. Les compter séparément est la
 * seule façon de voir que la boucle consommateur — la raison d'être du canal —
 * peut être à zéro pendant que le canal a l'air actif.
 *
 * Le partage se fait sur `environment.source`, seule information de provenance
 * que porte un événement. Ce qui n'est pas identifiable reste dans une troisième
 * catégorie, « non étiqueté » : on ne l'attribue pas d'office aux consommateurs
 * pour gonfler le chiffre qui nous intéresse.
 */
function provenanceOf(event: RuntimeTelemetryEvent): 'internal' | 'consumer' | 'unlabelled' {
  const source = event.environment?.source
  if (typeof source !== 'string') return 'unlabelled'
  if (source.startsWith('aigent-internal')) return 'internal'
  return 'consumer'
}

function ProvenancePanel({ events }: Readonly<{ events: TelemetryTabData['events'] }>) {
  return (
    <Panel title="Provenance des événements" hint="deux sources, un seul canal" className="min-h-0 shrink-0">
      <LoadedBlock loaded={events} what="Le détail des événements">
        {(rows) =>
          rows.length === 0 ? (
            <ProvenEmpty detail="Aucun événement sur la fenêtre. La lecture a réussi — c'est un silence, pas une panne." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['Consommateur', 'consumer', 'Rapportés par un agent déployé chez un tiers — la boucle de retour produit.'],
                    ['Interne Aigent', 'internal', 'Runs exécutés par Aigent lui-même et réémis dans le même canal.'],
                    ['Non étiqueté', 'unlabelled', 'Aucune source identifiable dans l’enveloppe. Non attribué plutôt que deviné.'],
                  ] as const
                ).map(([label, kind, meaning]) => {
                  const count = rows.filter((e) => provenanceOf(e) === kind).length
                  return (
                    <div key={kind} className="min-w-0" title={meaning}>
                      <Text className="truncate text-xs">{label}</Text>
                      {/* Un 0 ici est MESURÉ : on a lu les N événements et
                          compté zéro. Il s'affiche, et il se commente. */}
                      <div className="mt-0.5">
                        <FactValue>
                          {count}
                          <span className="text-zinc-500 dark:text-zinc-400"> / {rows.length}</span>
                        </FactValue>
                      </div>
                    </div>
                  )
                })}
              </div>
              {rows.filter((e) => provenanceOf(e) === 'consumer').length === 0 ? (
                <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2">
                  <Strong className="block">Zéro événement de source consommateur</Strong>
                  <Text className="mt-0.5">
                    Sur les {rows.length} événements lus, aucun ne provient d’un agent déployé chez un
                    consommateur. C’est une mesure, pas une absence de mesure : le canal transporte
                    aujourd’hui les runs internes d’Aigent, et la boucle de retour produit — celle qui
                    justifie le canal — n’a rien livré sur cette fenêtre.
                  </Text>
                </div>
              ) : null}
            </div>
          )
        }
      </LoadedBlock>
    </Panel>
  )
}

/* ───────────────────────── Événements récents ───────────────────────── */

const STATUS_COLOR = { completed: 'emerald', failed: 'red', started: 'sky' } as const

function EventsPanel({ events }: Readonly<{ events: TelemetryTabData['events'] }>) {
  return (
    <Panel
      title="Événements reçus"
      hint="50 plus récents"
      className="min-h-64 min-w-0 xl:flex-1"
      padded={false}
      bodyClassName="scroll-thin overflow-y-auto"
    >
      <LoadedBlock loaded={events} what="Le journal des événements">
        {(rows) =>
          rows.length === 0 ? (
            <div className="p-4">
              <ProvenEmpty detail="Aucun événement n’a été reçu. La lecture a réussi et la table est réellement vide." />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
              {rows.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <Badge color={STATUS_COLOR[event.status]}>{event.status}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <Strong className="truncate">{event.agentId}</Strong>
                      {event.eventType ? <Badge color="purple">{event.eventType}</Badge> : null}
                    </div>
                    <Text className="truncate text-xs">
                      {/*
                        Provider et modèle sont `null`-ables et le RESTENT : la
                        télémétrie ne fabrique pas de provider, parce qu'un
                        provider inventé produirait un coût de 0 — un mensonge.
                      */}
                      {event.provider ?? 'provider non rapporté'}
                      {' · '}
                      {event.model ?? 'modèle non rapporté'}
                      {event.agentVersion ? ` · ${event.agentVersion}` : ''}
                    </Text>
                  </div>
                  <div className="hidden shrink-0 text-right sm:block">
                    <Text className="text-xs tabular-nums">
                      {event.latencyMs === null ? '—' : `${event.latencyMs} ms`}
                    </Text>
                    <Text className="text-xs tabular-nums">
                      {new Date(event.receivedAt).toLocaleString('fr-FR')}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      </LoadedBlock>
    </Panel>
  )
}

export default function TelemetryTab({ data }: Readonly<{ data: TelemetryTabData }>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <HealthPanel health={data.health} />
      <FleetPanel fleet={data.fleet} />
      <ProvenancePanel events={data.events} />
      <EventsPanel events={data.events} />
    </div>
  )
}
