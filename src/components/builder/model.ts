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
import type { ProjectBuilderStreamEvent } from '@/lib/agent-mission-control/project-builder-stream-protocol'
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
 * Un contrat `ReadState`/`ReadOutcome` a vécu ici — 47 lignes documentées
 * décrivant comment distinguer « lu et vide » de « pas lu ». Il n'était importé
 * par AUCUN composant ni aucune page : les écrans utilisaient à la place des
 * booléens ad hoc (`unreadable`, `failure`, `backendUnavailable`), c'est-à-dire
 * exactement le booléen que son propre commentaire disait avoir remplacé par un
 * type. Ses seuls consommateurs étaient ses tests, qui le prouvaient lui-même
 * sans rien prouver de l'écran.
 *
 * Supprimé plutôt que rebranché : un contrat de vérité documenté et jamais
 * appelé est pire que pas de contrat, parce qu'il fait croire que la
 * distinction est structurelle alors qu'elle est tenue à la main, panneau par
 * panneau. Si le besoin d'un type revient, il devra être adopté par les écrans
 * dans le même commit — pas déposé en avance.
 */

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

/** Pluriel français simple — évite les template literals imbriqués en UI. */
export function frenchPluralSuffix(count: number, suffix = 's'): string {
  return count > 1 ? suffix : ''
}

export function projectCountLabel(count: number): string {
  return count + ' projet' + frenchPluralSuffix(count)
}

