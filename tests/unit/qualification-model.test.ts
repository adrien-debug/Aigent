/**
 * Qualification — dérivations pures de la surface de qualification & promotion.
 *
 * `model.ts` a été écrit pur et testable et livré sans une seule assertion. Ce
 * fichier comble l'écart, et il ne teste PAS ce qu'un typecheck prouve déjà : il
 * teste ce que l'écran AFFIRME. Quatre familles :
 *
 *  1. Une preuve ABSENTE ne se rend pas comme une preuve favorable. `[].every()`
 *     vaut `true`, `missing` n'est pas `pass`, « pas de baseline » n'est pas
 *     « replay échoué ».
 *  2. Une lecture ÉCHOUÉE ne se rend pas comme un verdict. Un catalogue muet
 *     rend un état neutre, jamais « 3/3 condition(s) manquante(s) ».
 *  3. Un compteur NON MESURÉ reste `null`. Jamais 0 — surtout pas sur
 *     `wouldMutateCount`, où un 0 se lit comme un certificat d'innocuité.
 *  4. Dans le doute, l'action FACTURÉE reste éteinte.
 */
import { describe, expect, it, vi } from 'vitest'

// `server-reads.ts` est `server-only` : la couche de lecture est exercée pour de
// vrai (D1), avec seulement PostgREST remplacé.
vi.mock('server-only', () => ({}))

import {
  canGenerateSuites,
  parseModelLine,
  parseModelList,
  replayFeasibility,
  runBlockerCount,
  runGuardConditions,
  runGuardDivergence,
  runGuardWouldAccept,
  suiteReadState,
  summarizeChecks,
} from '@/components/qualification/model'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { ReleaseCheck } from '@/lib/agent-mission-control/release-gate'

/* ─────────────────── Fixtures ─────────────────── */

function check(over: Partial<ReleaseCheck> = {}): ReleaseCheck {
  return {
    id: 'tests-pass',
    label: 'Tests',
    status: 'pass',
    observed: '3/3',
    required: '100%',
    ...over,
  }
}

/** Un agent canonique qui satisfait les TROIS conditions de la garde. */
function agent(over: Partial<AvailableAgent> = {}): AvailableAgent {
  return {
    copilotId: 'cp-1',
    projectId: null,
    name: 'Alpha',
    description: null,
    version: 'v1',
    versionStage: 'production',
    status: 'active',
    lifecycleStatus: 'active',
    runtime: 'langgraph',
    executable: true,
    assistantId: 'asst-1',
    runtimeProvisioned: true,
    provider: null,
    configuredModel: null,
    executedModel: null,
    tools: [],
    capabilities: [],
    readOnly: true,
    requiresHumanApproval: false,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunCostUsd: null,
    unavailableFields: [],
    unresolvedToolIds: [],
    ...over,
  } as AvailableAgent
}

/* ══════════════════ summarizeChecks ══════════════════ */

describe('summarizeChecks — une preuve absente n’est pas un feu vert', () => {
  it('une liste VIDE n’est jamais promouvable (`[].every()` vaut true en JS)', () => {
    const summary = summarizeChecks([])

    // C'est LE piège que la fonction existe pour désamorcer : sans le
    // `total > 0`, « aucun check en échec » se lirait comme « tout passe ».
    expect(summary.promotable).toBe(false)
    expect(summary.total).toBe(0)
    expect(summary.passed).toBe(0)
    expect(summary.blocking).toBe(0)
  })

  it('un `missing` bloque, et il est compté SÉPARÉMENT d’un `failed`', () => {
    const summary = summarizeChecks([
      check({ id: 'tests-pass', status: 'pass' }),
      check({ id: 'benchmark-exists', status: 'missing' }),
    ])

    expect(summary.promotable).toBe(false)
    expect(summary.missing).toBe(1)
    // Un signal jamais mesuré n'accuse rien : le confondre avec un échec
    // établi ferait chercher une régression là où il n'y a qu'un trou.
    expect(summary.failed).toBe(0)
    expect(summary.blocking).toBe(1)
  })

  it('un `failed` est compté comme échec, pas comme non mesuré', () => {
    const summary = summarizeChecks([check({ status: 'fail' })])

    expect(summary.failed).toBe(1)
    expect(summary.missing).toBe(0)
    expect(summary.promotable).toBe(false)
  })

  it('ne rend promouvable que si TOUS les checks passent ET qu’il y en a', () => {
    const summary = summarizeChecks([
      check({ id: 'tests-pass' }),
      check({ id: 'benchmark-exists' }),
    ])

    expect(summary.promotable).toBe(true)
    expect(summary.blocking).toBe(0)
  })
})

