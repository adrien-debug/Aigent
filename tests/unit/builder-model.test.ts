/**
 * Builder — dérivations pures de la surface d'authoring.
 *
 * Ce qui est vérifié ici est exactement ce qu'un typecheck ne prouve pas : que
 * l'écran DIT la bonne chose. Trois familles :
 *
 *  1. Un vide PROUVÉ ne se confond pas avec une lecture échouée ni avec une
 *     lecture impossible (`agent_drafts` est vide en base : la distinction est
 *     le cœur de la surface).
 *  2. Une interruption humaine est une DÉCISION, pas un échec.
 *  3. Une valeur non mesurée reste `null` — jamais coercée en 0, jamais
 *     complétée par un défaut inventé.
 */
import { describe, expect, it } from 'vitest'

import {
  buildCapability,
  buildChatLines,
  buildHitlView,
  buildPreviewView,
  buildProjectChoices,
  failed,
  fromList,
  proven,
  ready,
  unavailable,
} from '@/components/builder/model'
import type { BuilderRunState } from '@/lib/agent-mission-control/agent-builder-run'
import type { AgentPreview } from '@/lib/agent-mission-control/project-builder-types'
import type { Project } from '@/lib/agent-mission-control/types'

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-a',
    name: 'Alpha',
    slug: 'alpha',
    description: '',
    platform: 'web',
    createdAt: '2026-07-31T00:00:00.000Z',
    ...over,
  }
}

function runState(over: Partial<BuilderRunState> = {}): BuilderRunState {
  return {
    runId: 'r1',
    status: 'completed',
    currentNode: 'done',
    events: [],
    manifestDraft: null,
    selectedTools: [],
    testCases: [],
    risks: [],
    approvalRequired: false,
    approvalMessage: null,
    pendingTool: null,
    finalText: '',
    createdCopilotId: null,
    projectId: 'proj-a',
    releaseProposal: null,
    langgraph: {
      graph: 'agent_builder',
      assistantId: null,
      agentServerUrl: 'http://127.0.0.1:2024',
      threadId: 'r1',
    },
    ...over,
  }
}

describe('états de lecture — les quatre situations restent distinctes', () => {
  it('sépare vide prouvé, échec et indisponibilité', () => {
    expect(proven().state).toBe('empty')
    expect(failed('boom').state).toBe('error')
    expect(unavailable('pas de backend').state).toBe('unavailable')
    expect(ready([1]).state).toBe('ready')
  })

  it('une liste vide lue sans erreur est un vide PROUVÉ, pas une erreur', () => {
    // C'est le cas réel d'`agent_drafts` : 0 ligne en base.
    const outcome = fromList([])
    expect(outcome.state).toBe('empty')
    expect(outcome.failure).toBeNull()
    expect(outcome.value).toBeNull()
  })

  it('une lecture échouée ne rend jamais une liste vide', () => {
    const outcome = failed<readonly string[]>('PostgREST 502')
    expect(outcome.state).not.toBe('empty')
    expect(outcome.value).toBeNull()
    expect(outcome.failure).toBe('PostgREST 502')
  })
})

describe('buildProjectChoices', () => {
  it('ne fabrique jamais de dépôt : absent reste null', () => {
    const [choice] = buildProjectChoices([project()])
    expect(choice.repoFullName).toBeNull()
    expect(choice.repoLinked).toBe(false)
  })

  it('marque le dépôt lié et encode l’id dans le lien', () => {
    const [choice] = buildProjectChoices([project({ id: 'a-b', repoFullName: 'hearst/console' })])
    expect(choice.repoLinked).toBe(true)
    expect(choice.href).toBe('/builder/a-b')
  })

  it('trie par nom', () => {
    const names = buildProjectChoices([
      project({ id: 'z', name: 'Zeta' }),
      project({ id: 'a', name: 'Alpha' }),
    ]).map((c) => c.name)
    expect(names).toEqual(['Alpha', 'Zeta'])
  })
})

