/**
 * Le CATALOGUE des mutations de la surface Livraison — données pures.
 *
 * TROIS DÉCISIONS D'ARCHITECTURE TENUES ICI
 * -----------------------------------------
 * 1. **Aucune Server Action.** Une Server Action POSTe vers la route de la PAGE
 *    (`/delivery/...`), qui n'est PAS sous `/api/agent-ops/**`, donc hors du
 *    `matcher` de `src/proxy.ts`. Ce serait une quatrième frontière de confiance,
 *    mutante et non gardée, ouverte par simple commodité d'écriture. Toute
 *    mutation part donc en `fetch` depuis un composant client vers une route
 *    `/api/agent-ops/**` déjà gardée.
 *
 * 2. **DRY-RUN PAR DÉFAUT, sans exception.** Chaque descripteur de livraison
 *    porte `confirm: false` dans son corps initial. Le mode réel est un choix
 *    explicite de l'opérateur dans le dialogue — et il reste sans effet tant que
 *    le second verrou serveur est fermé. Aucun formulaire de cette surface ne
 *    s'ouvre sur une écriture distante.
 *
 * 3. **LE DOUBLE VERROU SE DÉCRIT, IL NE S'ARME PAS.** Une écriture GitHub
 *    réelle exige `confirm: true` DANS LA REQUÊTE **et** `GITHUB_PUSH_ENABLED=1`
 *    DANS L'ENVIRONNEMENT (`AGENTS.md` § Shipping). Le premier verrou appartient
 *    à l'opérateur et cette surface le lui présente. Le second appartient au
 *    serveur : cette surface le LIT pour dire s'il est fermé, ne l'écrit jamais,
 *    et **ne suggère nulle part de l'ouvrir**. Un écran qui expliquerait
 *    comment armer une écriture distante destructive serait un mode d'emploi de
 *    contournement, pas un plan de contrôle.
 *
 * Ce module ne fait AUCUNE I/O : il décrit les mutations (chemin, corps, coût,
 * conséquence) pour que le composant client se contente de les exécuter, et pour
 * que ces descriptions restent testables sans DOM.
 */

/** Ce qu'une mutation coûte réellement, dit AVANT de la lancer. */
export type MutationCost =
  /** Aucune écriture distante, aucun appel facturé. */
  | { kind: 'free'; detail: string }
  /** Écriture RÉELLE sur un dépôt tiers. Le geste le plus lourd de la surface. */
  | { kind: 'remote_write'; detail: string }
  /** Exécution longue (clone, scripts) sans écriture distante. */
  | { kind: 'compute'; detail: string }

export interface MutationDescriptor {
  /** Verbe affiché sur le bouton. */
  label: string
  /** Ce qui va être fait, en une phrase — repris tel quel dans le Dialog. */
  intent: string
  cost: MutationCost
  /**
   * Ce que la mutation NE fait PAS. Sur cette surface, c'est aussi important que
   * l'intention : la moitié des malentendus de livraison viennent d'un geste dont
   * on a surestimé la portée (« j'ai poussé, donc c'est déployé »).
   */
  doesNot: string
}

/* ═════════════════ Livraison de l'agent ═════════════════ */

/**
 * L'essai de livraison — le DÉFAUT de la surface.
 *
 * `confirm` est absent du corps, donc `push-agent/route.ts` calcule
 * `dryRun = true` quelle que soit la configuration serveur. Rien ne part vers
 * GitHub en écriture.
 */
export const PUSH_DRY_RUN: MutationDescriptor = {
  label: 'Essayer la livraison (dry-run)',
  intent:
    'Construire le paquet de l’agent (registre, manifeste, handler, README) et vérifier qu’il est livrable, sans écrire quoi que ce soit sur le dépôt cible.',
  cost: {
    kind: 'free',
    detail:
      'Aucune écriture distante. Le corps ne porte pas `confirm`, donc la route retombe en dry-run par construction — même si le verrou serveur était ouvert.',
  },
  doesNot:
    'N’écrit aucun commit, n’ouvre aucune branche, n’ouvre aucune PR, ne laisse aucune trace dans `agent_delivery_events` (seules les livraisons réelles y sont persistées).',
}