/* ══════════════════ runGuardConditions ══════════════════ */

describe('runGuardConditions — les trois conditions, LUES et jamais recalculées', () => {
  it('nomme les trois conditions et les rend satisfaites sur un agent conforme', () => {
    const conditions = runGuardConditions(agent())

    expect(conditions.map((c) => c.id)).toEqual([
      'status-active',
      'tools-resolved',
      'runtime-langgraph',
    ])
    expect(conditions.every((c) => c.satisfied)).toBe(true)
    expect(runGuardWouldAccept(conditions)).toBe(true)
  })

  it('recopie `status` tel quel — l’observé vient du contrat, pas d’une réécriture', () => {
    const conditions = runGuardConditions(agent({ status: 'degraded', executable: false }))
    const statusCondition = conditions.find((c) => c.id === 'status-active')

    expect(statusCondition?.satisfied).toBe(false)
    expect(statusCondition?.observed).toBe('degraded')
  })

  it('compte les outils non résolus sans les inventer', () => {
    const conditions = runGuardConditions(
      agent({ unresolvedToolIds: ['a', 'b'], executable: false }),
    )
    const tools = conditions.find((c) => c.id === 'tools-resolved')

    expect(tools?.satisfied).toBe(false)
    expect(tools?.observed).toBe('2 non résolu(s)')
  })

  it('un runtime NON résolu (`null`) ne se rend pas comme un runtime valide', () => {
    const conditions = runGuardConditions(agent({ runtime: null, executable: false }))
    const runtime = conditions.find((c) => c.id === 'runtime-langgraph')

    expect(runtime?.satisfied).toBe(false)
    // Pas de `'langgraph'` fabriqué, pas de chaîne vide : une colonne vide se dit.
    expect(runtime?.observed).toBe('runtime non résolu')
  })

  it('un runtime autre que langgraph ne tient pas — seul runtime produit exécutable', () => {
    const conditions = runGuardConditions(agent({ runtime: 'openai-assistants', executable: false }))

    expect(runGuardWouldAccept(conditions)).toBe(false)
  })
})

/* ══════════════════ runGuardDivergence ══════════════════ */

describe('runGuardDivergence — un écart avec le contrat canonique est AFFICHÉ, pas tu', () => {
  it('rend `null` quand le rejeu et `executable` concordent', () => {
    const a = agent()
    expect(runGuardDivergence(a, runGuardConditions(a))).toBeNull()
  })

  it('rend `null` quand les deux disent « non lançable »', () => {
    const a = agent({ status: 'degraded', executable: false })
    expect(runGuardDivergence(a, runGuardConditions(a))).toBeNull()
  })

  it('détecte l’écart quand le contrat dit lançable et que les conditions non', () => {
    // Le cas dangereux : la dérivation canonique a bougé sans que cet écran le
    // sache. L'écran doit le DIRE plutôt que d'afficher l'un des deux.
    const a = agent({ runtime: 'openai-assistants', executable: true })
    const divergence = runGuardDivergence(a, runGuardConditions(a))

    expect(divergence).not.toBeNull()
    expect(divergence).toContain('contrat canonique')
  })

  it('détecte aussi l’écart dans l’autre sens', () => {
    const a = agent({ executable: false })
    expect(runGuardDivergence(a, runGuardConditions(a))).not.toBeNull()
  })
})

/* ══════════════════ replayFeasibility ══════════════════ */