export function messageCountLabel(count: number): string {
  return count + ' message' + frenchPluralSuffix(count)
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

function nonEmpty(value: string | null | undefined): string | null {
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

/* ──────────────────── Tour d'architecte en flux (SSE) ──────────────────── */

/**
 * L'état d'un tour d'architecte tel que le FLUX le dit — jamais plus.
 *
 * CE QUE LE PROTOCOLE ÉMET RÉELLEMENT
 * -----------------------------------
 * `project-builder-stream-protocol.ts` ne connaît que quatre formes :
 *
 *  · `connected`            — le serveur a ouvert le flux et a commencé le tour ;
 *  · `delta`                — un fragment de PROSE de la réponse ;
 *  · `terminal`/`completed` — la réponse est écrite en base (messageId, preview,
 *                             conversationStatus, createdCopilotId) ;
 *  · `terminal`/`failed`    — le tour a échoué côté serveur (`error`, `retryable`).
 *
 * Et rien d'autre. En particulier : **le protocole ne porte AUCUN événement
 * d'appel d'outil**. Les allers-retours de lecture du dépôt (« jusqu'à 8 »
 * annoncés par le dialog) tournent entièrement côté serveur, à l'intérieur de
 * `runArchitectLoop`, AVANT que la prose finale ne commence à être streamée.
 * Cette phase est donc silencieuse sur le fil : on la nomme honnêtement
 * « l'architecte lit le dépôt — aucune étape n'est rapportée par le flux »
 * plutôt que d'inventer une liste d'outils que personne n'a envoyée.
 *
 * De même : **aucun total n'est connu**. Il n'existe ni compteur d'étapes ni
 * progression en pourcentage dans le protocole. La surface n'affiche donc pas de
 * barre de progression — elle affiche les octets réellement reçus.
 *
 * LE CAS QUI COMPTE : `interrupted`
 * ---------------------------------
 * Un flux coupé avant le terminal (réseau, onglet, proxy) ne prouve NI le
 * succès NI l'échec : le serveur a très bien pu terminer le tour et persister la
 * réponse. C'est exactement ce que dit `IncompleteSSEStreamError`. On ne
 * l'affiche donc jamais comme un échec — c'est une phase à part, `interrupted`,
 * dont la seule sortie honnête est « recharger pour savoir ».
 */
export type StreamPhase =
  | 'idle'
  | 'opening'
  | 'working'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'interrupted'

export interface StreamProgress {
  phase: StreamPhase
  /** Titre court, en français — jamais un littéral de protocole brut. */
  label: string
  /** Ce que l'opérateur doit comprendre maintenant. `null` s'il n'y a rien à dire. */
  detail: string | null
  /** La prose reçue jusqu'ici, concaténée dans l'ordre des `delta`. */
  text: string
  /** Nombre de fragments de prose reçus — une mesure, pas une estimation. */
  deltaCount: number
  /** `runId` du serveur, connu dès le premier événement. `null` avant. */
  runId: string | null
  /**
   * Code d'erreur RÉELLEMENT émis par le serveur, jamais fabriqué. `null` tant
   * qu'aucun `terminal`/`failed` n'est arrivé.
   */
  errorCode: 'architect_message_failed' | 'transport_interrupted' | 'persistence_timeout' | null
  /** `true` seulement quand le serveur l'a dit dans son terminal d'échec. */
  retryable: boolean
  /** Le terminal de succès, quand il est arrivé — la preuve de persistance. */
  completion: {
    messageId: string
    conversationId: string | null
    conversationStatus: string
    createdCopilotId: string | null
  } | null
  /**
   * `true` quand un flux a été ouvert mais que le résultat serveur est INCONNU.
   * L'écran doit alors proposer de recharger, pas affirmer un résultat.
   */
  outcomeUnknown: boolean
}

export const INITIAL_STREAM_PROGRESS: StreamProgress = {
  phase: 'idle',
  label: 'Aucun tour en cours',
  detail: null,
  text: '',
  deltaCount: 0,
  runId: null,
  errorCode: null,
  retryable: false,
  completion: null,
  outcomeUnknown: false,
}

/** L'état de départ dès que la confirmation est passée et que le POST part. */
export function openingStreamProgress(): StreamProgress {
  return {
    ...INITIAL_STREAM_PROGRESS,
    phase: 'opening',
    label: 'Ouverture du flux',
    detail: 'La requête est partie ; le serveur n’a pas encore confirmé le tour.',
  }
}

/**
 * Réduit un événement du flux dans l'état d'écran. PUR : aucune I/O, aucun
 * effet — c'est ce qui rend le comportement du flux testable sans DOM.
 *
 * Les heartbeats n'arrivent JAMAIS ici : ce sont des lignes de commentaire SSE
 * (`: heartbeat …`) sans champ `data:`, que `consumeSSE` écarte avant d'appeler
 * le consommateur. Un battement de cœur n'est donc pas une étape, et il ne peut
 * pas en devenir une par accident.
 */
export function reduceStreamEvent(
  state: StreamProgress,
  event: ProjectBuilderStreamEvent,
): StreamProgress {
  // GARDE DE TERMINALITÉ — une issue prouvée ne se réécrit pas.
  //
  // Sans elle, trois séquences produisaient un mensonge (les trois trouvées en
  // revue croisée, aucune déclenchable par le serveur actuel, toutes de même
  // cause) : un `delta` arrivant après un `completed` repassait `outcomeUnknown`
  // à `true` alors que la réponse est persistée ; un second terminal `failed`
  // effaçait une `completion` réelle ; et un tour prouvé pouvait redevenir
  // « en cours ». `markStreamInterrupted` posait déjà ce garde pour la coupure —
  // l'asymétrie était une faille de discipline dans un module dont l'argument
  // est précisément que les issues ne se confondent jamais.
  if (state.phase === 'completed' || state.phase === 'failed') return state

  if (event.type === 'connected') {
    return {
      ...state,
      phase: 'working',
      runId: event.runId,
      label: 'L’architecte travaille',
      detail:
        'Le tour a démarré. L’architecte peut lire le dépôt avant de répondre : cette phase ne rapporte aucune étape sur le flux, seule la réponse est streamée.',
      outcomeUnknown: true,
    }
  }

  if (event.type === 'delta') {
    return {
      ...state,
      phase: 'streaming',
      runId: event.runId,
      text: state.text + event.delta,
      deltaCount: state.deltaCount + 1,
      label: 'Réponse en cours',
      detail: 'L’architecte rédige sa réponse — elle s’écrit ci-dessous au fil du flux.',
      outcomeUnknown: true,
    }
  }

  if (event.lifecycle === 'completed') {
    return {
      ...state,
      phase: 'completed',
      runId: event.runId,
      label: 'Tour terminé',
      detail: 'La réponse est persistée dans le fil du projet.',
      errorCode: null,
      retryable: false,
      completion: {
        messageId: event.messageId,
        conversationId: event.conversationId,
        conversationStatus: event.conversationStatus,
        createdCopilotId: event.createdCopilotId,
      },
      outcomeUnknown: false,
    }
  }

  // L'ÉCHEC EST AFFIRMÉ, jamais déduit par défaut.
  //
  // Ce `return` était un fourre-tout : tout ce qui n'était ni `connected`, ni
  // `delta`, ni `completed` devenait « Tour en échec ». Testé à la main sur un
  // `{type:'tool_call'}` hypothétique, il produisait phase `failed` et
  // `errorCode: undefined` — une valeur HORS du type déclaré, et un échec que
  // le serveur n'a jamais prononcé. Le jour où le protocole gagne un cinquième
  // événement — un événement d'appel d'outil est le candidat évident, et c'est
  // l'absence que cette surface documente — l'UI l'aurait peint en rouge.
  //
  // On n'affirme donc l'échec que sur le littéral que le protocole émet
  // vraiment. Tout autre événement est IGNORÉ : ne pas savoir interpréter un
  // message n'autorise pas à conclure que le tour a échoué.
  if (event.type === 'terminal' && event.lifecycle === 'failed') {
    return {
      ...state,
      phase: 'failed',
      runId: event.runId,
      label: 'Tour en échec',
      detail:
        'Le serveur a signalé l’échec du tour. Ce n’est pas une coupure : le serveur a répondu, et il dit que le tour n’a pas abouti.',
      errorCode: event.error,
      retryable: event.retryable,
      completion: null,
      outcomeUnknown: false,
    }
  }

  return state
}

/**
 * Le flux s'est arrêté sans terminal — coupure réseau, onglet, proxy.
 *
 * On ne convertit PAS ça en échec. Le serveur a pu finir : la seule affirmation
 * vraie est « on ne sait pas ». Un tour déjà terminé (`completed`/`failed`)
 * n'est évidemment pas repeint par une coupure survenue après coup.
 */
export function markStreamInterrupted(state: StreamProgress, reason: string | null): StreamProgress {
  if (state.phase === 'completed' || state.phase === 'failed') return state
  return {
    ...state,
    phase: 'interrupted',
    label: 'Flux interrompu — résultat inconnu',
    detail:
      'La connexion s’est arrêtée avant la fin annoncée par le serveur. On ne sait pas si le tour a abouti : il a pu être persisté sans que la réponse nous parvienne. Recharger pour lire l’état réel.' +
      (reason === null ? '' : ` (${reason})`),
    outcomeUnknown: true,
  }
}