describe('buildHitlView — une interruption est une décision, pas un échec', () => {
  it('rend awaiting_approval comme une décision à prendre', () => {
    const view = buildHitlView(
      runState({
        status: 'awaiting_approval',
        approvalMessage: 'Créer ce copilot ?',
        pendingTool: { name: 'draft_copilot_spec', argumentsSummary: '{"name":"x"}', risk: 'high' },
      }),
      { langgraphThreadId: 'r1' },
    )
    expect(view.phase).toBe('awaiting-decision')
    expect(view.decisionRequired).toBe(true)
    expect(view.question).toBe('Créer ce copilot ?')
    expect(view.pendingTool?.name).toBe('draft_copilot_spec')
    // Le vocabulaire d'échec ne doit pas apparaître sur une attente normale.
    expect(view.label.toLowerCase()).not.toContain('échec')
    expect(view.label.toLowerCase()).not.toContain('erreur')
  })

  it('un outil sans risque déclaré reste null, jamais « low » inventé', () => {
    const view = buildHitlView(
      runState({
        status: 'awaiting_approval',
        pendingTool: { name: 't', argumentsSummary: '{}' },
      }),
      { langgraphThreadId: 'r1' },
    )
    expect(view.pendingTool?.risk).toBeNull()
  })

  it('aucun thread et aucun run → aucun run en cours (et pas une erreur)', () => {
    const view = buildHitlView(null, { langgraphThreadId: null })
    expect(view.phase).toBe('none')
    expect(view.decisionRequired).toBe(false)
  })

  it('thread connu mais état introuvable → fil perdu, ni run actif ni échec', () => {
    const view = buildHitlView(null, { langgraphThreadId: 'gone' })
    expect(view.phase).toBe('thread-lost')
    expect(view.decisionRequired).toBe(false)
  })

  it('distingue blocked et failed', () => {
    expect(buildHitlView(runState({ status: 'blocked' }), null).phase).toBe('blocked')
    expect(buildHitlView(runState({ status: 'failed' }), null).phase).toBe('failed')
  })
})

describe('buildPreviewView — aucune valeur inventée', () => {
  it('rend null pour une spécification absente', () => {
    expect(buildPreviewView(null)).toBeNull()
  })

  it('maxStepsPerRun non fixé reste null et ne devient pas 0', () => {
    const view = buildPreviewView({ name: 'A' })
    expect(view?.maxStepsPerRun).toBeNull()
  })

  it('conserve un maxStepsPerRun réellement fixé, y compris 0', () => {
    expect(buildPreviewView({ maxStepsPerRun: 0 })?.maxStepsPerRun).toBe(0)
    expect(buildPreviewView({ maxStepsPerRun: 12 })?.maxStepsPerRun).toBe(12)
  })

  it('un outil non qualifié exige la confirmation — le défaut penche vers la sûreté', () => {
    const view = buildPreviewView({ tools: ['send_email'] })
    expect(view?.tools).toHaveLength(1)
    expect(view?.tools[0].requiresConfirmation).toBe(true)
  })

  it('ne duplique pas un outil présent dans les deux champs', () => {
    const preview: AgentPreview = {
      tools: ['a', 'b'],
      proposedTools: [{ name: 'a', riskLevel: 'high', requiresConfirmation: true }],
    }
    const view = buildPreviewView(preview)
    expect(view?.tools.map((t) => t.name)).toEqual(['a', 'b'])
    expect(view?.tools[0].riskLevel).toBe('high')
  })

  it('une description non fournie reste null, pas une chaîne vide', () => {
    const view = buildPreviewView({ proposedTools: [{ name: 'a', riskLevel: 'low', requiresConfirmation: false }] })
    expect(view?.tools[0].description).toBeNull()
  })

  it('une chaîne blanche est traitée comme absente', () => {
    expect(buildPreviewView({ name: '   ' })?.name).toBeNull()
  })

  it('readyForApproval n’est vrai que sur un true explicite', () => {
    expect(buildPreviewView({})?.readyForApproval).toBe(false)
    expect(buildPreviewView({ readyForApproval: true })?.readyForApproval).toBe(true)
  })
})

