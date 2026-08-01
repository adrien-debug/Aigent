/**
 * Exposition Prometheus des métriques MÉTIER d'Aigent — AIGENT-VISUAL-STACK-002.
 *
 * POURQUOI CETTE ROUTE EXISTE. Grafana doit montrer ce qu'Aigent fait, pas la
 * santé de son conteneur. CPU, mémoire, uptime et « le port répond » sont des
 * métriques d'hébergement : elles restent vertes pendant qu'aucun agent ne
 * tourne. Ce qu'on expose ici vient de `runtime_telemetry_events`, la table où
 * atterrissent les runs réellement rapportés (agents déployés chez les
 * consommateurs ET runs internes via `emitInternalRunTelemetry`).
 *
 * RÉUTILISATION, PAS RÉÉCRITURE. Le calcul est celui de
 * `summarizeFleetRuntimeTelemetry()` : mêmes comptes terminaux, même p95 sur
 * les latences réelles, même provenance. Cette route ne fait que TRADUIRE ce
 * rollup en format d'exposition Prometheus. Aucune règle d'agrégation n'est
 * dupliquée ici — un second calcul divergerait tôt ou tard du produit.
 *
 * VÉRITÉ DES DONNÉES (`AGENTS.md`). Une valeur non mesurée n'est jamais coercée
 * en 0 : une métrique dont la source est `null` n'est PAS émise. Prometheus
 * distingue nativement « série absente » de « série à zéro », et c'est
 * exactement la distinction qui compte ici — 15 des 38 événements observés au
 * 2026-08-01 n'ont pas de `latency_ms`, et les compter comme 0 ms fabriquerait
 * une performance qui n'existe pas.
 *
 * CARDINALITÉ. Les labels sont `project_id` et `agent_id` — bornés par le
 * roster (4 projets / 12 agents observés). Sont délibérément EXCLUS :
 *   - `run_id` (non borné : une série par run ferait exploser la TSDB),
 *   - `error` / `input_shape` / `output_shape` (contenu potentiellement sensible),
 *   - `environment` (c'est un OBJET `{nodeEnv,runtime}` en base, pas une chaîne :
 *     l'utiliser en label produirait `[object Object]`).
 *
 * SÉCURITÉ. Route sous `/api/agent-ops/**`, donc gardée par `src/proxy.ts`
 * comme toute surface opérateur — Grafana s'authentifie avec `x-amc-key`. Elle
 * est en LECTURE SEULE : aucun chemin d'écriture, aucun appel provider, donc
 * aucun coût LLM. Aucun secret n'est renvoyé, y compris dans les erreurs.
 */
import { NextResponse } from 'next/server'

import { summarizeFleetRuntimeTelemetry } from '@/lib/agent-mission-control/runtime-telemetry-store'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Échappe une valeur de label Prometheus (backslash, guillemet, saut de ligne). */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
}

interface Metric {
  name: string
  help: string
  type: 'gauge' | 'counter'
  samples: Array<{ labels?: Record<string, string>; value: number }>
}

