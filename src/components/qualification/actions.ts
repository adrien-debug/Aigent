/**
 * Le CATALOGUE des mutations de la surface Qualification — données pures.
 *
 * DEUX DÉCISIONS D'ARCHITECTURE TENUES ICI
 * ----------------------------------------
 * 1. **Aucune Server Action.** Une Server Action POSTe vers la route de la PAGE
 *    (`/qualification/...`), qui n'est PAS sous `/api/agent-ops/**` — donc hors
 *    du `matcher` de `src/proxy.ts`. Ce serait une QUATRIÈME frontière de
 *    confiance, non gardée, ouverte par commodité d'écriture. Toute mutation de
 *    cette surface part donc en `fetch` depuis un composant client vers une
 *    route `/api/agent-ops/**` déjà gardée. Contrat tranché, pas une préférence.
 * 2. **Fixture / dry-run par DÉFAUT.** Chaque descripteur porte son mode
 *    initial ; le mode live est une case à cocher que l'opérateur doit armer.
 *    Aucun formulaire de cette surface ne s'ouvre sur une exécution facturée.
 *
 * Ce module ne fait AUCUNE I/O : il décrit les mutations (chemin, corps, coût,
 * conséquence) pour que le composant client se contente de les exécuter et que
 * ces descriptions restent testables sans DOM.
 */

/** Ce qu'une mutation coûte réellement, dit avant de la lancer. */
export type MutationCost =
  /** Aucun appel LLM, aucun réseau externe : la fixture déterministe. */
  | { kind: 'free'; detail: string }
  /** Des appels LLM réels sont facturés. Le montant exact n'est pas connaissable d'ici. */
  | { kind: 'billed'; detail: string }
  /** Écriture irréversible en base, sans coût LLM. */
  | { kind: 'irreversible'; detail: string }

export interface MutationDescriptor {
  /** Verbe affiché sur le bouton. */
  label: string
  /** Ce qui va être fait, en une phrase — repris tel quel dans le Dialog. */
  intent: string
  cost: MutationCost
  /**
   * `true` quand la mutation exige une confirmation explicite dans un Dialog.
   *
   * Vrai pour TOUT ce qui est facturé ou irréversible (décision D2 : pas de
   * mutation facturée en un clic), et pour la décision humaine — dont la
   * confirmation EST le garde-fou, pas une politesse.
   */
  requiresDialog: boolean
}

/* ─────────────────── Le catalogue ─────────────────── */

export const GENERATE_SUITE: MutationDescriptor = {
  label: 'Générer la suite',
  intent:
    'Synthétiser une suite de tests et une suite de benchmark pour ce copilot via un vrai appel de modèle, puis les persister.',
  cost: {
    kind: 'billed',
    detail:
      'Un appel de complétion réel est facturé. La génération prend quelques secondes ; elle n’exécute AUCUN test — elle crée seulement la suite.',
  },
  requiresDialog: true,
}

export const RUN_TESTS: MutationDescriptor = {
  label: 'Exécuter la suite',
  intent:
    'Exécuter chaque cas de la suite contre le candidat, avec un juge par cas, et persister test_runs + test_results.',
  cost: {
    kind: 'billed',
    detail:
      'Un appel de modèle par cas, plus un appel de juge par cas. Le coût croît avec la taille de la suite.',
  },
  requiresDialog: true,
}

export const RUN_BENCHMARK: MutationDescriptor = {
  label: 'Lancer le benchmark',
  intent: 'Exécuter et noter chaque tâche de la suite de benchmark, puis persister le résultat.',
  cost: { kind: 'billed', detail: 'Un appel de modèle par tâche, plus la notation. Facturé.' },
  requiresDialog: true,
}

export const RUN_SWEEP: MutationDescriptor = {
  label: 'Lancer le balayage',
  intent:
    'Exécuter la MÊME suite de benchmark sur chaque modèle sélectionné, l’un après l’autre, et rendre un verdict par modèle.',
  cost: {
    kind: 'billed',
    detail:
      'N exécutions SÉQUENTIELLES d’une suite complète — le coût est multiplié par le nombre de modèles (8 au maximum). Un balayage long peut dépasser le budget de temps de la requête et rendre un 504 en amont de la route.',
  },
  requiresDialog: true,
}

export const RUN_QUALIFICATION: MutationDescriptor = {
  label: 'Lancer la qualification',
  intent:
    'Parcourir tests → benchmark → shadow → replay → gate pour ce candidat, en s’arrêtant à la gate. Ce parcours ne promeut RIEN.',
  cost: {
    kind: 'billed',
    detail:
      'Le parcours lit les preuves existantes et évalue la gate ; les étapes qui exécutent réellement un modèle sont facturées. Il s’arrête toujours avant la promotion.',
  },
  requiresDialog: true,
}

export const RUN_SHADOW_FIXTURE: MutationDescriptor = {
  label: 'Shadow (fixture)',
  intent:
    'Faire tourner le moteur shadow réel avec l’agent fixture déterministe : chaque appel d’outil mutant est intercepté, rien n’est exécuté à l’extérieur.',
  cost: {
    kind: 'free',
    detail:
      'Aucun appel réseau, aucun coût. La preuve est estampillée « simulation » et ne débloque JAMAIS une promotion de production.',
  },
  requiresDialog: false,
}