describe('replayFeasibility — « pas de baseline » n’est pas « replay échoué »', () => {
  it('`possible` quand une version de production a été lue', () => {
    expect(replayFeasibility('v-prod', true)).toBe('possible')
  })

  it('`no-baseline` quand la lecture a réussi et qu’il n’y a pas de production', () => {
    // Dépendance circulaire structurelle : la route répond 409 AVANT toute
    // exécution. Rien n'a échoué — il n'y a rien à comparer.
    expect(replayFeasibility(null, true)).toBe('no-baseline')
  })

  it('`unknown` quand le pointeur n’a PAS pu être lu — distinct de `no-baseline`', () => {
    expect(replayFeasibility(null, false)).toBe('unknown')
    expect(replayFeasibility(null, false)).not.toBe('no-baseline')
  })

  it('une lecture échouée reste `unknown` même si un id traîne', () => {
    expect(replayFeasibility('v-prod', false)).toBe('unknown')
  })
})

/* ══════════════════ parseModelLine ══════════════════ */

describe('parseModelLine — `mistral` n’est pas câblé, donc pas accepté', () => {
  it('accepte les trois providers que la route valide', () => {
    expect(parseModelLine('openai:gpt-4o-mini')).toEqual({
      modelProvider: 'openai',
      model: 'gpt-4o-mini',
    })
    expect(parseModelLine('google:gemini-2.0-flash')).toEqual({
      modelProvider: 'google',
      model: 'gemini-2.0-flash',
    })
    expect(parseModelLine('local:qwen')).toEqual({ modelProvider: 'local', model: 'qwen' })
  })

  it('REJETTE `mistral` — le model-router ne le câble pas', () => {
    // L'accepter produirait N exécutions facturées vouées à une erreur typée.
    expect(parseModelLine('mistral:mistral-large')).toBeNull()
  })

  it('rejette une ligne sans provider, sans modèle, ou vide', () => {
    expect(parseModelLine('gpt-4o-mini')).toBeNull()
    expect(parseModelLine('openai:')).toBeNull()
    expect(parseModelLine(':gpt-4o-mini')).toBeNull()
    expect(parseModelLine('')).toBeNull()
  })

  it('préserve un modèle qui contient lui-même un `:`', () => {
    expect(parseModelLine('local:org/model:v2')).toEqual({
      modelProvider: 'local',
      model: 'org/model:v2',
    })
  })

  it('parseModelList ÉCARTE les lignes invalides plutôt que de les deviner', () => {
    const parsed = parseModelList('openai:gpt-4o-mini\nmistral:large\n\n  google:gemini  ')

    // Le compte affiché à l'opérateur doit être celui des lignes RETENUES :
    // croire balayer trois modèles et en balayer deux est une facture surprise.
    expect(parsed).toEqual([
      { modelProvider: 'openai', model: 'gpt-4o-mini' },
      { modelProvider: 'google', model: 'gemini' },
    ])
  })

  it('une saisie entièrement invalide rend une liste vide — le balayage ne part pas', () => {
    expect(parseModelList('mistral:a\nn’importe quoi')).toEqual([])
  })
})

/* ══════════════════ D2 — catalogue muet ══════════════════ */

describe('runBlockerCount (D2) — une lecture échouée n’est pas un verdict accusateur', () => {
  it('rend `null` quand aucun contrat canonique ne résout — JAMAIS 3', () => {
    // Le défaut corrigé : `getAvailableAgents()` en échec vidait la Map, chaque
    // ligne obtenait 3, et TOUT le roster passait en rouge « 3/3 condition(s)
    // manquante(s) ». Une panne de lecture rendue en accusation mesurée.
    expect(runBlockerCount(null)).toBeNull()
    expect(runBlockerCount(null)).not.toBe(3)
  })

  it('rend 0 sur un agent conforme — un vrai 0 mesuré', () => {
    expect(runBlockerCount(agent())).toBe(0)
  })

  it('compte les conditions réellement non tenues', () => {
    expect(runBlockerCount(agent({ status: 'degraded', executable: false }))).toBe(1)
    expect(
      runBlockerCount(
        agent({ status: 'inactive', runtime: null, unresolvedToolIds: ['x'], executable: false }),
      ),
    ).toBe(3)
  })

  it('un 3 MESURÉ et un `null` non mesuré sont deux valeurs distinctes', () => {
    const measured = runBlockerCount(
      agent({ status: 'inactive', runtime: null, unresolvedToolIds: ['x'], executable: false }),
    )
    const unknown = runBlockerCount(null)

    // C'est toute la correction : le roster peut désormais peindre l'un en
    // rouge et l'autre en neutre, parce que les deux ne sont plus le même 3.
    expect(measured).toBe(3)
    expect(unknown).toBeNull()
    expect(measured).not.toBe(unknown)
  })
})

