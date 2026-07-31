/**
 * Unit tests — les dérivations pures de la surface Agents.
 *
 * Ce qui est testé ici est exactement ce qui, mal écrit, transforme une absence
 * en mesure une ligne avant les pixels : le câblage des providers, la lecture de
 * `unavailableFields`, et les trois vocabulaires d'absence (`missing` de la
 * gate, `unknown` du cycle de vie, `null` d'une mesure).
 */
import { describe, expect, it } from 'vitest'

import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { ReleaseCheck } from '@/lib/agent-mission-control/release-gate'
import type { LifecycleStage } from '@/lib/agent-mission-control/agent-lifecycle-trace'
import {
  countRoster,
  isUnavailable,
  providerWiring,
  sortRoster,
} from '@/components/agents/roster-model'
import {
  isConsumerReportedStage,
  sortChecks,
  stageDisplay,
  summarizeGate,
} from '@/components/agents/evidence-model'

function agent(over: Partial<AvailableAgent> = {}): AvailableAgent {
  return {
    copilotId: 'c-1',
    projectId: 'p-1',
    name: 'Agent',
    description: null,
    version: 'v1.0.0',
    versionStage: 'production',
    status: 'active',
    lifecycleStatus: 'active',
    runtime: 'langgraph',
    executable: true,
    assistantId: 'asst_fixture',
    runtimeProvisioned: true,
    provider: 'openai',
    configuredModel: 'gpt-5.4',
    executedModel: 'gpt-5.4',
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
  }
}

function check(over: Partial<ReleaseCheck> = {}): ReleaseCheck {
  return { id: 'tests-pass', label: 'Tests', status: 'pass', observed: '', required: '', ...over }
}

function stage(over: Partial<LifecycleStage> = {}): LifecycleStage {
  return {
    key: 'draft',
    label: 'Draft',
    reached: true,
    evidence: { source: 'copilot_versions', state: 'measured', detail: '' },
    ...over,
  }
}

describe('providerWiring — le câblage réel, jamais deviné', () => {
  it('openai et google sont câblés ; local est opt-in', () => {
    expect(providerWiring('openai')).toBe('wired')
    expect(providerWiring('google')).toBe('wired')
    expect(providerWiring('local')).toBe('opt-in')
  })

  it("mistral est NON câblé — c'est une erreur typée, pas un repli muet", () => {
    expect(providerWiring('mistral')).toBe('not-wired')
  })

  it("un provider null n'est pas « non câblé » : on ignore lequel aurait été joint", () => {
    // La distinction compte : « non câblé » accuse un provider identifié,
    // « inconnu » constate qu'aucun provider n'est résolu.
    expect(providerWiring(null)).toBe('unknown')
    expect(providerWiring('un-provider-inedit')).toBe('unknown')
  })
})

describe('isUnavailable — unavailableFields fait autorité sur les valeurs de repli', () => {
  it('un readOnly false MAIS déclaré indisponible est une absence, pas un « non »', () => {
    // Le contrat garde `readOnly: false` (non nullable) quand la nature est
    // inconnaissable. Lire le booléen seul ferait afficher « au moins un outil
    // mutant » sur un agent dont on ne sait rien.
    const a = agent({ readOnly: false, unavailableFields: ['readOnly'] })
    expect(isUnavailable(a, 'readOnly')).toBe(true)
  })

  it('un champ absent du tableau est une vraie valeur mesurée', () => {
    expect(isUnavailable(agent({ readOnly: false }), 'readOnly')).toBe(false)
  })
})