export const RUN_SHADOW_LIVE: MutationDescriptor = {
  label: 'Shadow (live)',
  intent:
    'Exécuter réellement le candidat sous LangGraph via un assistant éphémère, chaque outil mutant restant intercepté (il s’interrompt, il ne s’exécute pas).',
  cost: {
    kind: 'billed',
    detail:
      'Un vrai run LangGraph du candidat, facturé. C’est le SEUL mode qu’une gate de promotion accepte pour un check shadow exigé.',
  },
  requiresDialog: true,
}

export const RUN_REPLAY_FIXTURE: MutationDescriptor = {
  label: 'Replay (fixture)',
  intent:
    'Comparer référence et candidat sur le corpus avec les sorties fixtures déterministes, et persister la comparaison.',
  cost: { kind: 'free', detail: 'Aucun appel réseau, aucun coût. Preuve estampillée « simulation ».' },
  requiresDialog: false,
}

export const RUN_REPLAY_LIVE: MutationDescriptor = {
  label: 'Replay (live)',
  intent:
    'Exécuter réellement la version de PRODUCTION et le candidat sur le même corpus, via leurs assistants éphémères, et comparer cas par cas.',
  cost: {
    kind: 'billed',
    detail:
      'DEUX runs LangGraph réels par cas — la référence et le candidat. C’est la mutation la plus coûteuse de cette surface, et le seul mode qu’une gate accepte pour un check replay exigé.',
  },
  requiresDialog: true,
}

export const PROMOTE: MutationDescriptor = {
  label: 'Promouvoir en production',
  intent:
    'Faire de cette version la version de production : la précédente est archivée et le pointeur du copilot est déplacé, en une seule transaction.',
  cost: {
    kind: 'irreversible',
    detail:
      'Écriture IRRÉVERSIBLE en base. Le serveur ré-évalue la gate complète avant d’écrire et la RPC transactionnelle relit une évaluation fraîche et passante : cette interface ne contourne rien et ne peut rien contourner.',
  },
  requiresDialog: true,
}

export const ROLLBACK: MutationDescriptor = {
  label: 'Revenir à cette version',
  intent:
    'Remettre en production une version précédemment servie (archivée). La version courante est archivée à son tour.',
  cost: {
    kind: 'irreversible',
    detail:
      'Écriture IRRÉVERSIBLE en base. Le retour arrière est dispensé de gate parce que la cible a DÉJÀ servi la production — la route le prouve en exigeant un stade « archived ».',
  },
  requiresDialog: true,
}

export const ANALYZE: MutationDescriptor = {
  label: 'Analyser les échecs',
  intent:
    'Collecter les signaux réels (cas en échec, scores, runs, traces) et faire produire au modèle architecte une proposition de manifeste validée.',
  cost: {
    kind: 'billed',
    detail:
      'Collecte de signaux puis un appel d’architecte facturé. Une seule boucle ouverte par copilot : s’il en existe déjà une, la route refuse avec un 409.',
  },
  requiresDialog: true,
}

export const CREATE_V2: MutationDescriptor = {
  label: 'Matérialiser la V2',
  intent:
    'Créer le manifeste et la version V2 en brouillon depuis la proposition, et re-provisionner l’assistant LangGraph pour que le comportement V2 tourne réellement.',
  cost: {
    kind: 'irreversible',
    detail:
      'Écrit de nouvelles lignes et déplace le pointeur de version courante. La version reste un BROUILLON — rien n’est promu.',
  },
  requiresDialog: true,
}

export const DECIDE_APPROVE: MutationDescriptor = {
  label: 'Approuver la boucle',
  intent: 'Enregistrer la DÉCISION HUMAINE d’approbation sur cette proposition.',
  cost: {
    kind: 'irreversible',
    detail:
      'La décision est définitive : une proposition déjà décidée ne se redécide pas (409). Elle ne promeut RIEN — la promotion reste une action séparée derrière sa propre gate.',
  },
  requiresDialog: true,
}

export const DECIDE_REJECT: MutationDescriptor = {
  label: 'Rejeter la boucle',
  intent: 'Enregistrer la DÉCISION HUMAINE de rejet sur cette proposition.',
  cost: {
    kind: 'irreversible',
    detail: 'La décision est définitive : une proposition déjà décidée ne se redécide pas (409).',
  },
  requiresDialog: true,
}

/* ─────────────────── Lecture des erreurs de route ─────────────────── */

/**
 * Ce que dit un code HTTP de `/api/agent-ops/**`, en français, sans inventer.
 *
 * Les routes de ce périmètre partagent un vocabulaire de codes stable et
 * documenté dans chacune d'elles. Le traduire ici évite qu'un écran affiche un
 * « 409 » nu là où la cause est un invariant produit connu — et évite surtout de
 * présenter un refus délibéré comme une panne.
 */
export function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Requête invalide — un identifiant ou un champ du corps n’a pas la forme attendue.'
    case 401:
    case 403:
      return 'Non authentifié pour ce périmètre. La session opérateur est requise.'
    case 404:
      return 'Ressource introuvable — le copilot, la version ou la suite n’existe pas (ou n’appartient pas à ce copilot).'
    case 409:
      return 'Conflit — un invariant du produit refuse cette action dans l’état actuel. Le détail ci-dessous dit lequel.'
    case 422:
      return 'Refusé par une gate — la preuve exigée est absente, périmée ou insuffisante.'
    case 502:
      return 'Défaillance en amont (base, modèle ou moteur d’exécution).'
    case 503:
      return 'Backend live non configuré — cette surface est fail-closed, il n’existe aucun chemin simulé.'
    case 504:
      return 'Délai dépassé en amont. L’action a pu partir sans que sa réponse revienne — relire l’état avant de relancer.'
    default:
      return `Réponse inattendue (${status}).`
  }
}