/* ══════════════════ D3 — lecture de suites & dépense ══════════════════ */

describe('suiteReadState / canGenerateSuites (D3) — dans le doute, l’action facturée reste éteinte', () => {
  it('une lecture réussie et vide est un vide PROUVÉ', () => {
    expect(suiteReadState([], null)).toEqual({ read: true, firstId: null })
  })

  it('une lecture ÉCHOUÉE n’est pas un vide — `read: false`', () => {
    expect(suiteReadState([], 'PostgREST timeout')).toEqual({ read: false, firstId: null })
  })

  it('une lecture échouée n’expose AUCUN id, même si des lignes traînent', () => {
    expect(suiteReadState([{ id: 's-1' }], 'PostgREST timeout').firstId).toBeNull()
  })

  it('la génération FACTURÉE reste éteinte quand le registre n’a pas été lu', () => {
    // Le défaut corrigé : `testSuiteId = null` sur une lecture échouée
    // RALLUMAIT « Générer la suite » — une génération LLM facturée de suites
    // qui existent déjà. Le seul défaut de la PR qui coûte de l'argent réel.
    const unread = suiteReadState([], 'PostgREST timeout')
    const read = suiteReadState([], null)

    expect(canGenerateSuites(unread, read)).toBe(false)
    expect(canGenerateSuites(read, unread)).toBe(false)
    expect(canGenerateSuites(unread, unread)).toBe(false)
  })

  it('la génération est proposée quand la lecture a PROUVÉ qu’il manque une suite', () => {
    expect(canGenerateSuites(suiteReadState([], null), suiteReadState([], null))).toBe(true)
    expect(
      canGenerateSuites(suiteReadState([{ id: 's-1' }], null), suiteReadState([], null)),
    ).toBe(true)
  })

  it('la génération est éteinte quand les deux suites existent (idempotence)', () => {
    expect(
      canGenerateSuites(
        suiteReadState([{ id: 's-1' }], null),
        suiteReadState([{ id: 'b-1' }], null),
      ),
    ).toBe(false)
  })

  it('« suites présentes mais non lues » et « aucune suite » ne donnent pas le même geste', () => {
    // Les deux ont `firstId === null` ; seule la lecture les distingue, et
    // c'est cette distinction qui décide d'une dépense.
    const unread = suiteReadState([{ id: 's-1' }], 'boom')
    const provenEmpty = suiteReadState([], null)

    expect(unread.firstId).toBe(provenEmpty.firstId)
    expect(canGenerateSuites(unread, unread)).not.toBe(
      canGenerateSuites(provenEmpty, provenEmpty),
    )
  })
})

/* ══════════════════ D1 — compteurs de sécurité non mesurés ══════════════════ */

/**
 * La lecture shadow / replay, exercée POUR DE VRAI.
 *
 * Seuls PostgREST et les résolveurs lourds sont remplacés : la coercion testée
 * vit dans `readShadow` / `readReplay`, et c'est cette ligne-là qu'on veut voir
 * s'exécuter. Un test qui réécrirait la règle ne prouverait rien.
 */
