/**
 * Builder — dérivations PURES, sans I/O.
 *
 * Ce module ne lit rien et n'écrit rien : il transforme ce que le serveur a
 * réellement lu en ce que l'écran doit dire. Tout ce qui est testable dans la
 * surface Builder vit ici, précisément parce qu'un composant qui rend et décide
 * en même temps n'est vérifiable qu'au navigateur.
 *
 * LES QUATRE ÉTATS, JAMAIS CONFONDUS
 * ----------------------------------
 * Le produit distingue quatre situations que le même écran vide représenterait
 * autrement de façon identique :
 *
 *  · `loading`     — la lecture est en cours (état client uniquement).
 *  · `error`       — la lecture a ÉCHOUÉ. On ne sait pas ce qu'il y a.
 *  · `empty`       — la lecture a RÉUSSI et il n'y a réellement rien.
 *  · `unavailable` — la lecture n'a pas pu être TENTÉE (backend non configuré,
 *                    dépendance absente). Ce n'est ni un échec ponctuel, ni un
 *                    vide prouvé.
 *
 * `agent_drafts` est vide en base aujourd'hui : la surface DOIT le dire comme un
 * `empty` prouvé — « la lecture a réussi, il n'y a aucun draft » — et surtout
 * pas comme un `error` ni un `unavailable`. C'est la distinction que
 * `ReadState` porte, et c'est pour ça qu'elle est un type et pas un booléen.
 */
import type { BuilderRunState } from '@/lib/agent-mission-control/agent-builder-run'
import type {
  AgentPreview,
  AgentPreviewOption,
  AgentPreviewTool,
  ProjectBuilderConversation,
  ProjectBuilderMessage,
} from '@/lib/agent-mission-control/project-builder-types'
import type { Project } from '@/lib/agent-mission-control/types'

/* ─────────────────────────── États de lecture ─────────────────────────── */

/**
 * L'état d'une lecture, du point de vue de ce qu'on a le DROIT d'affirmer.
 *
 * `empty` n'existe que si la lecture a abouti — c'est ce qui autorise l'écran à
 * écrire « il n'y en a aucun » plutôt que « on ne sait pas ».
 */
export type ReadState = 'loading' | 'error' | 'empty' | 'unavailable' | 'ready'

export interface ReadOutcome<T> {
  state: ReadState
  /** Présent uniquement quand `state === 'ready'`. */
  value: T | null
  /** Message technique de l'échec — jamais inventé, jamais un faux zéro. */
  failure: string | null
}

/** Une lecture réussie qui a rapporté quelque chose. */
export function ready<T>(value: T): ReadOutcome<T> {
  return { state: 'ready', value, failure: null }
}

/** Une lecture réussie qui n'a rien rapporté — un vide PROUVÉ. */
export function proven<T>(): ReadOutcome<T> {
  return { state: 'empty', value: null, failure: null }
}

/** Une lecture qui a échoué : on ne sait pas ce qu'il y avait. */
export function failed<T>(failure: string): ReadOutcome<T> {
  return { state: 'error', value: null, failure }
}

/** Une lecture qui n'a pas pu être tentée (dépendance absente). */
export function unavailable<T>(reason: string): ReadOutcome<T> {
  return { state: 'unavailable', value: null, failure: reason }
}

/**
 * Qualifie une liste lue sans erreur : vide → `empty` PROUVÉ, sinon `ready`.
 *
 * C'est le seul endroit où « tableau de longueur 0 » devient « il n'y en a
 * aucun » — et il n'est atteint que sur le chemin où la lecture a abouti.
 */
export function fromList<T>(items: readonly T[]): ReadOutcome<readonly T[]> {
  return items.length === 0 ? proven<readonly T[]>() : ready<readonly T[]>(items)
}

/* ──────────────────────────── Sélection projet ─────────────────────────── */

export interface ProjectChoice {
  id: string
  name: string
  /** `null` quand aucun dépôt n'est lié — jamais une chaîne inventée. */
  repoFullName: string | null
  /** Le builder lit le dépôt : sans dépôt lié, l'architecte travaille à l'aveugle. */
  repoLinked: boolean
  href: string
}

