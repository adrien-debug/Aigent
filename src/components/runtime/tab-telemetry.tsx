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
import { SEVERITY } from '@/components/cockpit/primitives'
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
  // `not_configured` = une variable d'environnement n'est pas renseignée. C'est
  // une CONFIGURATION ABSENTE, pas une panne : rien n'est cassé, rien n'a
  // échoué, et le résumé juste à côté le dit déjà en toutes lettres (« This
  // says nothing about whether delivered agents are running »). Le rouge
  // contredisait ce texte et faisait lire un environnement non câblé comme un
  // incident de production. Gris, comme `unavailable` : le registre de ce qui
  // n'est pas renseigné.
  not_configured: 'zinc',
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
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="aig-display text-sm font-semibold">Santé du canal de retour</h2>
        <Text className="aig-text-faint text-2xs">diagnostic dérivé, pas un statut posé</Text>
      </div>
      <div className="aig-hairline" />
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
    </section>
  )
}

/* ───────────────────────── Agrégats de la flotte ────────────────────── */

function FleetPanel({ fleet }: Readonly<{ fleet: TelemetryTabData['fleet'] }>) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="aig-display text-sm font-semibold">Runs rapportés</h2>
        <Text className="aig-text-faint text-2xs">fenêtre : 2000 derniers événements</Text>
      </div>
      <div className="aig-hairline" />
      <LoadedBlock loaded={fleet} what="L’agrégat de la flotte">
        {(data: RuntimeTelemetryFleetSummary) =>
          data.totalRuns === 0 ? (
            <ProvenEmpty detail="Aucun run n’a été rapporté sur cette fenêtre. La lecture a réussi : le canal est silencieux, il n’est pas cassé." />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
    </section>
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
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="aig-display text-sm font-semibold">Provenance des événements</h2>
        <Text className="aig-text-faint text-2xs">deux sources, un seul canal</Text>
      </div>
      <div className="aig-hairline" />
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
                          {/* Le dénominateur descend d'un cran : c'est le
                              contexte du compte, pas le compte lui-même. */}
                          <span className="aig-text-muted"> / {rows.length}</span>
                        </FactValue>
                      </div>
                    </div>
                  )
                })}
              </div>
              {rows.filter((e) => provenanceOf(e) === 'consumer').length === 0 ? (
                <div className="aig-subtle px-3 py-2">
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
    </section>
  )
}

/* ───────────────────────── Événements récents ───────────────────────── */

const STATUS_COLOR = { completed: 'emerald', failed: 'red', started: 'sky' } as const

type DataGrade = 'LIVE' | 'SNAPSHOT' | 'DEMO' | 'UNAVAILABLE' | 'ERROR'

function gradeColor(grade: DataGrade): 'emerald' | 'blue' | 'amber' | 'zinc' | 'red' {
  if (grade === 'LIVE') return 'emerald'
  if (grade === 'SNAPSHOT') return 'blue'
  if (grade === 'DEMO') return 'amber'
  if (grade === 'UNAVAILABLE') return 'zinc'
  return 'red'
}

function TelemetrySignals({ events }: Readonly<{ events: RuntimeTelemetryEvent[] }>) {
  if (events.length === 0) {
    return (
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center gap-2">
          <Badge color={gradeColor('SNAPSHOT')}>SNAPSHOT</Badge>
          <Text className="text-xs">Fenêtre lue, aucun événement</Text>
        </div>
        <Text className="text-xs">Aucune série n’est tracée faute d’événement sur la fenêtre.</Text>
      </div>
    )
  }

  const hourMap = new Map<number, { total: number; failed: number }>()
  const status = { started: 0, completed: 0, failed: 0 }
  for (const row of events) {
    const t = Date.parse(row.receivedAt)
    if (Number.isFinite(t)) {
      const bucket = Math.floor(t / (60 * 60 * 1000))
      const current = hourMap.get(bucket) ?? { total: 0, failed: 0 }
      current.total += 1
      if (row.status === 'failed') current.failed += 1
      hourMap.set(bucket, current)
    }
    status[row.status] += 1
  }

  const hours = [...hourMap.keys()].toSorted((a, b) => a - b).slice(-24)
  const totals = hours.map((h) => hourMap.get(h)?.total ?? 0)
  const fails = hours.map((h) => hourMap.get(h)?.failed ?? 0)
  const max = Math.max(1, ...totals)
  const width = 100
  const height = 28
  const step = totals.length > 1 ? width / (totals.length - 1) : width
  const line = totals
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(height - (v / max) * height).toFixed(2)}`)
    .join(' ')
  const failLine = fails
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${(height - (v / max) * height).toFixed(2)}`)
    .join(' ')

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge color={gradeColor('SNAPSHOT')}>SNAPSHOT</Badge>
        <Text className="text-xs">Série native sur événements persistés</Text>
      </div>
      <svg viewBox="0 0 100 30" className="h-24 w-full">
        {[0, 10, 20, 28].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            className="text-(--aig-line-soft)"
            stroke="currentColor"
            strokeDasharray="1.6 2.4"
          />
        ))}
        <path d={line} fill="none" stroke={SEVERITY.running} strokeWidth="1.2" />
        <path d={failLine} fill="none" stroke={SEVERITY.bad} strokeWidth="1" />
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="aig-subtle rounded px-2 py-1">
          <Text className="text-2xs">Started</Text>
          <Strong className="tabular-nums">{status.started}</Strong>
        </div>
        <div className="aig-subtle rounded px-2 py-1">
          <Text className="text-2xs">Completed</Text>
          <Strong className="tabular-nums">{status.completed}</Strong>
        </div>
        <div className="aig-subtle rounded px-2 py-1">
          <Text className="text-2xs">Failed</Text>
          <Strong className="tabular-nums">{status.failed}</Strong>
        </div>
      </div>
    </div>
  )
}

function EventsPanel({ events }: Readonly<{ events: TelemetryTabData['events'] }>) {
  return (
    <section className="flex min-h-64 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="aig-display text-sm font-semibold">Événements reçus</h2>
        <Text className="aig-text-faint text-2xs">50 plus récents</Text>
      </div>
      <div className="aig-hairline my-3" />
      <LoadedBlock loaded={events} what="Le journal des événements">
        {(rows) =>
          rows.length === 0 ? (
            <div className="p-4">
              <ProvenEmpty detail="Aucun événement n’a été reçu. La lecture a réussi et la table est réellement vide." />
            </div>
          ) : (
            <div className="flex min-h-0 flex-col gap-3 p-3">
              <TelemetrySignals events={rows} />
              <ul className="divide-y divide-(--aig-line-soft)">
                {rows.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center gap-3 px-1 py-2.5"
                  >
                    <Badge color={STATUS_COLOR[event.status]}>{event.status}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Strong className="truncate">{event.agentId}</Strong>
                        {event.eventType ? <Badge color="purple">{event.eventType}</Badge> : null}
                      </div>
                      <Text className="truncate text-xs">
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
            </div>
          )
        }
      </LoadedBlock>
    </section>
  )
}

export default function TelemetryTab({ data }: Readonly<{ data: TelemetryTabData }>) {
  return (
    <div className="flex flex-col gap-3">
      <HealthPanel health={data.health} />
      <FleetPanel fleet={data.fleet} />

      <ProvenancePanel events={data.events} />
      <EventsPanel events={data.events} />
    </div>
  )
}
