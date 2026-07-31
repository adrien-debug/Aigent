import { describe, expect, it } from 'vitest'

import {
  PROVENANCE_LABEL,
  RUN_STATUS_BADGE,
  RUN_STATUS_LABEL,
  consumerChannelState,
  countProvenance,
  resolveSelectedRun,
  runCostFact,
  runDurationFact,
  runErrorFact,
  runInterruptFact,
  runModelFact,
  runProviderFact,
  runToolCallsFact,
  runTraceFact,
  runUnsafeFact,
} from '@/components/runs/run-view-model'
import type { RuntimeTelemetryEvent } from '@/lib/agent-mission-control/runtime-telemetry-store'
import type { AgentRun } from '@/lib/agent-mission-control/types'

function run(partial: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    copilotId: 'copilot-x',
    versionId: 'ver-1',
    projectId: 'proj-1',
    userLabel: 'operator',
    startedAt: '2026-07-31T10:00:00.000Z',
    finishedAt: '2026-07-31T10:00:04.000Z',
    status: 'completed',
    stepIds: [],
    inputSummary: 'entrée',
    outputSummary: 'sortie',
    toolCallCount: 3,
    unsafeAttemptCount: 0,
    latencyMs: 4200,
    costUsd: 0.012,
    resolvedModel: 'gpt-5.4',
    resolvedProvider: 'openai',
    modelUnverified: false,
    traceUrl: null,
    ...partial,
  }
}

function event(partial: Partial<RuntimeTelemetryEvent> = {}): RuntimeTelemetryEvent {
  return {
    id: 'evt-1',
    projectId: 'proj-1',
    agentId: 'copilot-x',
    agentVersion: null,
    targetRepo: null,
    runId: 'run-1',
    provider: 'openai',
    model: 'gpt-5.4',
    status: 'completed',
    latencyMs: 120,
    inputShape: {},
    outputShape: {},
    error: {},
    usage: {},
    environment: {},
    receivedAt: '2026-07-31T10:00:00.000Z',
    ...partial,
  }
}

/* ───────────────────────── Sélection / deep link ───────────────────────── */

describe('resolveSelectedRun', () => {
  it('selects the first run when no id is requested', () => {
    const runs = [run({ id: 'a' }), run({ id: 'b' })]
    expect(resolveSelectedRun(runs, null)).toEqual({ run: runs[0], notFound: false })
    expect(resolveSelectedRun(runs, '')).toEqual({ run: runs[0], notFound: false })
    expect(resolveSelectedRun(runs, '   ')).toEqual({ run: runs[0], notFound: false })
  })

  it('selects the requested run — the deep link resolves', () => {
    const runs = [run({ id: 'a' }), run({ id: 'b' })]
    expect(resolveSelectedRun(runs, 'b')).toEqual({ run: runs[1], notFound: false })
  })

  it('reports notFound instead of silently falling back to the first run', () => {
    // La régression que ce test verrouille : retomber sur le premier run
    // afficherait le détail d'un AUTRE run sous l'id demandé.
    const runs = [run({ id: 'a' }), run({ id: 'b' })]
    expect(resolveSelectedRun(runs, 'ghost')).toEqual({ run: null, notFound: true })
  })

  it('does not claim notFound when the list itself is empty', () => {
    // Liste vide ≠ lien cassé : il n'y avait rien à trouver.
    expect(resolveSelectedRun([], 'ghost')).toEqual({ run: null, notFound: false })
    expect(resolveSelectedRun([], null)).toEqual({ run: null, notFound: false })
  })
})

/* ──────────────────────────── Provenance ──────────────────────────── */

describe('countProvenance', () => {
  it('counts each provenance and keeps the total honest', () => {
    const events = [
      event({ id: '1', environment: { source: 'aigent-internal-runner' } }),
      event({ id: '2', environment: { source: 'aigent-internal-runner' } }),
      event({ id: '3', environment: { source: 'aigent-shadow' } }),
      event({ id: '4', environment: { source: 'consumer' } }),
      event({ id: '5', environment: {} }),
    ]

    expect(countProvenance(events)).toEqual({
      internal: 2,
      lifecycle: 1,
      consumer: 1,
      unknown: 1,
      total: 5,
    })
  })

  it('counts an all-internal feed with zero consumer traffic', () => {
    // Le fait établi par audit : 38 événements, tous internes, zéro consommateur.
    const events = Array.from({ length: 38 }, (_, i) =>
      event({ id: `e${i}`, environment: { source: 'aigent-internal-runner' } })
    )
    const breakdown = countProvenance(events)
    expect(breakdown.total).toBe(38)
    expect(breakdown.internal).toBe(38)
    expect(breakdown.consumer).toBe(0)
  })

  it('never infers consumer from a missing marker', () => {
    const breakdown = countProvenance([event({ environment: {} })])
    expect(breakdown.consumer).toBe(0)
    expect(breakdown.unknown).toBe(1)
  })

  it('returns a zeroed breakdown for an empty feed', () => {
    expect(countProvenance([])).toEqual({
      internal: 0,
      lifecycle: 0,
      consumer: 0,
      unknown: 0,
      total: 0,
    })
  })
})