/** Rend une métrique au format d'exposition texte, ou '' si aucun échantillon. */
function render(metric: Metric): string {
  if (metric.samples.length === 0) return ''
  const lines = [`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`]
  for (const sample of metric.samples) {
    const labels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
          .join(',')}}`
      : ''
    lines.push(`${metric.name}${labels} ${sample.value}`)
  }
  return lines.join('\n')
}

export async function GET(): Promise<NextResponse> {
  let fleet: Awaited<ReturnType<typeof summarizeFleetRuntimeTelemetry>>
  try {
    fleet = await summarizeFleetRuntimeTelemetry()
  } catch (err) {
    // Backend injoignable → 503 et AUCUNE métrique. Servir un corps vide en 200
    // ferait lire à Grafana « 0 run » — un mensonge indistinguable d'une flotte
    // au repos. `AGENTS.md` : une API injoignable n'est pas saine.
    const reason = err instanceof Error ? err.message : 'unknown'
    return new NextResponse(
      `# aigent metrics unavailable\n# reason: ${escapeLabel(reason).slice(0, 200)}\n`,
      { status: 503, headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' } }
    )
  }

  const metrics: Metric[] = []

  // ------------------------------------------------------------- flotte entière
  metrics.push({
    name: 'aigent_runs_total',
    help: 'Runs observés dans runtime_telemetry_events (fenêtre récente bornée).',
    type: 'gauge',
    samples: [{ value: fleet.totalRuns }],
  })

  metrics.push({
    name: 'aigent_runs_by_status',
    help: 'Runs par état terminal réel. `started` = runs encore en vol.',
    type: 'gauge',
    samples: [
      { labels: { status: 'completed' }, value: fleet.completedRuns },
      { labels: { status: 'failed' }, value: fleet.failedRuns },
      { labels: { status: 'started' }, value: fleet.startedRuns },
    ],
  })

  metrics.push({
    name: 'aigent_reporting_agents',
    help:
      'Couples (projet, agent) ayant rapporté au moins un événement — la grain ' +
      'du rollup produit. Supérieur au nombre d’agents nus quand un copilot ' +
      'sert plusieurs projets (observé au 2026-08-01 : 15 couples pour 12 agents).',
    type: 'gauge',
    samples: [{ value: fleet.reportingAgents }],
  })

  // `null` → série absente, jamais 0. Un taux de succès inconnu n'est pas 0 %.
  if (fleet.successRate !== null) {
    metrics.push({
      name: 'aigent_success_rate',
      help: 'Part de runs terminaux réussis (0..1). Absente si aucun run terminal.',
      type: 'gauge',
      samples: [{ value: fleet.successRate }],
    })
  }

  if (fleet.avgLatencyMs !== null) {
    metrics.push({
      name: 'aigent_run_latency_ms_avg',
      help: 'Latence moyenne, calculée UNIQUEMENT sur les runs qui en portent une.',
      type: 'gauge',
      samples: [{ value: fleet.avgLatencyMs }],
    })
  }

  if (fleet.p95LatencyMs !== null) {
    metrics.push({
      name: 'aigent_run_latency_ms_p95',
      help: 'p95 de latence sur les latences réelles.',
      type: 'gauge',
      samples: [{ value: fleet.p95LatencyMs }],
    })
  }

  // ------------------------------------------------------------- par agent
  const perAgentRuns: Metric = {
    name: 'aigent_agent_runs_total',
    help: 'Runs observés par (projet, agent).',
    type: 'gauge',
    samples: [],
  }
  const perAgentStatus: Metric = {
    name: 'aigent_agent_runs_by_status',
    help: 'Runs par (projet, agent, état terminal).',
    type: 'gauge',
    samples: [],
  }
  const perAgentLatency: Metric = {
    name: 'aigent_agent_run_latency_ms_avg',
    help: 'Latence moyenne par agent — série absente si aucune latence mesurée.',
    type: 'gauge',
    samples: [],
  }

  for (const agent of fleet.byAgent) {
    const labels = { project_id: agent.projectId, agent_id: agent.agentId }
    perAgentRuns.samples.push({ labels, value: agent.totalRuns })
    perAgentStatus.samples.push({ labels: { ...labels, status: 'completed' }, value: agent.completedRuns })
    perAgentStatus.samples.push({ labels: { ...labels, status: 'failed' }, value: agent.failedRuns })
    if (agent.avgLatencyMs !== null) {
      perAgentLatency.samples.push({ labels, value: agent.avgLatencyMs })
    }
  }
  metrics.push(perAgentRuns, perAgentStatus, perAgentLatency)

  // --------------------------------------------------- provenance vérifiable
  // Le scrape porte sa propre traçabilité : d'où viennent les chiffres et de
  // quand date le dernier événement réel. Sans cela, un dashboard figé sur des
  // données mortes est indistinguable d'un dashboard à jour.
  if (fleet.lastSeenAt !== null) {
    metrics.push({
      name: 'aigent_last_event_timestamp_seconds',
      help: 'Date du dernier événement de télémétrie observé (epoch secondes).',
      type: 'gauge',
      samples: [{ value: Math.floor(Date.parse(fleet.lastSeenAt) / 1000) }],
    })
  }

  metrics.push({
    name: 'aigent_metrics_scrape_timestamp_seconds',
    help: 'Date de production de cette réponse (epoch secondes).',
    type: 'gauge',
    samples: [{ value: Math.floor(Date.now() / 1000) }],
  })

  const body = [
    '# Aigent — métriques métier issues de runtime_telemetry_events.',
    '# Producteur : summarizeFleetRuntimeTelemetry() (src/lib/agent-mission-control/runtime-telemetry-store.ts).',
    '# Une valeur non mesurée n’est pas émise — elle n’est jamais coercée en 0.',
    ...metrics.map(render).filter((s) => s.length > 0),
    '',
  ].join('\n')

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