describe('lecture shadow / replay (D1) — un compteur non enregistré reste `null`', () => {
  async function loadWith(shadowRow: Record<string, unknown>, replayRow: Record<string, unknown>) {
    vi.resetModules()

    vi.doMock('@/lib/agent-mission-control/postgrest', () => ({
      pgrest: async (_method: string, path: string) => {
        if (path.startsWith('copilots?')) {
          return [
            {
              id: 'cp-1',
              name: 'Alpha',
              production_version_id: 'v-prod',
              latest_version_id: 'v-prod',
            },
          ]
        }
        if (path.startsWith('shadow_experiments?')) return [shadowRow]
        if (path.startsWith('replay_comparisons?')) return [replayRow]
        return []
      },
    }))

    // Les résolveurs voisins n'ont aucun rôle dans cette règle : neutralisés
    // pour que l'échec, s'il arrive, désigne la coercion et rien d'autre.
    vi.doMock('@/lib/agent-mission-control/available-agents', () => ({
      getAvailableAgent: async () => undefined,
      getAvailableAgents: async () => [],
    }))
    vi.doMock('@/lib/agent-mission-control/data', () => ({
      getVersionsForCopilot: async () => [],
      getTestSuitesForCopilot: async () => [],
      getBenchmarkSuitesForCopilot: async () => [],
    }))
    vi.doMock('@/lib/agent-mission-control/improvement-loop', () => ({
      getLatestProposalForCopilot: async () => null,
    }))
    vi.doMock('@/lib/agent-mission-control/promotion-gate', () => ({
      evaluatePromotionGate: async () => null,
    }))
    vi.doMock('@/lib/agent-mission-control/promotion-policy', () => ({
      resolvePromotionPolicy: async () => ({ policy: {} }),
    }))
    vi.doMock('@/lib/agent-mission-control/qualification-orchestrator', () => ({
      getLatestQualificationRun: async () => null,
    }))
    vi.doMock('@/lib/agent-mission-control/release-gate', () => ({
      evaluateReleaseGate: async () => null,
    }))

    const { loadQualificationDetail } = await import(
      '@/components/qualification/server-reads'
    )
    return loadQualificationDetail('cp-1')
  }

  it('une colonne ABSENTE rend `null`, jamais 0', async () => {
    const detail = await loadWith(
      { id: 'sh-1', status: 'completed', candidate_verdict: 'PASS' },
      { id: 'rp-1', status: 'completed', verdict: 'EQUIVALENT' },
    )

    // `would_mutate_count` est le cas coûteux : un 0 s'affiche avec le hint
    // « un 0 ici est un 0 MESURÉ, c'est le résultat attendu ». Un compteur de
    // mutations JAMAIS enregistré délivrerait donc un certificat d'innocuité.
    expect(detail?.shadow?.wouldMutateCount).toBeNull()
    expect(detail?.shadow?.wouldMutateCount).not.toBe(0)
    expect(detail?.shadow?.sampledRunCount).toBeNull()
    expect(detail?.replay?.caseCount).toBeNull()
  })

  it('une colonne NULL rend `null`', async () => {
    const detail = await loadWith(
      {
        id: 'sh-1',
        status: 'completed',
        sampled_run_count: null,
        would_mutate_count: null,
      },
      { id: 'rp-1', status: 'completed', case_count: null },
    )

    expect(detail?.shadow?.wouldMutateCount).toBeNull()
    expect(detail?.shadow?.sampledRunCount).toBeNull()
    expect(detail?.replay?.caseCount).toBeNull()
  })

  it('un 0 RÉELLEMENT enregistré reste 0 — la correction ne détruit pas la mesure', async () => {
    const detail = await loadWith(
      {
        id: 'sh-1',
        status: 'completed',
        sampled_run_count: 12,
        would_mutate_count: 0,
      },
      { id: 'rp-1', status: 'completed', case_count: 0 },
    )

    // Le vrai 0 est l'information utile du panneau : le shadow a intercepté
    // toutes les mutations. Il doit survivre à la correction.
    expect(detail?.shadow?.wouldMutateCount).toBe(0)
    expect(detail?.shadow?.sampledRunCount).toBe(12)
    expect(detail?.replay?.caseCount).toBe(0)
  })

  it('une valeur non numérique n’est pas coercée', async () => {
    const detail = await loadWith(
      { id: 'sh-1', status: 'completed', would_mutate_count: 'trois' },
      { id: 'rp-1', status: 'completed', case_count: '0' },
    )

    expect(detail?.shadow?.wouldMutateCount).toBeNull()
    expect(detail?.replay?.caseCount).toBeNull()
  })
})
