/**
 * La comparaison V1 / V2 — et surtout ce qu'elle refuse d'affirmer.
 *
 * Le défaut que cette suite garde : une V2 fraîche est écrite en base avec
 * `scores.testPassRate: 0`. Rendue telle quelle face à une V1 à 92 %, elle
 * afficherait une régression massive INVENTÉE, sur l'écran même qui sert à
 * décider d'approuver. `scoresEvidence` est ce qui distingue les deux, et il est
 * testé dans les deux sens.
 */
import { describe, expect, it } from 'vitest'

import {
  aggregateBenchmarkScore,
  aggregatePassRate,
  buildCompareView,
  directionOf,
  numericMeasure,
  fromNullableText,
  measured,
  NOT_MEASURED,
  type CompareView,
} from '@/components/agents/compare-model'
import type { ImprovementProposal, VersionComparison } from '@/lib/agent-mission-control/improvement-loop'
import type { AgentManifest, CopilotVersion } from '@/lib/agent-mission-control/types'

function version(over: Partial<CopilotVersion> & Pick<CopilotVersion, 'id'>): CopilotVersion {
  return {
    copilotId: 'cp-1',
    label: 'v1.0.0',
    stage: 'production',
    manifestId: 'mf-1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    changelog: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: 'operator',
    scores: {
      testPassRate: null,
      benchmarkScore: null,
      shadowAgreement: null,
      unsafeActionCount: null,
    },
    ...over,
  } as CopilotVersion
}

function manifest(over: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: 'mf-1',
    copilotId: 'cp-1',
    version: '1',
    systemPromptSummary: 'Charte V1',
    allowedRoutes: [],
    forbiddenActions: ['delete-account'],
    confirmationPolicy: 'risky-only',
    alwaysConfirmActions: [],
    memorySources: [],
    outputContract: { invariants: ['jamais de SQL brut'] },
    skills: [],
    toolIds: ['t1', 't2'],
    maxStepsPerRun: 8,
    maxCostPerRunUsd: 0.5,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  } as AgentManifest
}

function proposal(over: Partial<ImprovementProposal> = {}): ImprovementProposal {
  return {
    id: 'pr-1',
    copilotId: 'cp-1',
    baseVersionId: 'ver-1',
    v2VersionId: 'ver-2',
    v2ManifestId: 'mf-2',
    status: 'v2-created',
    summary: 'Durcit la confirmation.',
    failureAnalysis: [],
    manifestChanges: {},
    sources: { db: true, langgraph: false, langsmith: false, runtimeTelemetry: false },
    costUsd: 0.12,
    createdAt: '2026-08-02T00:00:00.000Z',
    createdBy: 'improvement-loop',
    decidedBy: null,
    decidedAt: null,
    ...over,
  } as ImprovementProposal
}

function rowOf(view: CompareView, groupKey: string, rowKey: string) {
  const group = view.groups.find((g) => g.key === groupKey)
  expect(group, `groupe ${groupKey} absent`).toBeDefined()
  const row =
    group!.textRows.find((r) => r.key === rowKey) ?? group!.numberRows.find((r) => r.key === rowKey)
  expect(row, `ligne ${rowKey} absente`).toBeDefined()
  return row!
}

describe('primitives d’absence', () => {
  it('un 0 mesuré reste mesuré, un null devient une absence', () => {
    expect(numericMeasure(0)).toEqual(measured(0))
    expect(numericMeasure(null)).toEqual(NOT_MEASURED)
    expect(numericMeasure(undefined)).toEqual(NOT_MEASURED)
    expect(numericMeasure(Number.NaN)).toEqual(NOT_MEASURED)
  })

  it('une chaîne vide est une absence, pas une valeur', () => {
    expect(fromNullableText('  ')).toEqual(NOT_MEASURED)
    expect(fromNullableText('gpt-5.4')).toEqual(measured('gpt-5.4'))
  })
})

