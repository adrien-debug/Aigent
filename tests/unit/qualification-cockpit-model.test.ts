/**
 * Unit tests — le modèle du cockpit de qualification.
 *
 * Ce que ces cas protègent : les distinctions que l'écran précédent effaçait.
 * Une absence de preuve n'est pas un échec, une condition non exigée n'est pas
 * une preuve manquante, et la promotion n'est jamais autorisée par un calcul
 * local.
 */
import { describe, expect, it } from 'vitest'

import {
  buildDecision,
  buildPipeline,
  nextAction,
  type DecisionInput,
  type PipelineInput,
} from '@/components/qualification/cockpit-model'
import type { ReleaseGate } from '@/lib/agent-mission-control/release-gate'
import type { PromotionGateResult } from '@/lib/agent-mission-control/promotion-gate'

function emptyInput(): PipelineInput {
  return {
    releaseGate: null,
    releaseGateFailure: null,
    promotionGate: null,
    promotionGateFailure: null,
    qualificationRun: null,
    qualificationFailure: null,
    shadowVerdict: null,
    shadowFailure: null,
    shadowPresent: false,
    replayVerdict: null,
    replayFailure: null,
    replayPresent: false,
  }
}

function decisionInput(partial: Partial<DecisionInput> = {}): DecisionInput {
  return { ...emptyInput(), runInProgress: false, ...partial }
}

function releaseGate(partial: Partial<ReleaseGate> = {}): ReleaseGate {
  return {
    copilotId: 'c1',
    candidateVersionId: 'v1',
    checks: [],
    promotable: false,
    evidence: { testRun: null, benchmark: null } as ReleaseGate['evidence'],
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  } as ReleaseGate
}

function promotionGate(partial: Partial<PromotionGateResult> = {}): PromotionGateResult {
  return {
    copilotId: 'c1',
    candidateVersionId: 'v1',
    runtime: 'langgraph',
    overall: 'FAIL',
    promotable: false,
    checks: [],
    registryHash: 'h',
    evaluatedAt: '2026-08-01T00:00:00.000Z',
    ...partial,
  } as PromotionGateResult
}

describe('pipeline — une absence de mesure n’est pas un échec', () => {
  it('rend cinq étapes dans l’ordre du parcours', () => {
    const steps = buildPipeline(emptyInput())
    expect(steps.map((s) => s.id)).toEqual(['tests', 'benchmark', 'shadow', 'replay', 'gate'])
  })

  it('une étape sans preuve est « sans-mesure » et COMPACTE, jamais une carte vide', () => {
    const steps = buildPipeline(emptyInput())
    const tests = steps.find((s) => s.id === 'tests')
    expect(tests?.state).toBe('sans-mesure')
    expect(tests?.compact).toBe(true)
    expect(tests?.summary).toBeNull()
  })

  it('shadow et replay absents sont « non-requis », pas « échoué »', () => {
    const steps = buildPipeline(emptyInput())
    expect(steps.find((s) => s.id === 'shadow')?.state).toBe('non-requis')
    expect(steps.find((s) => s.id === 'replay')?.state).toBe('non-requis')
  })

  it('distingue une lecture ÉCHOUÉE d’une absence de preuve', () => {
    const withFailure = buildPipeline({ ...emptyInput(), shadowFailure: 'backend muet' })
    const shadow = withFailure.find((s) => s.id === 'shadow')
    expect(shadow?.state).toBe('indisponible')
    expect(shadow?.detail).toBe('backend muet')

    const withoutEvidence = buildPipeline(emptyInput())
    expect(withoutEvidence.find((s) => s.id === 'shadow')?.state).toBe('non-requis')
  })

  it('une étape mesurée porte un résumé et cesse d’être compacte', () => {
    const steps = buildPipeline({
      ...emptyInput(),
      releaseGate: releaseGate({
        evidence: {
          testRun: { id: 'r1', passRate: 1, total: 5, passed: 5, hasRecursionError: false },
          benchmark: { score: 96 },
        } as ReleaseGate['evidence'],
      }),
    })
    const tests = steps.find((s) => s.id === 'tests')
    expect(tests?.state).toBe('reussi')
    expect(tests?.summary).toContain('5/5')
    expect(tests?.compact).toBe(false)
  })

  it('une erreur de récursion échoue même avec un taux de succès acceptable', () => {
    const steps = buildPipeline({
      ...emptyInput(),
      releaseGate: releaseGate({
        evidence: {
          testRun: { id: 'r1', passRate: 1, total: 5, passed: 5, hasRecursionError: true },
          benchmark: null,
        } as ReleaseGate['evidence'],
      }),
    })
    expect(steps.find((s) => s.id === 'tests')?.state).toBe('echoue')
  })
})

