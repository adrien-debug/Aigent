/**
 * Unit tests — les dérivations pures de la surface Livraison.
 *
 * Ce qui est testé ici est exactement ce qui, mal écrit, transforme une absence
 * en mesure ou un non-savoir en échec, une ligne avant les pixels :
 *
 *  · les DEUX inconnues structurelles (`merge_unknown`,
 *    `consumer_activation_unknown`) doivent rester vraies EN TOUTES
 *    CIRCONSTANCES et ne dépendre d'aucune lecture — c'est ce qui les
 *    distingue d'une donnée manquante ;
 *  · le FAIT MESURÉ (`no_consumer_telemetry`) doit être atteint sur un compte
 *    de 0 lu, et INCONNU (`null`) sur une lecture absente. Les deux « ne
 *    montrent rien » et sont pourtant des affirmations opposées ;
 *  · une lecture d'événement de livraison qui a ÉCHOUÉ ne doit jamais compter
 *    comme « jamais livré » ;
 *  · `readPushOutcome` ne doit JAMAIS annoncer une écriture sur une réponse
 *    `dryRun: true`, même quand la route répond `pushed: true` ;
 *  · le score de la scorecard ne doit pas s'afficher quand aucune dimension
 *    n'a été mesurée (un 0 arithmétique n'est pas un verdict).
 */
import { describe, expect, it } from 'vitest'

import { readPushOutcome } from '@/components/delivery/actions'
import {
  DELIVERY_STATE_ORDER,
  countDeliveryRows,
  countSandboxChecks,
  deliveryModeLabel,
  deriveDeliveryStates,
  sandboxModeMeaning,
  scorecardMeasuredRatio,
  scorecardScoreIsMeaningful,
  sortDeliveryRows,
  type DeliveryObservation,
  type DeliveryRow,
} from '@/components/delivery/model'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { AgentDeliveryScorecard } from '@/lib/agent-mission-control/delivery-scorecard'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'

/* ─────────────────── Fabriques ─────────────────── */

function event(over: Partial<DeliveryEvent> = {}): DeliveryEvent {
  return {
    id: 'delivery_1',
    versionId: 'v1',
    mode: 'pull_request',
    targetRepo: 'acme/console',
    targetBranch: 'main',
    deliveryBranch: 'aigent/agent-x',
    commitSha: 'abcdef1234567890',
    commitUrl: 'https://github.com/acme/console/commit/abcdef1',
    prUrl: 'https://github.com/acme/console/pull/7',
    prNumber: 7,
    status: 'delivered',
    createdAt: '2026-07-30T10:00:00.000Z',
    ...over,
  }
}

function observation(over: Partial<DeliveryObservation> = {}): DeliveryObservation {
  return {
    realDeliveryEnabled: false,
    latestDelivery: null,
    deliveryRead: true,
    consumerTelemetryCount: 0,
    telemetryEventCount: 38,
    ...over,
  }
}

function row(over: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    copilotId: 'c-1',
    copilotName: 'Agent',
    projectId: 'p-1',
    projectName: 'Console',
    repoFullName: 'acme/console',
    deliveryRead: true,
    latestDelivery: null,
    ...over,
  }
}

const byId = (states: ReturnType<typeof deriveDeliveryStates>, id: string) => {
  const found = states.find((s) => s.id === id)
  if (!found) throw new Error(`état absent de la dérivation : ${id}`)
  return found
}

/* ═════════════════ Les huit états ═════════════════ */

