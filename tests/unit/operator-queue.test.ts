/**
 * Unit tests — file opérateur `/actions`.
 *
 * CE QUE CE FICHIER PROUVE, ET POURQUOI CHAQUE CAS EXISTE
 * ------------------------------------------------------
 * La file est le seul écran de la mission qui porte une MUTATION réelle. Les
 * cas ci-dessous couvrent les points où elle pourrait mentir à l'opérateur :
 * inventer une action là où aucune route sûre n'existe, confondre une file
 * vide avec une file non lue, ou rendre une absence de mesure comme un zéro.
 *
 * Les cas numérotés renvoient à la liste de validation de la mission
 * AIGENT-SUPERVISION-LEARNING-001.
 */
import { describe, expect, it } from 'vitest'

import type { ActionItem } from '@/lib/agent-mission-control/dashboard-overview'
import {
  buildOperatorQueue,
  deriveQueueFilters,
  filterQueue,
  QUEUE_KIND_LABEL,
  selectOpenDecisions,
  selectPendingConfirmations,
  type OperatorQueueKind,
} from '@/lib/agent-mission-control/operator-queue'
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

const COMPOSED_AT = '2026-07-31T12:00:00.000Z'

function copilot(partial: Partial<Copilot> & { id: string }): Copilot {
  return {
    name: `Copilot ${partial.id}`,
    projectId: null,
    status: 'active',
    description: null,
    runtime: 'langgraph',
    ...partial,
  } as Copilot
}

function run(partial: Partial<AgentRun> & { id: string; copilotId: string; status: string }): AgentRun {
  return {
    outputSummary: null,
    startedAt: '2026-07-31T11:00:00.000Z',
    ...partial,
  } as AgentRun
}

function actionItem(partial: Partial<ActionItem> & { id: string; kind: ActionItem['kind'] }): ActionItem {
  return {
    title: 'Item',
    meta: 'meta',
    status: 'open',
    href: '/agents',
    buttonLabel: 'Ouvrir',
    priority: 5,
    ...partial,
  }
}

function emptyInput() {
  return {
    actionItems: [] as ActionItem[],
    pendingConfirmations: [],
    openDecisions: [],
    copilotsById: new Map<string, Copilot>(),
    projectsById: new Map<string, Project>(),
    dataWarnings: [] as string[],
    composedAt: COMPOSED_AT,
  }
}

describe('selectPendingConfirmations', () => {
  it('ne retient QUE les runs needs-confirmation', () => {
    const runs = [
      run({ id: 'r1', copilotId: 'c1', status: 'completed' }),
      run({ id: 'r2', copilotId: 'c1', status: 'needs-confirmation' }),
      run({ id: 'r3', copilotId: 'c2', status: 'running' }),
      run({ id: 'r4', copilotId: 'c2', status: 'failed' }),
      run({ id: 'r5', copilotId: 'c2', status: 'blocked' }),
    ]
    const pending = selectPendingConfirmations(runs)
    expect(pending.map((p) => p.runId)).toEqual(['r2'])
  })

  it('ne fabrique pas de résumé quand il est absent', () => {
    const pending = selectPendingConfirmations([
      run({ id: 'r1', copilotId: 'c1', status: 'needs-confirmation', outputSummary: undefined }),
    ])
    expect(pending[0].outputSummary).toBeNull()
  })
})

describe('selectOpenDecisions', () => {
  it('ne retient que les propositions non encore arbitrées', () => {
    const open = selectOpenDecisions([
      { id: 'p1', copilotId: 'c1', status: 'proposed', summary: 's', createdAt: COMPOSED_AT },
      { id: 'p2', copilotId: 'c1', status: 'v2-created', summary: 's', createdAt: COMPOSED_AT },
      { id: 'p3', copilotId: 'c1', status: 'approved', summary: 's', createdAt: COMPOSED_AT },
      { id: 'p4', copilotId: 'c1', status: 'rejected', summary: 's', createdAt: COMPOSED_AT },
    ])
    expect(open.map((d) => d.proposalId)).toEqual(['p1', 'p2'])
  })
})

describe('buildOperatorQueue — cas 5 : file vide', () => {
  it('une file vide MESURÉE ne produit aucune ligne et aucune source en échec', () => {
    const queue = buildOperatorQueue(emptyInput())
    expect(queue.items).toEqual([])
    expect(queue.sources.every((s) => s.ok)).toBe(true)
    // Une file vide n'est PAS un avertissement : la lecture a réussi.
    expect(queue.dataWarnings).toEqual([])
    expect(queue.composedAt).toBe(COMPOSED_AT)
  })
})