describe('décision — la fusion des deux gates', () => {
  it('rassemble les conditions des DEUX gates avec leur provenance', () => {
    const decision = buildDecision(
      decisionInput({
        releaseGate: releaseGate({
          checks: [{ id: 'tests-pass', label: 'Tests', status: 'pass', observed: '5/5' }] as ReleaseGate['checks'],
        }),
        promotionGate: promotionGate({
          checks: [
            {
              id: 'release-gate',
              label: 'Release gate',
              status: 'FAIL',
              reason: '1 check failed',
              evidenceRef: null,
              sourceOfTruth: 'release-gate',
              evaluatedAt: '2026-08-01T00:00:00.000Z',
            },
          ] as PromotionGateResult['checks'],
        }),
      })
    )
    expect(decision.satisfied.some((c) => c.source === 'release')).toBe(true)
    expect(decision.blocking.some((c) => c.source === 'promotion')).toBe(true)
  })

  it('nomme la cause EXACTE du blocage, pas une formule vague', () => {
    const decision = buildDecision(
      decisionInput({
        promotionGate: promotionGate({
          checks: [
            {
              id: 'release-gate',
              label: 'Gate de release',
              status: 'FAIL',
              reason: '1 release check(s) failed',
              evidenceRef: null,
              sourceOfTruth: 'release-gate',
              evaluatedAt: '2026-08-01T00:00:00.000Z',
            },
          ] as PromotionGateResult['checks'],
        }),
      })
    )
    // Le libellé ET la valeur observée sont francisés à l'affichage : les
    // modules de gate sont partagés et restent en anglais côté serveur.
    expect(decision.blockingCause).toBe('Gate de release — 1 condition de release en échec')
  })

  it('laisse passer TEL QUEL ce que la table de traduction ne connaît pas', () => {
    const decision = buildDecision(
      decisionInput({
        promotionGate: promotionGate({
          checks: [
            {
              id: 'runtime-executable',
              label: 'Un libellé que personne n’a traduit',
              status: 'FAIL',
              reason: 'une raison inconnue du traducteur',
              evidenceRef: null,
              sourceOfTruth: 'registry',
              evaluatedAt: '2026-08-01T00:00:00.000Z',
            },
          ] as PromotionGateResult['checks'],
        }),
      })
    )
    // Ni réécrit, ni tronqué, ni remplacé par une clé technique.
    expect(decision.blocking[0].label).toBe('Un libellé que personne n’a traduit')
    expect(decision.blocking[0].observed).toBe('une raison inconnue du traducteur')
  })

  it('NOT_CONFIGURED est « non exigé », pas une preuve manquante', () => {
    const decision = buildDecision(
      decisionInput({
        promotionGate: promotionGate({
          checks: [
            {
              id: 'shadow-proof',
              label: 'Shadow',
              status: 'NOT_CONFIGURED',
              reason: 'not required',
              evidenceRef: null,
              sourceOfTruth: 'shadow',
              evaluatedAt: '2026-08-01T00:00:00.000Z',
            },
          ] as PromotionGateResult['checks'],
        }),
      })
    )
    expect(decision.missing).toHaveLength(0)
    expect(decision.satisfied).toHaveLength(1)
  })

  it('INSUFFICIENT_EVIDENCE est une preuve manquante, distincte d’un échec', () => {
    const decision = buildDecision(
      decisionInput({
        promotionGate: promotionGate({
          checks: [
            {
              id: 'replay-comparison',
              label: 'Replay',
              status: 'INSUFFICIENT_EVIDENCE',
              reason: 'no comparison',
              evidenceRef: null,
              sourceOfTruth: 'replay',
              evaluatedAt: '2026-08-01T00:00:00.000Z',
            },
          ] as PromotionGateResult['checks'],
        }),
      })
    )
    expect(decision.missing).toHaveLength(1)
    expect(decision.blocking).toHaveLength(0)
  })

  it('ne recalcule JAMAIS promotable — il vient du serveur', () => {
    // Toutes les conditions passent, mais le serveur dit non : on suit le serveur.
    const decision = buildDecision(
      decisionInput({
        promotionGate: promotionGate({
          promotable: false,
          checks: [
            {
              id: 'runtime-executable',
              label: 'Runtime',
              status: 'PASS',
              reason: 'ok',
              evidenceRef: null,
              sourceOfTruth: 'registry',
              evaluatedAt: '2026-08-01T00:00:00.000Z',
            },
          ] as PromotionGateResult['checks'],
        }),
      })
    )
    expect(decision.promotable).toBe(false)
    expect(decision.state).toBe('bloque')
  })

  it('un run en vol donne « en cours », jamais « bloqué »', () => {
    const decision = buildDecision(decisionInput({ runInProgress: true }))
    expect(decision.state).toBe('en-cours')
  })

  it('deux gates illisibles disent « inconnu », pas « défavorable »', () => {
    const decision = buildDecision(
      decisionInput({ releaseGateFailure: 'muet', promotionGateFailure: 'muet' })
    )
    expect(decision.readable).toBe(false)
    expect(decision.blockingCause).toContain('inconnue')
  })
})

describe('prochaine action — une seule, déduite de l’état', () => {
  it('propose la première étape sans preuve', () => {
    const input = emptyInput()
    const action = nextAction(buildPipeline(input), buildDecision(decisionInput()))
    expect(action.step).toBe('tests')
    expect(action.label).toContain('Tests')
  })

  it('propose la promotion quand le serveur l’autorise', () => {
    const decision = buildDecision(
      decisionInput({ promotionGate: promotionGate({ promotable: true, overall: 'PASS' }) })
    )
    const action = nextAction(buildPipeline(emptyInput()), decision)
    expect(action.step).toBe('promotion')
    expect(action.label).toBe('Promouvoir en production')
  })

  it('n’invite à rien pendant qu’une exécution est en vol', () => {
    const decision = buildDecision(decisionInput({ runInProgress: true }))
    const action = nextAction(buildPipeline(emptyInput()), decision)
    expect(action.label).toContain('en cours')
  })
})