describe('deriveDeliveryStates — les huit états sont distincts', () => {
  it('rend exactement les huit états, sans doublon', () => {
    const states = deriveDeliveryStates(observation())
    expect(states).toHaveLength(8)
    expect(new Set(states.map((s) => s.id)).size).toBe(8)
    // L'ordre déclaré couvre exactement les états dérivés — un état ajouté à
    // l'un sans l'autre laisserait un état invisible ou un ordre incomplet.
    expect([...DELIVERY_STATE_ORDER].sort()).toEqual([...states.map((s) => s.id)].sort())
  })

  it('les deux INCONNUES STRUCTURELLES sont vraies quelles que soient les lectures', () => {
    // Le pire cas possible : rien n'a été lu, rien n'existe.
    const blind = deriveDeliveryStates(
      observation({
        realDeliveryEnabled: null,
        deliveryRead: false,
        consumerTelemetryCount: null,
        telemetryEventCount: null,
      }),
    )
    // Le meilleur cas possible : tout a été lu, tout existe.
    const full = deriveDeliveryStates(
      observation({ realDeliveryEnabled: true, latestDelivery: event(), consumerTelemetryCount: 12 }),
    )

    for (const states of [blind, full]) {
      expect(byId(states, 'merge_unknown').reached).toBe(true)
      expect(byId(states, 'merge_unknown').kind).toBe('structural_unknown')
      expect(byId(states, 'consumer_activation_unknown').reached).toBe(true)
      expect(byId(states, 'consumer_activation_unknown').kind).toBe('structural_unknown')
    }
  })

  it('une inconnue structurelle n’est JAMAIS classée comme observée ou mesurée', () => {
    const states = deriveDeliveryStates(observation())
    const structural = states.filter((s) => s.kind === 'structural_unknown')
    expect(structural.map((s) => s.id).sort()).toEqual([
      'consumer_activation_unknown',
      'merge_unknown',
    ])
  })

  it('« aucune télémétrie consommateur » est un FAIT MESURÉ quand le compte lu vaut 0', () => {
    const states = deriveDeliveryStates(
      observation({ consumerTelemetryCount: 0, telemetryEventCount: 38 }),
    )
    const s = byId(states, 'no_consumer_telemetry')
    expect(s.reached).toBe(true)
    expect(s.kind).toBe('measured_absence')
    // La preuve porte le DÉNOMINATEUR : « 0 sur 38 », jamais « 0 » tout court.
    expect(s.evidence).toContain('38')
  })

  it('« aucune télémétrie consommateur » est INCONNU — pas faux — quand rien n’a été lu', () => {
    const states = deriveDeliveryStates(
      observation({ consumerTelemetryCount: null, telemetryEventCount: null }),
    )
    const s = byId(states, 'no_consumer_telemetry')
    // `null` et non `false` : `false` affirmerait qu'il EXISTE de la télémétrie
    // consommateur, ce qui est exactement l'inverse de ce qui est su.
    expect(s.reached).toBeNull()
    expect(s.evidence).toBeNull()
  })

  it('« aucune télémétrie » n’est PAS atteint quand des événements consumer existent', () => {
    const states = deriveDeliveryStates(observation({ consumerTelemetryCount: 3 }))
    expect(byId(states, 'no_consumer_telemetry').reached).toBe(false)
  })

  it('shipping désactivé se lit depuis la capacité serveur, jamais deviné', () => {
    expect(byId(deriveDeliveryStates(observation({ realDeliveryEnabled: false })), 'shipping_disabled').reached).toBe(true)
    expect(byId(deriveDeliveryStates(observation({ realDeliveryEnabled: true })), 'shipping_disabled').reached).toBe(false)
    // Capacité non lue ⇒ on ne prétend pas savoir si le shipping est désactivé.
    expect(byId(deriveDeliveryStates(observation({ realDeliveryEnabled: null })), 'shipping_disabled').reached).toBeNull()
  })

  it('« confirmation requise » et « shipping désactivé » sont opposés, jamais simultanés', () => {
    const off = deriveDeliveryStates(observation({ realDeliveryEnabled: false }))
    expect(byId(off, 'shipping_disabled').reached).toBe(true)
    expect(byId(off, 'confirmation_required').reached).toBe(false)

    const on = deriveDeliveryStates(observation({ realDeliveryEnabled: true }))
    expect(byId(on, 'shipping_disabled').reached).toBe(false)
    expect(byId(on, 'confirmation_required').reached).toBe(true)
  })

  it('« dry-run effectué » reste INCONNU : un dry-run n’est jamais persisté', () => {
    // Même avec une livraison réelle en base, on ne peut rien affirmer sur les
    // dry-runs : `agent_delivery_events` n'enregistre que les écritures réelles.
    const states = deriveDeliveryStates(observation({ latestDelivery: event() }))
    expect(byId(states, 'dry_run_done').reached).toBeNull()
  })

  it('« push réussi » et « PR ouverte » sont deux faits distincts', () => {
    const direct = deriveDeliveryStates(
      observation({ latestDelivery: event({ mode: 'direct_commit', prUrl: null, prNumber: null }) }),
    )
    expect(byId(direct, 'push_succeeded').reached).toBe(true)
    expect(byId(direct, 'pr_opened').reached).toBe(false)

    const pr = deriveDeliveryStates(observation({ latestDelivery: event() }))
    expect(byId(pr, 'push_succeeded').reached).toBe(true)
    expect(byId(pr, 'pr_opened').reached).toBe(true)
  })

  it('une lecture d’événement ÉCHOUÉE laisse push/PR inconnus, jamais faux', () => {
    const states = deriveDeliveryStates(observation({ deliveryRead: false, latestDelivery: null }))
    expect(byId(states, 'push_succeeded').reached).toBeNull()
    expect(byId(states, 'pr_opened').reached).toBeNull()
    expect(byId(states, 'push_succeeded').evidence).toBeNull()
  })

  it('une lecture RÉUSSIE et vide rend push/PR faux — un fait, pas une ignorance', () => {
    const states = deriveDeliveryStates(observation({ deliveryRead: true, latestDelivery: null }))
    expect(byId(states, 'push_succeeded').reached).toBe(false)
    expect(byId(states, 'pr_opened').reached).toBe(false)
    // Et la preuve dit POURQUOI c'est faux.
    expect(byId(states, 'push_succeeded').evidence).toContain('Aucun événement')
  })

  it('chaque état porte une signification non vide — jamais un code nu à l’écran', () => {
    for (const s of deriveDeliveryStates(observation())) {
      expect(s.meaning.length).toBeGreaterThan(20)
      expect(s.label.length).toBeGreaterThan(0)
    }
  })
})