describe('sortRoster — ce qui est cassé se lit en premier', () => {
  it('degraded passe devant unavailable, inactive puis active', () => {
    const sorted = sortRoster([
      agent({ copilotId: 'a', name: 'A', status: 'active' }),
      agent({ copilotId: 'b', name: 'B', status: 'unavailable' }),
      agent({ copilotId: 'c', name: 'C', status: 'degraded' }),
      agent({ copilotId: 'd', name: 'D', status: 'inactive' }),
    ])
    expect(sorted.map((a) => a.status)).toEqual(['degraded', 'unavailable', 'inactive', 'active'])
  })

  it('à statut égal, le tri par nom rend l’ordre stable entre deux rendus', () => {
    const sorted = sortRoster([
      agent({ copilotId: '1', name: 'Zeta', status: 'active' }),
      agent({ copilotId: '2', name: 'Alpha', status: 'active' }),
    ])
    expect(sorted.map((a) => a.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('ne mute pas le tableau reçu', () => {
    const input = [agent({ name: 'Z', status: 'active' }), agent({ name: 'A', status: 'degraded' })]
    sortRoster(input)
    expect(input.map((a) => a.name)).toEqual(['Z', 'A'])
  })
})

describe('countRoster — les compteurs viennent de la MÊME liste que la table', () => {
  it('compte chaque statut et les agents à outils non résolus', () => {
    const counts = countRoster([
      agent({ status: 'active' }),
      agent({ status: 'degraded', unresolvedToolIds: ['t-1'] }),
      agent({ status: 'unavailable', executedModel: null }),
    ])
    expect(counts).toMatchObject({
      total: 3,
      active: 1,
      degraded: 1,
      unavailable: 1,
      inactive: 0,
      withUnresolvedTools: 1,
      // Deux agents ont un executedModel non nul dans ce jeu.
      withProvenExecutedModel: 2,
    })
  })

  it('un roster vide compte zéro partout — un zéro MESURÉ, pas une absence', () => {
    expect(countRoster([])).toMatchObject({ total: 0, active: 0, withProvenExecutedModel: 0 })
  })
})

describe('summarizeGate — « non mesuré » bloque sans être un échec', () => {
  it('un seul check missing rend la gate non promouvable', () => {
    const summary = summarizeGate([
      check({ id: 'tests-pass', status: 'pass' }),
      check({ id: 'unsafe-actions', status: 'missing' }),
    ])
    expect(summary.promotable).toBe(false)
    expect(summary.missing).toBe(1)
    expect(summary.failed).toBe(0)
    // Il bloque, mais il n'est PAS compté comme un échec : deux affirmations
    // distinctes que l'écran doit pouvoir rendre différemment.
    expect(summary.blocking).toBe(1)
  })

  it('tous les checks pass ⇒ promouvable, zéro blocage', () => {
    const summary = summarizeGate([check({ status: 'pass' }), check({ id: 'is-draft', status: 'pass' })])
    expect(summary).toMatchObject({ promotable: true, blocking: 0, missing: 0, failed: 0 })
  })

  it('une liste de checks vide n’est jamais promouvable', () => {
    // Aucun check n'est aussi une absence de preuve : `every` sur un tableau
    // vide rend `true`, ce qui promouvrait sur rien du tout.
    expect(summarizeGate([]).promotable).toBe(false)
  })

  it('fail et missing s’additionnent dans blocking, séparément dans leur compteur', () => {
    const summary = summarizeGate([
      check({ status: 'fail' }),
      check({ id: 'unsafe-actions', status: 'missing' }),
      check({ id: 'is-draft', status: 'pass' }),
    ])
    expect(summary).toMatchObject({ failed: 1, missing: 1, blocking: 2, promotable: false })
  })
})

describe('sortChecks — fail avant missing avant pass', () => {
  it('classe par ce sur quoi un opérateur agit en premier', () => {
    const sorted = sortChecks([
      check({ id: 'is-draft', status: 'pass' }),
      check({ id: 'unsafe-actions', status: 'missing' }),
      check({ id: 'tests-pass', status: 'fail' }),
    ])
    expect(sorted.map((c) => c.status)).toEqual(['fail', 'missing', 'pass'])
  })
})

describe('stageDisplay — trois états, jamais deux', () => {
  it('une étape atteinte et mesurée est « reached »', () => {
    expect(stageDisplay(stage({ reached: true }))).toBe('reached')
  })

  it('une étape non atteinte mais VÉRIFIÉE est « not-reached »', () => {
    expect(stageDisplay(stage({ reached: false }))).toBe('not-reached')
  })

  it('reached === "unknown" reste inconnu', () => {
    expect(stageDisplay(stage({ key: 'active_in_consumer', reached: 'unknown' }))).toBe('unknown')
  })

  it('un false posé sur une preuve INCONNUE ne devient pas « not-reached »', () => {
    // C'est le piège : un booléen false dont la preuve a échoué n'est pas une
    // absence constatée. L'afficher comme « pas atteinte » affirmerait une
    // lecture qui n'a pas eu lieu.
    const s = stage({
      key: 'telemetry_received',
      reached: false,
      evidence: { source: 'runtime_telemetry_events', state: 'unknown', detail: '' },
    })
    expect(stageDisplay(s)).toBe('unknown')
  })
})

describe('isConsumerReportedStage — la seule source admissible', () => {
  it('active_in_consumer se lit sur des événements consommateur', () => {
    expect(isConsumerReportedStage(stage({ key: 'active_in_consumer' }))).toBe(true)
  })

  it('les autres étapes ne le sont pas — elles se lisent côté Aigent', () => {
    expect(isConsumerReportedStage(stage({ key: 'delivered' }))).toBe(false)
    expect(isConsumerReportedStage(stage({ key: 'telemetry_received' }))).toBe(false)
  })
})

describe('stageDisplay — « lecture impossible » n\u2019est pas « inconnue »', () => {
  it('reached === "unavailable" rend « unavailable », jamais « unknown »', () => {
    const s = stage({ key: 'active_in_consumer', reached: 'unavailable' })
    expect(stageDisplay(s)).toBe('unavailable')
    expect(stageDisplay(s)).not.toBe('unknown')
  })

  it('une preuve « unavailable » l\u2019emporte sur un reached inconnu', () => {
    const s = stage({
      key: 'active_in_consumer',
      reached: 'unknown',
      evidence: { source: 'consumer-activation', state: 'unavailable', detail: '' },
    })
    expect(stageDisplay(s)).toBe('unavailable')
  })
})
