/**
 * Route d'exposition Prometheus — AIGENT-VISUAL-STACK-002.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *   1. une valeur `null` n'est JAMAIS émise comme 0 (règle de vérité des
 *      données) — c'est la régression qui ferait mentir le dashboard ;
 *   2. le backend injoignable donne 503 sans métriques, pas 200 avec un corps
 *      vide qui se lirait « 0 run » ;
 *   3. aucun label à cardinalité non bornée ni à contenu sensible.
 */
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const summarizeFleetRuntimeTelemetry = vi.fn()
vi.mock('@/lib/agent-mission-control/runtime-telemetry-store', () => ({
  summarizeFleetRuntimeTelemetry: () => summarizeFleetRuntimeTelemetry(),
}))

const { GET } = await import('@/app/api/agent-ops/metrics/route')

/** Rollup complet, toutes valeurs mesurées. */
function fullFleet() {
  return {
    totalRuns: 38,
    completedRuns: 24,
    failedRuns: 9,
    startedRuns: 5,
    successRate: 0.7272727272727273,
    avgLatencyMs: 7608,
    p95LatencyMs: 20598,
    reportingAgents: 15,
    lastSeenAt: '2026-07-30T18:46:47.949+00:00',
    byAgent: [
      {
        projectId: 'proj-tradeagent',
        agentId: 'copilot-market-intelligence',
        totalRuns: 9,
        completedRuns: 9,
        failedRuns: 0,
        startedRuns: 0,
        successRate: 1,
        avgLatencyMs: 5200,
        lastSeenAt: '2026-07-30T18:46:47.949+00:00',
      },
    ],
  }
}

async function bodyOf(res: NextResponse): Promise<string> {
  return await res.text()
}

beforeEach(() => {
  summarizeFleetRuntimeTelemetry.mockReset()
})

describe('GET /api/agent-ops/metrics', () => {
  it('expose les compteurs métier réels au format Prometheus', async () => {
    summarizeFleetRuntimeTelemetry.mockResolvedValue(fullFleet())
    const res = await GET()
    const body = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(body).toContain('aigent_runs_total 38')
    expect(body).toContain('aigent_runs_by_status{status="completed"} 24')
    expect(body).toContain('aigent_runs_by_status{status="failed"} 9')
    expect(body).toContain('aigent_runs_by_status{status="started"} 5')
    expect(body).toContain('aigent_reporting_agents 15')
  })

  it('émet HELP et TYPE pour chaque métrique — sinon elle est illisible côté Grafana', async () => {
    summarizeFleetRuntimeTelemetry.mockResolvedValue(fullFleet())
    const body = await bodyOf(await GET())

    const names = [...body.matchAll(/^# TYPE (\S+) /gm)].map((m) => m[1])
    expect(names).toContain('aigent_runs_total')
    for (const name of names) {
      expect(body).toContain(`# HELP ${name} `)
    }
  })

  it('N’ÉMET PAS une métrique dont la source est null — jamais coercée en 0', async () => {
    summarizeFleetRuntimeTelemetry.mockResolvedValue({
      ...fullFleet(),
      successRate: null,
      avgLatencyMs: null,
      p95LatencyMs: null,
      lastSeenAt: null,
    })
    const body = await bodyOf(await GET())

    // Le cœur de la règle : absente, pas à zéro. Un `aigent_success_rate 0`
    // se lirait « 0 % de succès » — un mensonge sur une flotte non mesurée.
    expect(body).not.toContain('aigent_success_rate')
    expect(body).not.toContain('aigent_run_latency_ms_avg')
    expect(body).not.toContain('aigent_run_latency_ms_p95')
    expect(body).not.toContain('aigent_last_event_timestamp_seconds')
    // Les comptes réels restent, eux, exposés.
    expect(body).toContain('aigent_runs_total 38')
  })

  it('omet la latence d’un agent non mesuré sans masquer ses comptes', async () => {
    summarizeFleetRuntimeTelemetry.mockResolvedValue({
      ...fullFleet(),
      byAgent: [
        {
          projectId: 'p1',
          agentId: 'a-sans-latence',
          totalRuns: 3,
          completedRuns: 2,
          failedRuns: 1,
          startedRuns: 0,
          successRate: 0.666,
          avgLatencyMs: null,
          lastSeenAt: null,
        },
      ],
    })
    const body = await bodyOf(await GET())

    expect(body).toContain('aigent_agent_runs_total{project_id="p1",agent_id="a-sans-latence"} 3')
    expect(body).not.toContain('aigent_agent_run_latency_ms_avg{project_id="p1"')
  })

  it('répond 503 sans métrique quand le backend est injoignable', async () => {
    summarizeFleetRuntimeTelemetry.mockRejectedValue(new Error('PostgREST timeout'))
    const res = await GET()
    const body = await bodyOf(res)

    // 200 + corps vide se lirait « flotte au repos » côté Grafana. Une API
    // injoignable n'est pas saine : elle doit le dire.
    expect(res.status).toBe(503)
    expect(body).not.toContain('aigent_runs_total')
    expect(body).toContain('unavailable')
  })

  it('n’expose aucun label à cardinalité non bornée ni sensible', async () => {
    summarizeFleetRuntimeTelemetry.mockResolvedValue(fullFleet())
    const body = await bodyOf(await GET())

    // run_id ferait une série temporelle par run ; error/shapes peuvent porter
    // du contenu métier ; environment est un objet en base.
    for (const forbidden of ['run_id=', 'error=', 'input_shape=', 'output_shape=', 'environment=']) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('échappe les valeurs de label au lieu de casser le format', async () => {
    summarizeFleetRuntimeTelemetry.mockResolvedValue({
      ...fullFleet(),
      byAgent: [
        {
          projectId: 'p"1',
          agentId: 'a\\b',
          totalRuns: 1,
          completedRuns: 1,
          failedRuns: 0,
          startedRuns: 0,
          successRate: 1,
          avgLatencyMs: null,
          lastSeenAt: null,
        },
      ],
    })
    const body = await bodyOf(await GET())

    expect(body).toContain('project_id="p\\"1"')
    expect(body).toContain('agent_id="a\\\\b"')
  })
})