/**
 * La livraison RÉELLE — décrite, jamais armée par défaut.
 *
 * Ce descripteur existe pour que l'opérateur sache exactement ce qu'il
 * demanderait. Il ne devient sélectionnable que par un geste explicite dans le
 * dialogue, et le serveur garde le dernier mot : sans `GITHUB_PUSH_ENABLED=1`,
 * la route retombe en dry-run et le répond honnêtement (`dryRun: true`).
 */
export const PUSH_REAL: MutationDescriptor = {
  label: 'Livrer réellement',
  intent:
    'Ouvrir une pull request sur le dépôt cible avec le paquet de l’agent. C’est une ÉCRITURE sur un dépôt qui appartient au consommateur.',
  cost: {
    kind: 'remote_write',
    detail:
      'Écriture réelle sur un dépôt tiers. Elle exige DEUX verrous : la confirmation ci-dessous ET un verrou serveur qui n’appartient pas à cette interface. Si le second est fermé, la route retombe en dry-run et le dit — elle ne prétend jamais avoir écrit.',
  },
  doesNot:
    'Ne merge PAS la PR, n’active PAS l’agent chez le consommateur, ne déploie RIEN. Après la poussée, Aigent n’a plus aucun canal de lecture sur ce qui arrive à cette PR.',
}

/* ═════════════════ Sandbox du dépôt cible ═════════════════ */

export const SANDBOX_DRY_RUN: MutationDescriptor = {
  label: 'Évaluer le dépôt cible (dry-run)',
  intent:
    'Lire les artefacts livrés dans le dépôt cible via l’API Contents, vérifier qu’ils parsent et sont enregistrés, et DÉTECTER les scripts de gate du dépôt.',
  cost: {
    kind: 'free',
    detail:
      'Lecture seule via l’API GitHub. Aucun clone, aucun script exécuté, aucune écriture — y compris quand le rapport est vert.',
  },
  doesNot:
    'N’exécute AUCUN script du dépôt cible : il les détecte. Un verdict vert ne dit donc rien sur le fait que `npm run build` du consommateur passerait.',
}

export const SANDBOX_EXECUTE: MutationDescriptor = {
  label: 'Exécuter les scripts du dépôt cible',
  intent:
    'Cloner le dépôt cible dans un espace jetable et y exécuter réellement ses propres scripts de gate (typecheck, lint, test, build).',
  cost: {
    kind: 'compute',
    detail:
      'Clone complet puis exécution bornée de scripts : plusieurs minutes possibles. Aucune écriture distante — le clone est jetable et n’est jamais poussé.',
  },
  doesNot: 'N’écrit rien sur le dépôt cible, ne commite pas dans le clone, ne pousse jamais.',
}

/* ═════════════════ Provisioning consommateur ═════════════════ */

export const PROVISION_DRY_RUN: MutationDescriptor = {
  label: 'Essayer le provisioning (dry-run)',
  intent:
    'Construire le pack d’accueil consommateur (registre d’agents, bindings, page d’intake, client de télémétrie) et lister ce qui serait écrit, sans rien écrire.',
  cost: {
    kind: 'free',
    detail: 'Aucune écriture distante. Le corps ne porte pas `confirm` : la route reste en dry-run par construction.',
  },
  doesNot: 'N’écrit aucun fichier sur le dépôt du consommateur, n’ouvre aucune PR.',
}

export const PROVISION_REAL: MutationDescriptor = {
  label: 'Provisionner réellement',
  intent:
    'Ouvrir une pull request qui installe le pack d’accueil consommateur dans le dépôt cible : c’est ce pack qui donnera au consommateur les moyens d’activer un agent et de renvoyer sa télémétrie.',
  cost: {
    kind: 'remote_write',
    detail:
      'Écriture réelle sur un dépôt tiers, soumise aux mêmes deux verrous que la livraison d’un agent.',
  },
  doesNot:
    'N’active aucun agent. Le provisioning INSTALLE le canal ; c’est le consommateur qui décide ensuite d’activer, de rebinder ou de déployer une version. Aigent ne verra pas ces gestes.',
}