describe('direction d’un écart', () => {
  it('respecte la polarité de la mesure', () => {
    expect(directionOf(measured(0.5), measured(0.9), true)).toBe('better')
    expect(directionOf(measured(0.9), measured(0.5), true)).toBe('worse')
    // Un coût qui monte n'est pas un progrès.
    expect(directionOf(measured(0.1), measured(0.4), false)).toBe('worse')
  })

  it('un côté non mesuré rend l’écart INCALCULABLE, jamais « inchangé »', () => {
    expect(directionOf(NOT_MEASURED, measured(0.9), true)).toBe('unknown')
    expect(directionOf(measured(0.9), NOT_MEASURED, true)).toBe('unknown')
    expect(directionOf(NOT_MEASURED, NOT_MEASURED, true)).toBe('unknown')
  })

  it('deux valeurs mesurées égales sont « inchangé »', () => {
    expect(directionOf(measured(3), measured(3), true)).toBe('same')
  })
})

describe('agrégation des suites', () => {
  const comparison: VersionComparison = {
    tests: [
      {
        suiteId: 's1',
        suiteName: 'A',
        v1: { runId: 'r1', passRate: 0.8, finishedAt: null },
        v2: { runId: 'r2', passRate: 1, finishedAt: null },
      },
      { suiteId: 's2', suiteName: 'B', v1: null, v2: { runId: 'r3', passRate: 0.6, finishedAt: null } },
    ],
    benchmarks: [
      { suiteId: 'b1', suiteName: 'Bench', v1: { runId: 'r4', score: 70 }, v2: null },
    ],
  }

  it('ne moyenne que les suites réellement mesurées', () => {
    expect(aggregatePassRate(comparison, 'v1')).toEqual(measured(0.8))
    expect(aggregatePassRate(comparison, 'v2')).toEqual(measured(0.8))
    expect(aggregateBenchmarkScore(comparison, 'v1')).toEqual(measured(70))
  })

  it('zéro suite mesurée est une ABSENCE, pas une moyenne de 0', () => {
    expect(aggregateBenchmarkScore(comparison, 'v2')).toEqual(NOT_MEASURED)
    expect(aggregatePassRate(null, 'v1')).toEqual(NOT_MEASURED)
    expect(
      aggregatePassRate({ tests: [{ suiteId: 's', suiteName: 'S', v1: null, v2: null }], benchmarks: [] }, 'v1'),
    ).toEqual(NOT_MEASURED)
  })
})