describe('consumerChannelState', () => {
  it('distinguishes an unread feed from an empty one', () => {
    // La confusion interdite : `null` (lecture échouée) vs total 0 (canal vide).
    expect(consumerChannelState(null)).toBe('unread')
    expect(
      consumerChannelState({ internal: 0, lifecycle: 0, consumer: 0, unknown: 0, total: 0 })
    ).toBe('silent')
  })

  it('reports internal-only traffic as a MEASURED fact, not an absence', () => {
    expect(
      consumerChannelState({ internal: 38, lifecycle: 0, consumer: 0, unknown: 0, total: 38 })
    ).toBe('internal-only')
  })

  it('reports observed consumer traffic as soon as one event arrives', () => {
    expect(
      consumerChannelState({ internal: 38, lifecycle: 0, consumer: 1, unknown: 0, total: 39 })
    ).toBe('observed')
  })

  it('does not treat lifecycle or unknown traffic as consumer traffic', () => {
    expect(
      consumerChannelState({ internal: 0, lifecycle: 5, consumer: 0, unknown: 3, total: 8 })
    ).toBe('internal-only')
  })
})

describe('PROVENANCE_LABEL', () => {
  it('names all four provenances', () => {
    expect(Object.keys(PROVENANCE_LABEL).toSorted()).toEqual([
      'consumer',
      'internal',
      'lifecycle',
      'unknown',
    ])
  })
})

/* ─────────────────────────── Faits du détail ─────────────────────────── */

describe('runModelFact', () => {
  it('reports a verified model plainly', () => {
    expect(runModelFact(run({ resolvedModel: 'gpt-5.4', modelUnverified: false }))).toEqual({
      state: 'measured',
      value: 'gpt-5.4',
    })
  })

  it('qualifies an unverified model rather than presenting it as proven', () => {
    expect(runModelFact(run({ resolvedModel: 'gpt-5.4', modelUnverified: true }))).toEqual({
      state: 'measured',
      value: 'gpt-5.4 (non vérifié)',
    })
  })

  it('treats an absent modelUnverified flag as UNVERIFIED', () => {
    // Absence de preuve n'est pas preuve : le défaut base est `true`.
    const fact = runModelFact(run({ resolvedModel: 'gpt-5.4', modelUnverified: undefined }))
    expect(fact).toEqual({ state: 'measured', value: 'gpt-5.4 (non vérifié)' })
  })

  it('reports a missing model as not-measured, never as a guessed default', () => {
    expect(runModelFact(run({ resolvedModel: null })).state).toBe('not-measured')
    expect(runModelFact(run({ resolvedModel: undefined })).state).toBe('not-measured')
    expect(runModelFact(run({ resolvedModel: '  ' })).state).toBe('not-measured')
  })
})

describe('runProviderFact', () => {
  it('reports a resolved provider', () => {
    expect(runProviderFact(run({ resolvedProvider: 'google' }))).toEqual({
      state: 'measured',
      value: 'google',
    })
  })

  it('never fabricates a provider — a missing one stays not-measured', () => {
    expect(runProviderFact(run({ resolvedProvider: null })).state).toBe('not-measured')
    expect(runProviderFact(run({ resolvedProvider: undefined })).state).toBe('not-measured')
  })
})

describe('runDurationFact', () => {
  it('passes a formatted duration through', () => {
    expect(runDurationFact('4.2s')).toEqual({ state: 'measured', value: '4.2s' })
  })

  it('turns a null duration into an explicit absence, not "0ms"', () => {
    const fact = runDurationFact(null)
    expect(fact.state).toBe('not-measured')
    expect(fact).not.toHaveProperty('value')
  })
})