export function buildProjectChoices(projects: readonly Project[]): ProjectChoice[] {
  return projects
    .map((project) => ({
      id: project.id,
      name: project.name,
      repoFullName: project.repoFullName ?? null,
      repoLinked: Boolean(project.repoFullName),
      href: `/builder/${encodeURIComponent(project.id)}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/* ──────────────────────────── État HITL du run ─────────────────────────── */

/**
 * Ce que l'opérateur doit comprendre du run LangGraph, en un seul mot.
 *
 * `awaiting-decision` est le point important : une interruption humaine est une
 * DÉCISION À PRENDRE, pas un échec. L'écran ne doit jamais la peindre en rouge
 * ni la nommer « erreur » — le graphe attend, c'est son fonctionnement normal.
 */
export type HitlPhase =
  | 'none'
  | 'running'
  | 'awaiting-decision'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'thread-lost'

export interface HitlView {
  phase: HitlPhase
  /** Titre court, en français, jamais une chaîne technique brute. */
  label: string
  /** Ce que l'opérateur peut faire maintenant — vide quand il n'y a rien à faire. */
  actionHint: string | null
  /** La question posée par l'interruption du graphe. `null` si le graphe n'en pose pas. */
  question: string | null
  /** L'outil retenu au checkpoint — il n'est PAS exécuté tant qu'on n'a pas décidé. */
  pendingTool: { name: string; argumentsSummary: string; risk: string | null } | null
  /** `true` seulement quand une décision humaine est réellement attendue. */
  decisionRequired: boolean
}

/**
 * Traduit l'état du run en une décision d'écran.
 *
 * Le cas `conversation.langgraphThreadId != null` mais `runState == null` est
 * explicitement le « fil perdu » documenté par le bundle : le serveur ne peut
 * pas prouver que le thread vit encore. On ne prétend alors NI qu'un run tourne,
 * NI qu'il a échoué — on dit que le fil est perdu et qu'il faut le relancer.
 */
export function buildHitlView(
  runState: BuilderRunState | null | undefined,
  conversation: Pick<ProjectBuilderConversation, 'langgraphThreadId'> | null,
): HitlView {
  const base: Omit<HitlView, 'phase' | 'label' | 'actionHint'> = {
    question: null,
    pendingTool: null,
    decisionRequired: false,
  }

  if (!runState) {
    if (conversation?.langgraphThreadId) {
      return {
        ...base,
        phase: 'thread-lost',
        label: 'Fil d’approbation perdu',
        actionHint:
          'Le serveur d’agents ne retrouve plus ce fil (redémarrage probable). Relancer la matérialisation.',
      }
    }
    return { ...base, phase: 'none', label: 'Aucun run en cours', actionHint: null }
  }

  if (runState.status === 'awaiting_approval') {
    return {
      phase: 'awaiting-decision',
      label: 'Décision attendue',
      actionHint:
        'Le graphe est au point d’arrêt : rien n’a été créé et aucun outil n’a été exécuté. Approuver ou refuser.',
      question: runState.approvalMessage,
      pendingTool: runState.pendingTool
        ? {
            name: runState.pendingTool.name,
            argumentsSummary: runState.pendingTool.argumentsSummary,
            risk: runState.pendingTool.risk ?? null,
          }
        : null,
      decisionRequired: true,
    }
  }

  if (runState.status === 'running') {
    return { ...base, phase: 'running', label: 'Run en cours', actionHint: 'Le graphe travaille.' }
  }
  if (runState.status === 'completed') {
    return { ...base, phase: 'completed', label: 'Run terminé', actionHint: null }
  }
  if (runState.status === 'blocked') {
    return {
      ...base,
      phase: 'blocked',
      label: 'Run bloqué',
      actionHint: 'Le graphe a refusé de continuer. Voir les risques relevés.',
    }
  }
  return {
    ...base,
    phase: 'failed',
    label: 'Run en échec',
    actionHint: 'Le run s’est terminé en erreur. Relancer la matérialisation.',
  }
}

/* ───────────────────────────── Aperçu / manifeste ──────────────────────── */

export interface PreviewTool {
  name: string
  riskLevel: AgentPreviewTool['riskLevel']
  requiresConfirmation: boolean
  /**
   * La description porte le contrat que le schéma ne dit pas. Elle est souvent
   * absente de l'aperçu de l'architecte : `null` signifie « non fournie », ce
   * qui est une information — pas une description vide.
   */
  description: string | null
}

export interface PreviewView {
  name: string | null
  role: string | null
  description: string | null
  systemPromptSummary: string | null
  confirmationPolicy: string | null
  /** `null` quand l'architecte ne l'a pas fixé — jamais 0 par défaut. */
  maxStepsPerRun: number | null
  riskPolicy: string | null
  approvalPolicy: string | null
  flow: readonly string[]
  tools: readonly PreviewTool[]
  tests: readonly string[]
  options: readonly AgentPreviewOption[]
  selectedOptionId: string | null
  readyForApproval: boolean
  createdCopilotId: string | null
}

function nonEmpty(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/**
 * Normalise l'aperçu évolutif de l'architecte.
 *
 * Les outils sont fusionnés depuis deux champs que l'architecte remplit
 * indépendamment : `proposedTools` (structuré, avec le risque) et `tools` (de
 * simples noms). Un nom présent uniquement dans `tools` est rendu avec un
 * risque `low` NON pas parce qu'on l'a mesuré, mais parce que l'architecte n'a
 * pas encore qualifié l'outil — et `requiresConfirmation` reste alors `true`,
 * c'est-à-dire le côté SÛR : on n'affirme jamais qu'un outil non qualifié peut
 * s'exécuter sans confirmation.
 */
export function buildPreviewView(preview: AgentPreview | null): PreviewView | null {
  if (!preview) return null

  const structured = preview.proposedTools ?? []
  const seen = new Set(structured.map((tool) => tool.name))
  const bareNames = (preview.tools ?? []).filter((name) => !seen.has(name))

  const tools: PreviewTool[] = [
    ...structured.map((tool) => ({
      name: tool.name,
      riskLevel: tool.riskLevel,
      requiresConfirmation: tool.requiresConfirmation,
      description: null,
    })),
    ...bareNames.map((name) => ({
      name,
      riskLevel: 'low' as const,
      // Outil non qualifié → confirmation exigée. Le défaut penche vers la sûreté.
      requiresConfirmation: true,
      description: null,
    })),
  ]

  const tests = [
    ...(preview.tests ?? []),
    ...(preview.testCases ?? []).map((test) => test.name),
  ]

  return {
    name: nonEmpty(preview.name),
    role: nonEmpty(preview.role),
    description: nonEmpty(preview.description),
    systemPromptSummary: nonEmpty(preview.systemPromptSummary),
    confirmationPolicy: nonEmpty(preview.confirmationPolicy),
    maxStepsPerRun: typeof preview.maxStepsPerRun === 'number' ? preview.maxStepsPerRun : null,
    riskPolicy: nonEmpty(preview.riskPolicy),
    approvalPolicy: nonEmpty(preview.approvalPolicy),
    flow: preview.flow ?? [],
    tools,
    tests,
    options: preview.options ?? [],
    selectedOptionId: preview.selectedOptionId ?? null,
    readyForApproval: preview.readyForApproval === true,
    createdCopilotId: preview.createdCopilotId ?? null,
  }
}

/* ────────────────────────── Capacité d'action ──────────────────────────── */

/**
 * Ce que l'opérateur peut déclencher, et pourquoi il ne peut pas.
 *
 * Un bouton désactivé sans raison est une impasse : chaque interdiction porte
 * ici son motif, affiché à l'écran. Les raisons reproduisent les 409 réels des
 * routes (`create-draft`), pour que l'UI refuse AVANT l'appel exactement ce que
 * le serveur refuserait — sans jamais être la seule garde (le serveur tranche).
 */
export interface BuilderCapability {
  canSendMessage: boolean
  canStartDraft: boolean
  canConfirmDraft: boolean
  /** Motif d'indisponibilité de la matérialisation, `null` si elle est ouverte. */
  draftBlockedReason: string | null
}

export function buildCapability(args: {
  conversationStatus: ProjectBuilderConversation['status']
  preview: PreviewView | null
  hitl: HitlView
  /** `true` quand le backend live n'est pas joignable — tout est fermé. */
  backendUnavailable: boolean
}): BuilderCapability {
  const { conversationStatus, preview, hitl, backendUnavailable } = args

  if (backendUnavailable) {
    return {
      canSendMessage: false,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'Le backend live n’est pas configuré — aucune action n’est possible.',
    }
  }

  // Une décision en attente prime sur tout : c'est la seule chose à faire.
  if (hitl.decisionRequired) {
    return {
      canSendMessage: false,
      canStartDraft: false,
      canConfirmDraft: true,
      draftBlockedReason: 'Une décision humaine est en attente sur le run en cours.',
    }
  }

  if (conversationStatus === 'draft_created') {
    return {
      canSendMessage: false,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'Cette conversation a déjà produit un draft. Elle est terminée.',
    }
  }

  if (conversationStatus === 'archived') {
    return {
      canSendMessage: false,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'Conversation archivée.',
    }
  }

  if (hitl.phase === 'thread-lost') {
    return {
      canSendMessage: true,
      canStartDraft: true,
      canConfirmDraft: false,
      draftBlockedReason: null,
    }
  }

  if (hitl.phase === 'running') {
    return {
      canSendMessage: false,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'Un run est déjà en cours.',
    }
  }

  if (!preview) {
    return {
      canSendMessage: true,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'Aucune spécification : décrire l’agent à l’architecte d’abord.',
    }
  }

  if (!preview.readyForApproval) {
    return {
      canSendMessage: true,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'L’architecte n’a pas encore marqué la spécification prête.',
    }
  }

  if (preview.options.length > 0 && !preview.selectedOptionId) {
    return {
      canSendMessage: true,
      canStartDraft: false,
      canConfirmDraft: false,
      draftBlockedReason: 'Plusieurs options sont proposées : en choisir une.',
    }
  }

  return { canSendMessage: true, canStartDraft: true, canConfirmDraft: false, draftBlockedReason: null }
}

/* ───────────────────────────── Fil de conversation ─────────────────────── */

export interface ChatLine {
  id: string
  role: ProjectBuilderMessage['role']
  content: string
  createdAt: string
}

/**
 * Le fil affichable.
 *
 * Les messages `system` sont conservés : ils portent les transitions réelles du
 * flux (matérialisation lancée, draft créé) et les masquer donnerait un fil qui
 * saute des étapes.
 */
export function buildChatLines(messages: readonly ProjectBuilderMessage[]): ChatLine[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }))
}