describe('buildCompareView — vérité des données', () => {
  it('une V2 fraîche (scoresEvidence "none") ne fabrique JAMAIS une régression à 0', () => {
    const view = buildCompareView({
      proposal: proposal(),
      comparison: null,
      versions: [
        version({
          id: 'ver-1',
          scores: { testPassRate: 0.92, benchmarkScore: 80, shadowAgreement: null, unsafeActionCount: 0 },
          scoresEvidence: 'runs',
        }),
        version({
          id: 'ver-2',
          label: 'v2.0.0',
          stage: 'draft',
          // Exactement ce que `createV2FromProposal` écrit en base.
          scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: null },
          scoresEvidence: 'none',
        }),
      ],
      manifest: manifest(),
    })

    const passRate = rowOf(view, 'evidence', 'version-pass-rate')
    expect(passRate.v1).toEqual(measured(0.92))
    // LE POINT DE LA SUITE : le 0 stocké ne se rend pas comme une mesure.
    expect(passRate.v2).toEqual(NOT_MEASURED)
    expect('direction' in passRate && passRate.direction).toBe('unknown')
  })

  it('un compteur unsafe non mesuré ne vaut jamais 0', () => {
    const view = buildCompareView({
      proposal: proposal(),
      comparison: null,
      versions: [
        version({ id: 'ver-1', scoresEvidence: 'runs' }),
        version({ id: 'ver-2', scoresEvidence: 'runs' }),
      ],
      manifest: manifest(),
    })
    const unsafe = rowOf(view, 'evidence', 'unsafe')
    expect(unsafe.v1).toEqual(NOT_MEASURED)
    expect(unsafe.v2).toEqual(NOT_MEASURED)
  })

  it('un champ que la boucle n’a pas touché est REPORTÉ, pas déclaré absent', () => {
    const view = buildCompareView({
      proposal: proposal({ manifestChanges: {} }),
      comparison: null,
      versions: [version({ id: 'ver-1' }), version({ id: 'ver-2' })],
      manifest: manifest(),
    })
    const prompt = rowOf(view, 'behaviour', 'prompt')
    expect(prompt.v1).toEqual(measured('Charte V1'))
    expect(prompt.v2).toEqual(measured('Charte V1'))
    expect('changed' in prompt && prompt.changed).toBe(false)
  })

  it('un changement de manifeste sort en « modifié » avec sa justification', () => {
    const view = buildCompareView({
      proposal: proposal({
        manifestChanges: {
          confirmationPolicy: { from: 'risky-only', to: 'always', why: 'Deux actions unsafe observées.' },
        },
      }),
      comparison: null,
      versions: [version({ id: 'ver-1' }), version({ id: 'ver-2' })],
      manifest: manifest(),
    })
    const row = rowOf(view, 'guardrails', 'confirmation')
    expect(row.v1).toEqual(measured('risky-only'))
    expect(row.v2).toEqual(measured('always'))
    expect('changed' in row && row.changed).toBe(true)
    expect('why' in row && row.why).toEqual(measured('Deux actions unsafe observées.'))
  })

  it('une liste VIDE est un fait mesuré (« aucune »), pas une absence', () => {
    const view = buildCompareView({
      proposal: proposal(),
      comparison: null,
      versions: [version({ id: 'ver-1' }), version({ id: 'ver-2' })],
      manifest: manifest({ forbiddenActions: [] }),
    })
    expect(rowOf(view, 'guardrails', 'forbidden').v1).toEqual(measured('aucune'))
  })

  it('un manifeste absent ne fabrique aucune valeur', () => {
    const view = buildCompareView({
      proposal: proposal(),
      comparison: null,
      versions: [version({ id: 'ver-1' }), version({ id: 'ver-2' })],
      manifest: undefined,
    })
    expect(rowOf(view, 'behaviour', 'prompt').v1).toEqual(NOT_MEASURED)
    expect(rowOf(view, 'limits', 'max-cost').v1).toEqual(NOT_MEASURED)
    expect(rowOf(view, 'behaviour', 'tools').v1).toEqual(NOT_MEASURED)
  })

  it('les outils sont rendus identiques des deux côtés — la boucle ne peut pas les changer', () => {
    const view = buildCompareView({
      proposal: proposal(),
      comparison: null,
      versions: [version({ id: 'ver-1' }), version({ id: 'ver-2' })],
      manifest: manifest(),
    })
    const tools = rowOf(view, 'behaviour', 'tools')
    expect(tools.v1).toEqual(measured('2 outil(s)'))
    expect(tools.v2).toEqual(measured('2 outil(s)'))
    expect('changed' in tools && tools.changed).toBe(false)
  })

  it('une version introuvable laisse le modèle NON RÉSOLU, jamais « openai »', () => {
    const view = buildCompareView({
      proposal: proposal(),
      comparison: null,
      versions: [],
      manifest: manifest(),
    })
    expect(rowOf(view, 'behaviour', 'model').v1).toEqual(NOT_MEASURED)
    expect(rowOf(view, 'behaviour', 'provider').v2).toEqual(NOT_MEASURED)
    expect(view.v1Label).toEqual(NOT_MEASURED)
  })

  it('compte séparément les écarts mesurés et les écarts incalculables', () => {
    const view = buildCompareView({
      proposal: proposal({
        manifestChanges: {
          confirmationPolicy: { from: 'risky-only', to: 'always', why: 'plus strict' },
        },
      }),
      comparison: null,
      versions: [version({ id: 'ver-1' }), version({ id: 'ver-2' })],
      manifest: manifest(),
    })
    expect(view.changedCount).toBeGreaterThanOrEqual(1)
    // Sans comparaison live, les scores sont incalculables — et déclarés tels.
    expect(view.unknownCount).toBeGreaterThanOrEqual(1)
  })
})