describe('runCostFact', () => {
  const fmt = (n: number) => `$${n.toFixed(4)}`

  it('reports a measured cost', () => {
    expect(runCostFact(run({ costUsd: 0.0123 }), fmt)).toEqual({
      state: 'measured',
      value: '$0.0123',
    })
  })

  it('reports a measured ZERO cost as a measurement, not an absence', () => {
    expect(runCostFact(run({ costUsd: 0 }), fmt)).toEqual({ state: 'measured', value: '$0.0000' })
  })

  it('reports an unmeasured cost as absent — never as free', () => {
    const fact = runCostFact(run({ costUsd: null }), fmt)
    expect(fact.state).toBe('not-measured')
    if (fact.state === 'not-measured') {
      expect(fact.why).toContain('gratuit')
    }
  })
})

describe('runTraceFact', () => {
  it('reports a missing trace as NOT-READABLE, not merely not-measured', () => {
    // Nuance structurelle : aucun writer n'alimente `traceUrl`.
    expect(runTraceFact(run({ traceUrl: null })).state).toBe('not-readable')
    expect(runTraceFact(run({ traceUrl: '' })).state).toBe('not-readable')
  })

  it('reports a persisted trace url when one exists', () => {
    expect(runTraceFact(run({ traceUrl: 'https://smith.example/t/1' }))).toEqual({
      state: 'measured',
      value: 'https://smith.example/t/1',
    })
  })
})

describe('runToolCallsFact', () => {
  it('treats a real zero as a measurement', () => {
    // Le runner écrit ce compteur : 0 outil appelé est un fait observé.
    expect(runToolCallsFact(run({ toolCallCount: 0 }))).toEqual({ state: 'measured', value: '0' })
  })

  it('reports a non-finite counter as absent', () => {
    expect(runToolCallsFact(run({ toolCallCount: Number.NaN })).state).toBe('not-measured')
  })
})

describe('runUnsafeFact', () => {
  it('treats a real zero as a measurement', () => {
    expect(runUnsafeFact(run({ unsafeAttemptCount: 0 }))).toEqual({ state: 'measured', value: '0' })
  })

  it('reports blocked attempts when there were some', () => {
    expect(runUnsafeFact(run({ unsafeAttemptCount: 2 }))).toEqual({ state: 'measured', value: '2' })
  })
})

describe('runInterruptFact', () => {
  it('reports a run suspended on human confirmation', () => {
    const fact = runInterruptFact(run({ status: 'needs-confirmation' }))
    expect(fact.state).toBe('measured')
  })

  it('reports interrupt history as not-readable for any other status', () => {
    // Il n'existe aucun loader des étapes : ce n'est pas "zéro interruption".
    for (const status of ['completed', 'failed', 'blocked', 'running'] as const) {
      expect(runInterruptFact(run({ status })).state).toBe('not-readable')
    }
  })
})

describe('runErrorFact', () => {
  it('returns null for a run that did not fail', () => {
    expect(runErrorFact(run({ status: 'completed' }))).toBeNull()
    expect(runErrorFact(run({ status: 'running' }))).toBeNull()
  })

  it('reports the recorded cause of a failure', () => {
    expect(runErrorFact(run({ status: 'failed', outputSummary: 'timeout provider' }))).toEqual({
      state: 'measured',
      value: 'timeout provider',
    })
  })

  it('never invents a cause when none was recorded', () => {
    const fact = runErrorFact(run({ status: 'failed', outputSummary: '   ' }))
    expect(fact?.state).toBe('not-measured')
  })

  it('covers blocked runs too', () => {
    expect(runErrorFact(run({ status: 'blocked', outputSummary: 'Sentinel BLOCKED' }))?.state).toBe(
      'measured'
    )
  })
})

/* ──────────────────────────── Statuts ──────────────────────────── */

describe('run status vocabulary', () => {
  const statuses = ['completed', 'running', 'failed', 'blocked', 'needs-confirmation'] as const

  it('labels every AgentRunStatus', () => {
    for (const status of statuses) {
      expect(RUN_STATUS_LABEL[status]).toBeTruthy()
    }
  })

  it('gives blocked and failed DIFFERENT colours', () => {
    // Les confondre perdrait l'information la plus actionnable de la liste :
    // un run bloqué a été arrêté par une garde, un run échoué a planté.
    expect(RUN_STATUS_BADGE.blocked).not.toBe(RUN_STATUS_BADGE.failed)
  })

  it('gives every status a badge colour', () => {
    for (const status of statuses) {
      expect(RUN_STATUS_BADGE[status]).toBeTruthy()
    }
  })
})