/* ═════════════════ Le roster ═════════════════ */

describe('countDeliveryRows — une lecture échouée n’est pas une absence de livraison', () => {
  it('ne compte pas une ligne NON LUE parmi les « jamais livrés »', () => {
    const counts = countDeliveryRows([
      row({ copilotId: 'a', deliveryRead: true, latestDelivery: event() }),
      row({ copilotId: 'b', deliveryRead: true, latestDelivery: null }),
      row({ copilotId: 'c', deliveryRead: false, latestDelivery: null }),
    ])
    expect(counts.total).toBe(3)
    expect(counts.delivered).toBe(1)
    expect(counts.neverDelivered).toBe(1)
    expect(counts.notRead).toBe(1)
    // La somme des trois catégories couvre le total : aucune ligne n'est
    // silencieusement rangée dans la mauvaise.
    expect(counts.delivered + counts.neverDelivered + counts.notRead).toBe(counts.total)
  })

  it('compte les PR et les commits séparément', () => {
    const counts = countDeliveryRows([
      row({ copilotId: 'a', latestDelivery: event() }),
      row({ copilotId: 'b', latestDelivery: event({ prUrl: null, prNumber: null }) }),
      row({ copilotId: 'c', latestDelivery: event({ commitSha: null }) }),
    ])
    expect(counts.withPr).toBe(2)
    expect(counts.withCommit).toBe(2)
  })

  it('compte les agents sans dépôt cible — une livraison y est impossible', () => {
    const counts = countDeliveryRows([
      row({ copilotId: 'a', repoFullName: 'acme/console' }),
      row({ copilotId: 'b', repoFullName: null }),
    ])
    expect(counts.withoutRepo).toBe(1)
  })
})

describe('sortDeliveryRows', () => {
  it('range les lignes NON LUES en dernier, jamais noyées parmi les non livrées', () => {
    const sorted = sortDeliveryRows([
      row({ copilotId: 'c', copilotName: 'Charlie', deliveryRead: false }),
      row({ copilotId: 'b', copilotName: 'Bravo', latestDelivery: null }),
      row({ copilotId: 'a', copilotName: 'Alpha', latestDelivery: event() }),
    ])
    expect(sorted.map((r) => r.copilotId)).toEqual(['a', 'b', 'c'])
  })

  it('trie par nom à rang égal, de façon stable', () => {
    const sorted = sortDeliveryRows([
      row({ copilotId: 'z', copilotName: 'Zoulou' }),
      row({ copilotId: 'e', copilotName: 'Écho' }),
      row({ copilotId: 'a', copilotName: 'Alpha' }),
    ])
    expect(sorted.map((r) => r.copilotId)).toEqual(['a', 'e', 'z'])
  })
})

describe('deliveryModeLabel', () => {
  it('traduit les deux modes connus', () => {
    expect(deliveryModeLabel('pull_request')).toBe('Pull request')
    expect(deliveryModeLabel('direct_commit')).toBe('Commit direct')
  })

  it('rend un mode inconnu TEL QUEL plutôt que de le ranger d’office', () => {
    expect(deliveryModeLabel('something_else')).toBe('something_else')
    expect(deliveryModeLabel(null)).toBeNull()
  })
})

/* ═════════════════ L'issue d'une livraison ═════════════════ */

describe('readPushOutcome — le serveur décide, jamais l’intention du clic', () => {
  it('n’annonce PAS une écriture quand la route répond dryRun:true', () => {
    // Le cas exact du double verrou : l'opérateur a confirmé, le serveur a
    // refusé d'armer, la route renvoie `pushed:true, dryRun:true`.
    const out = readPushOutcome({ pushed: true, dryRun: true, prUrl: 'https://github.com/a/b/pull/1' })
    expect(out.wrote).toBe(false)
    expect(out.stateId).toBe('dry_run_done')
    expect(out.title).toContain('Dry-run')
  })

  it('annonce une PR ouverte seulement sur une écriture RÉELLE avec une URL de PR', () => {
    const out = readPushOutcome({ pushed: true, dryRun: false, prUrl: 'https://github.com/a/b/pull/1' })
    expect(out.wrote).toBe(true)
    expect(out.stateId).toBe('pr_opened')
  })

  it('annonce un commit sur une écriture réelle sans PR', () => {
    const out = readPushOutcome({ pushed: true, dryRun: false, prUrl: null, commitSha: 'abc' })
    expect(out.wrote).toBe(true)
    expect(out.stateId).toBe('push_succeeded')
  })

  it('ne conclut à aucune écriture quand la réponse est muette', () => {
    // Ni `pushed` ni `dryRun` : on ne présume PAS l'écriture.
    expect(readPushOutcome({}).wrote).toBe(false)
    expect(readPushOutcome({ pushed: true }).wrote).toBe(false)
    expect(readPushOutcome({ dryRun: false }).wrote).toBe(false)
  })
})