describe('buildCapability — un refus porte toujours son motif', () => {
  const readyPreview = buildPreviewView({ readyForApproval: true })
  const idle = buildHitlView(null, { langgraphThreadId: null })

  it('ferme tout quand le backend est indisponible', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: readyPreview,
      hitl: idle,
      backendUnavailable: true,
    })
    expect(cap.canSendMessage).toBe(false)
    expect(cap.canStartDraft).toBe(false)
    expect(cap.draftBlockedReason).toBeTruthy()
  })

  it('une décision en attente prime sur tout le reste', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: readyPreview,
      hitl: buildHitlView(runState({ status: 'awaiting_approval' }), { langgraphThreadId: 'r' }),
      backendUnavailable: false,
    })
    expect(cap.canConfirmDraft).toBe(true)
    expect(cap.canStartDraft).toBe(false)
    expect(cap.canSendMessage).toBe(false)
  })

  it('refuse la matérialisation sans spécification, avec un motif', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: null,
      hitl: idle,
      backendUnavailable: false,
    })
    expect(cap.canStartDraft).toBe(false)
    expect(cap.draftBlockedReason).toBeTruthy()
    // On peut toujours parler à l'architecte : c'est le moyen d'en sortir.
    expect(cap.canSendMessage).toBe(true)
  })

  it('refuse tant que la spécification n’est pas prête', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: buildPreviewView({ name: 'A' }),
      hitl: idle,
      backendUnavailable: false,
    })
    expect(cap.canStartDraft).toBe(false)
  })

  it('refuse tant qu’une option proposée n’est pas choisie', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: buildPreviewView({
        readyForApproval: true,
        options: [{ id: 'A', title: 'A', summary: '', tradeoffs: [] }],
      }),
      hitl: idle,
      backendUnavailable: false,
    })
    expect(cap.canStartDraft).toBe(false)
    expect(cap.draftBlockedReason).toContain('option')
  })

  it('ouvre la matérialisation quand une option est retenue', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: buildPreviewView({
        readyForApproval: true,
        options: [{ id: 'A', title: 'A', summary: '', tradeoffs: [] }],
        selectedOptionId: 'A',
      }),
      hitl: idle,
      backendUnavailable: false,
    })
    expect(cap.canStartDraft).toBe(true)
    expect(cap.draftBlockedReason).toBeNull()
  })

  it('une conversation ayant déjà produit un draft est terminale', () => {
    const cap = buildCapability({
      conversationStatus: 'draft_created',
      preview: readyPreview,
      hitl: idle,
      backendUnavailable: false,
    })
    expect(cap.canSendMessage).toBe(false)
    expect(cap.canStartDraft).toBe(false)
    expect(cap.draftBlockedReason).toBeTruthy()
  })

  it('un fil perdu se relance au lieu de rester bloqué', () => {
    const cap = buildCapability({
      conversationStatus: 'active',
      preview: readyPreview,
      hitl: buildHitlView(null, { langgraphThreadId: 'gone' }),
      backendUnavailable: false,
    })
    expect(cap.canStartDraft).toBe(true)
  })
})

describe('buildChatLines', () => {
  it('conserve les messages système — ils portent les transitions du flux', () => {
    const lines = buildChatLines([
      { id: '1', conversationId: 'c', role: 'user', content: 'a', createdAt: 't' },
      { id: '2', conversationId: 'c', role: 'system', content: 'draft lancé', createdAt: 't' },
    ])
    expect(lines.map((l) => l.role)).toEqual(['user', 'system'])
  })

  it('un fil vide reste vide, sans ligne fabriquée', () => {
    expect(buildChatLines([])).toEqual([])
  })
})