/* ═════════════════ Lecture des erreurs de route ═════════════════ */

/**
 * Ce que dit un code HTTP de `/api/agent-ops/**`, en français, sans inventer.
 *
 * Les codes de cette surface ont des causes PRODUIT identifiées (422 = pas de
 * version promue, 409 = branche déjà là ou course de push). Les traduire ici
 * évite qu'un écran affiche un « 409 » nu là où la cause est un invariant connu —
 * et évite surtout de présenter un refus délibéré comme une panne.
 */
export function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Requête invalide — un identifiant ou un champ du corps n’a pas la forme attendue.'
    case 401:
    case 403:
      return 'Non authentifié pour ce périmètre. La session opérateur est requise.'
    case 404:
      return 'Ressource introuvable — le projet, le copilot ou son manifeste n’existe pas.'
    case 409:
      return 'Conflit — la branche de livraison existe déjà, ou la branche par défaut a avancé pendant la poussée. Les deux sont des issues normales d’une course, et les deux sont rejouables.'
    case 422:
      return 'Refusé par une gate — le plus souvent : ce copilot n’a aucune version PROMUE en production, et seule une version promue peut être livrée dans un dépôt réel.'
    case 502:
      return 'Défaillance en amont (base de données ou API GitHub).'
    case 503:
      return 'Backend live ou GitHub non configuré — cette surface est fail-closed, il n’existe aucun chemin simulé.'
    case 504:
      return 'Délai dépassé en amont. L’action a pu partir sans que sa réponse revienne — relire l’état du dépôt avant de relancer.'
    default:
      return `Réponse inattendue (${status}).`
  }
}

/**
 * Le résultat d'une livraison, tel que `push-agent/route.ts` le renvoie.
 *
 * `dryRun` est le champ décisif et il vient TOUJOURS du serveur : cette surface
 * ne déduit jamais du corps envoyé si l'écriture a eu lieu. Une confirmation
 * cochée côté client sur un serveur verrouillé rend `dryRun: true` — et c'est
 * cette valeur-là, pas l'intention du clic, qui décide de ce que l'écran dit.
 */
export interface PushResult {
  pushed?: boolean
  dryRun?: boolean
  mode?: string
  branch?: string
  baseBranch?: string
  commitSha?: string | null
  commitUrl?: string | null
  prUrl?: string | null
  prNumber?: number | null
  message?: string
  files?: unknown[]
}

/**
 * Comment lire un `PushResult` sans jamais affirmer une écriture qui n'a pas eu
 * lieu. PURE, testée : c'est la règle qui empêche « livré » d'apparaître sur un
 * dry-run.
 *
 * `pushed === true && dryRun === false` est la SEULE combinaison qui prouve une
 * écriture. Toute autre — y compris `pushed: true` avec `dryRun: true`, que la
 * route produit sur un essai réussi — est un essai.
 */
export function readPushOutcome(result: PushResult): {
  wrote: boolean
  stateId: 'push_succeeded' | 'pr_opened' | 'dry_run_done' | 'shipping_disabled'
  title: string
} {
  const wrote = result.pushed === true && result.dryRun === false
  if (!wrote) {
    // Le serveur a répondu `dryRun: true` alors que l'opérateur avait confirmé :
    // le second verrou est fermé. C'est un état de CONFIGURATION, pas un échec.
    return {
      wrote: false,
      stateId: 'dry_run_done',
      title: 'Dry-run effectué — rien n’a été écrit sur le dépôt cible.',
    }
  }
  if (result.prUrl != null) {
    return { wrote: true, stateId: 'pr_opened', title: 'PR ouverte sur le dépôt cible.' }
  }
  return { wrote: true, stateId: 'push_succeeded', title: 'Commit écrit sur le dépôt cible.' }
}