/* ═════════════════ Scorecard ═════════════════ */

function card(over: Partial<AgentDeliveryScorecard> = {}): AgentDeliveryScorecard {
  return {
    score: 0,
    level: 'not_ready',
    status: 'fail',
    dimensions: [],
    blockers: [],
    warnings: [],
    target: 'candidate',
    targetVersionId: null,
    productionVersionId: null,
    candidateVersionId: null,
    isProductionServed: false,
    hasDifferentCandidate: false,
    evidence: {},
    ...over,
  }
}

describe('scorecardScoreIsMeaningful — un 0 arithmétique n’est pas un verdict', () => {
  it('refuse le score quand TOUTES les dimensions sont non mesurées', () => {
    const c = card({
      dimensions: [
        { id: 'tests', label: 'Tests', score: null, status: 'missing' },
        { id: 'benchmark', label: 'Benchmark', score: null, status: 'missing' },
      ],
    })
    expect(scorecardScoreIsMeaningful(c)).toBe(false)
    expect(scorecardMeasuredRatio(c)).toEqual({ measured: 0, total: 2 })
  })

  it('accepte le score dès qu’UNE dimension est mesurée, même en échec', () => {
    const c = card({
      dimensions: [
        { id: 'tests', label: 'Tests', score: 0, status: 'fail' },
        { id: 'benchmark', label: 'Benchmark', score: null, status: 'missing' },
      ],
    })
    expect(scorecardScoreIsMeaningful(c)).toBe(true)
    expect(scorecardMeasuredRatio(c)).toEqual({ measured: 1, total: 2 })
  })

  it('une scorecard sans aucune dimension n’a pas de score affichable', () => {
    expect(scorecardScoreIsMeaningful(card())).toBe(false)
  })
})

/* ═════════════════ Sandbox ═════════════════ */

function report(over: Partial<TargetRepoSandboxReport> = {}): TargetRepoSandboxReport {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    agentSlug: 'agent-x',
    repo: 'acme/console',
    branch: 'main',
    commit: null,
    executionMode: 'dry_run',
    installMode: 'skip',
    sandboxKept: false,
    status: 'passed',
    repoFitScore: null,
    sandboxFitScore: null,
    checks: [],
    artifacts: {},
    warnings: [],
    blockers: [],
    createdAt: '2026-07-30T10:00:00.000Z',
    ...over,
  }
}

describe('sandboxModeMeaning — un dry-run vert ne prouve rien sur les scripts', () => {
  it('dit explicitement que les scripts n’ont pas tourné en dry-run', () => {
    expect(sandboxModeMeaning(report({ executionMode: 'dry_run' }))).toContain('jamais exécutés')
  })

  it('dit que les scripts ont réellement tourné en mode execute', () => {
    expect(sandboxModeMeaning(report({ executionMode: 'execute' }))).toContain('réellement')
  })
})

describe('countSandboxChecks — un check « non exécuté » n’est ni passé ni échoué', () => {
  it('compte les quatre statuts séparément', () => {
    const counts = countSandboxChecks(
      report({
        checks: [
          { id: '1', label: 'a', status: 'passed' },
          { id: '2', label: 'b', status: 'failed' },
          { id: '3', label: 'c', status: 'warning' },
          { id: '4', label: 'd', status: 'skipped' },
          { id: '5', label: 'e', status: 'skipped' },
        ],
      }),
    )
    expect(counts).toEqual({ passed: 1, failed: 1, warning: 1, skipped: 2, total: 5 })
    // Les « skipped » ne gonflent jamais les « passed » : c'est tout l'enjeu en
    // dry-run, où TOUS les scripts du dépôt cible sont skipped.
    expect(counts.passed).not.toBe(counts.passed + counts.skipped)
  })

  it('rend des compteurs à zéro sur un rapport sans check — un compte, pas une absence', () => {
    expect(countSandboxChecks(report())).toEqual({
      passed: 0,
      failed: 0,
      warning: 0,
      skipped: 0,
      total: 0,
    })
  })
})