describe('buildOperatorQueue — cas 6 : run needs-confirmation', () => {
  it('produit une ligne actionnable avec la route de reprise réelle', () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      pendingConfirmations: [
        { runId: 'run-abcdef12', copilotId: 'copilot-x', outputSummary: 'attente', startedAt: COMPOSED_AT },
      ],
      copilotsById: new Map([['copilot-x', copilot({ id: 'copilot-x', name: 'Sentinel', projectId: 'proj-1' })]]),
    })

    expect(queue.items).toHaveLength(1)
    const item = queue.items[0]
    expect(item.kind).toBe('run_needs_confirmation')
    expect(item.mutation).not.toBeNull()
    expect(item.mutation?.kind).toBe('resume-run')
    expect(item.mutation?.endpoint).toBe('/api/agent-ops/copilots/copilot-x/runs/run-abcdef12/resume')
    // Une reprise autorise un outil qui exigeait une signature humaine.
    expect(item.mutation?.requiresDoubleConfirmation).toBe(true)
    expect(item.risk).toBe('high')
    // Le nom résolu est affiché, pas l'id brut.
    expect(item.meta).toContain('Sentinel')
    expect(item.projectId).toBe('proj-1')
  })

  it('passe AVANT toutes les autres catégories', () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      actionItems: [actionItem({ id: 'a1', kind: 'architect_approval', priority: 0 })],
      pendingConfirmations: [
        { runId: 'run-1', copilotId: 'c1', outputSummary: null, startedAt: null },
      ],
    })
    expect(queue.items[0].kind).toBe('run_needs_confirmation')
  })

  it("affiche l'id brut quand le copilot n'est pas résolu — jamais un nom inventé", () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      pendingConfirmations: [
        { runId: 'run-1', copilotId: 'copilot-inconnu', outputSummary: null, startedAt: null },
      ],
    })
    expect(queue.items[0].meta).toContain('copilot-inconnu')
  })
})

describe('buildOperatorQueue — cas 7 et 8 : décision ouverte, sans mutation sûre', () => {
  it('une décision V2 ouverte est en LECTURE SEULE (aucune route sûre en un clic)', () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      openDecisions: [
        {
          proposalId: 'prop-1',
          copilotId: 'c1',
          status: 'v2-created',
          summary: 'Renforcer la discipline de confirmation',
          createdAt: COMPOSED_AT,
        },
      ],
      copilotsById: new Map([['c1', copilot({ id: 'c1', name: 'Aurora' })]]),
    })

    const item = queue.items[0]
    expect(item.kind).toBe('improvement_decision')
    // LE point du cas 8 : pas de bouton factice.
    expect(item.mutation).toBeNull()
    expect(item.buttonLabel).toBe('Ouvrir le contexte')
    expect(item.href).toBe('/agents/c1')
  })
})

describe('buildOperatorQueue — cas 4 : source partielle', () => {
  it('une lecture de runs ÉCHOUÉE devient une ligne visible, pas un silence', () => {
    const queue = buildOperatorQueue({ ...emptyInput(), pendingConfirmations: null })

    const runsSource = queue.sources.find((s) => s.source === 'runs')
    expect(runsSource?.ok).toBe(false)
    expect(runsSource?.detail).toBeTruthy()

    // La panne est AUSSI une ligne de file : un opérateur ne doit pas lire une
    // file calme comme « rien à traiter » quand elle n'a pas pu être lue.
    const unavailable = queue.items.find((i) => i.id === 'queue_unavailable_runs')
    expect(unavailable).toBeDefined()
    expect(unavailable?.kind).toBe('data_unavailable')
    expect(unavailable?.mutation).toBeNull()
  })

  it('une lecture de propositions échouée est attribuée séparément', () => {
    const queue = buildOperatorQueue({ ...emptyInput(), openDecisions: null })
    const source = queue.sources.find((s) => s.source === 'improvement-proposals')
    expect(source?.ok).toBe(false)
    expect(queue.items.some((i) => i.id === 'queue_unavailable_decisions')).toBe(true)
  })

  it('distingue une source en échec d’une source vide', () => {
    const failed = buildOperatorQueue({ ...emptyInput(), pendingConfirmations: null })
    const empty = buildOperatorQueue({ ...emptyInput(), pendingConfirmations: [] })

    expect(failed.sources.find((s) => s.source === 'runs')?.ok).toBe(false)
    expect(empty.sources.find((s) => s.source === 'runs')?.ok).toBe(true)
    // Les deux files sont visuellement différentes : l'une porte une ligne.
    expect(failed.items.length).toBeGreaterThan(empty.items.length)
  })
})

describe('buildOperatorQueue — cas 14 : aucune route ni bouton factice', () => {
  it("aucune ligne ne porte un href vide ou '#'", () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      actionItems: [actionItem({ id: 'a1', kind: 'ready_manual', href: '/agents/c1' })],
      pendingConfirmations: [{ runId: 'r1', copilotId: 'c1', outputSummary: null, startedAt: null }],
      openDecisions: [
        { proposalId: 'p1', copilotId: 'c1', status: 'proposed', summary: 's', createdAt: COMPOSED_AT },
      ],
    })

    for (const item of queue.items) {
      expect(item.href).toBeTruthy()
      expect(item.href).not.toBe('#')
      expect(item.buttonLabel).toBeTruthy()
    }
  })

  it('seule la catégorie run_needs_confirmation porte une mutation', () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      actionItems: [
        actionItem({ id: 'a1', kind: 'architect_approval' }),
        actionItem({ id: 'a2', kind: 'ready_manual' }),
        actionItem({ id: 'a3', kind: 'sandbox_failed' }),
        actionItem({ id: 'a4', kind: 'release_gate_red' }),
        actionItem({ id: 'a5', kind: 'pr_open' }),
        actionItem({ id: 'a6', kind: 'mission_blocked' }),
      ],
      pendingConfirmations: [{ runId: 'r1', copilotId: 'c1', outputSummary: null, startedAt: null }],
    })

    const withMutation = queue.items.filter((i) => i.mutation !== null)
    expect(withMutation).toHaveLength(1)
    expect(withMutation[0].kind).toBe('run_needs_confirmation')
  })
})

describe('buildOperatorQueue — priorité déterministe', () => {
  it('trie sur la priorité unifiée, sans réordonner les catégories héritées', () => {
    const queue = buildOperatorQueue({
      ...emptyInput(),
      actionItems: [
        actionItem({ id: 'pr', kind: 'pr_open', priority: 4 }),
        actionItem({ id: 'arch', kind: 'architect_approval', priority: 0 }),
        actionItem({ id: 'gate', kind: 'release_gate_red', priority: 3 }),
      ],
      pendingConfirmations: [{ runId: 'r1', copilotId: 'c1', outputSummary: null, startedAt: null }],
      openDecisions: [
        { proposalId: 'p1', copilotId: 'c1', status: 'proposed', summary: 's', createdAt: COMPOSED_AT },
      ],
    })

    expect(queue.items.map((i) => i.kind)).toEqual([
      'run_needs_confirmation', // -1
      'architect_approval', // 0
      'release_gate_red', // 3
      'improvement_decision', // 3.5
      'pr_open', // 4
    ])
  })

  it('est stable : deux compositions identiques donnent le même ordre', () => {
    const input = {
      ...emptyInput(),
      pendingConfirmations: [
        { runId: 'r1', copilotId: 'c1', outputSummary: null, startedAt: null },
        { runId: 'r2', copilotId: 'c2', outputSummary: null, startedAt: null },
      ],
    }
    const first = buildOperatorQueue(input).items.map((i) => i.id)
    const second = buildOperatorQueue(input).items.map((i) => i.id)
    expect(first).toEqual(second)
  })
})

describe('filtres', () => {
  const queue = buildOperatorQueue({
    ...emptyInput(),
    actionItems: [actionItem({ id: 'a1', kind: 'pr_open' })],
    pendingConfirmations: [
      { runId: 'r1', copilotId: 'c1', outputSummary: null, startedAt: null },
      { runId: 'r2', copilotId: 'c2', outputSummary: null, startedAt: null },
    ],
    copilotsById: new Map([
      ['c1', copilot({ id: 'c1' })],
      ['c2', copilot({ id: 'c2' })],
    ]),
  })

  it('dérive les filtres depuis les lignes réelles, sans liste codée en dur', () => {
    const filters = deriveQueueFilters(queue.items)
    expect(filters.kinds).toContain('run_needs_confirmation')
    expect(filters.kinds).toContain('pr_open')
    expect(filters.copilotIds.toSorted()).toEqual(['c1', 'c2'])
    expect(filters.hasRisk).toBe(true)
    expect(filters.hasMutation).toBe(true)
  })

  it('un critère absent ne filtre rien', () => {
    expect(filterQueue(queue.items, {})).toHaveLength(queue.items.length)
  })

  it('filtre par agent, par catégorie, par risque et par actionnabilité', () => {
    expect(filterQueue(queue.items, { copilotId: 'c1' })).toHaveLength(1)
    expect(filterQueue(queue.items, { kind: 'pr_open' })).toHaveLength(1)
    expect(filterQueue(queue.items, { riskOnly: true })).toHaveLength(2)
    expect(filterQueue(queue.items, { actionableOnly: true })).toHaveLength(2)
  })

  it('sur une file sans risque ni mutation, les filtres correspondants sont absents', () => {
    const readOnly = buildOperatorQueue({
      ...emptyInput(),
      actionItems: [actionItem({ id: 'a1', kind: 'pr_open' })],
    })
    const filters = deriveQueueFilters(readOnly.items)
    expect(filters.hasRisk).toBe(false)
    expect(filters.hasMutation).toBe(false)
  })
})

describe('libellés', () => {
  it('chaque catégorie de la file a un libellé français', () => {
    const kinds: OperatorQueueKind[] = [
      'run_needs_confirmation',
      'architect_approval',
      'ready_manual',
      'sandbox_failed',
      'release_gate_red',
      'improvement_decision',
      'pr_open',
      'mission_blocked',
      'data_unavailable',
    ]
    for (const kind of kinds) {
      expect(QUEUE_KIND_LABEL[kind]).toBeTruthy()
    }
  })
})
