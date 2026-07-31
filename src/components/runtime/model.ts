/**
 * Vocabulaire de la surface Runtime — pur, isomorphe, sans lecture.
 *
 * Ce module ne lit RIEN. Il porte les six onglets, la traduction d'un `?tab=`
 * en onglet valide, et les libellés des faits que les écrans rendent. Le tout
 * est isomorphe : aucune importation `server-only` ici, pour que les atomes
 * client puissent en dépendre.
 *
 * RÈGLE TENUE ICI — les trois absences ne se confondent jamais :
 *   · `unread`   la lecture a été TENTÉE et a échoué (backend/API muet) ;
 *   · `no-data`  la lecture a RÉUSSI et il n'y avait rien ;
 *   · `n/a`      la question ne s'applique pas.
 * Un helper `Loaded<T>` encode les deux premières et interdit de rendre une
 * lecture échouée comme une liste vide — la faute que cette surface doit le
 * plus éviter, puisqu'elle décrit précisément ce qui est câblé ou non.
 */

/* ─────────────────────────────── Onglets ─────────────────────────────── */

export const RUNTIME_TABS = [
  {
    id: 'telemetry',
    name: 'Télémétrie',
    purpose: 'Le canal de retour des agents déployés : santé du canal et événements reçus.',
  },
  {
    id: 'langgraph',
    name: 'LangGraph',
    purpose: "L'Agent Server : son endpoint, ses assistants, ses threads, la topologie du graphe.",
  },
  {
    id: 'tools',
    name: 'Outils',
    purpose: 'Le registre canonique des outils montables, leur nature et leur contrat.',
  },
  {
    id: 'providers',
    name: 'Providers',
    purpose: 'Ce qui est réellement câblé, ce qui est opt-in, ce qui ne l’est pas du tout.',
  },
  {
    id: 'models',
    name: 'Modèles',
    purpose: 'Les modèles adressables par provider et leur tarification déclarée.',
  },
  {
    id: 'repositories',
    name: 'Dépôts',
    purpose: 'Les dépôts liés aux projets consommateurs et leur lisibilité réelle.',
  },
] as const satisfies readonly { id: string; name: string; purpose: string }[]

export type RuntimeTabId = (typeof RUNTIME_TABS)[number]['id']

export const DEFAULT_RUNTIME_TAB: RuntimeTabId = 'telemetry'

/**
 * Un `?tab=` arbitraire → un onglet valide.
 *
 * Une valeur inconnue retombe sur le défaut plutôt que de rendre un 404 : le
 * paramètre décore une surface qui existe, il ne la désigne pas. En revanche la
 * valeur retenue est TOUJOURS un membre de l'union — jamais la chaîne brute
 * réinjectée dans le DOM.
 */
export function resolveRuntimeTab(raw: string | string[] | undefined): RuntimeTabId {
  const value = Array.isArray(raw) ? raw[0] : raw
  const match = RUNTIME_TABS.find((tab) => tab.id === value)
  return match ? match.id : DEFAULT_RUNTIME_TAB
}

export function runtimeTab(id: RuntimeTabId): (typeof RUNTIME_TABS)[number] {
  const tab = RUNTIME_TABS.find((candidate) => candidate.id === id)
  if (!tab) throw new Error(`runtimeTab: onglet inconnu — ${id}`)
  return tab
}

/** Le href canonique d'un onglet. L'onglet par défaut garde l'URL nue. */
export function runtimeTabHref(id: RuntimeTabId): string {
  return id === DEFAULT_RUNTIME_TAB ? '/runtime' : `/runtime?tab=${id}`
}

/* ──────────────────────── Lecture réussie / échouée ──────────────────── */

/**
 * Le résultat d'une lecture, avec son échec conservé.
 *
 * `ok: false` porte la raison ; il ne dégénère JAMAIS en `data: []`. C'est ce
 * qui permet à chaque panneau de dire « je n'ai pas pu lire » au lieu de
 * « il n'y a rien » — deux affirmations opposées.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: string }

export async function load<T>(read: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await read() }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'lecture impossible' }
  }
}

/** Variante synchrone — pour les résolutions d'environnement qui peuvent lever. */
export function loadSync<T>(read: () => T): Loaded<T> {
  try {
    return { ok: true, data: read() }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'résolution impossible' }
  }
}

/* ───────────────────────── Câblage d'un provider ─────────────────────── */

/**
 * L'état de câblage d'un provider — quatre états, et le quatrième compte.
 *
 * `not-wired` n'est pas `unconfigured` : Mistral n'a pas de clé manquante, il
 * n'a PAS DE CODE. Les afficher pareil suggérerait qu'une variable
 * d'environnement suffirait à le faire marcher.
 */
export type ProviderWiring =
  | 'wired' // code câblé ET credentials présents
  | 'wired-unconfigured' // code câblé, credentials absents
  | 'opt-in' // code câblé, activation explicite requise (parc local)
  | 'not-wired' // aucun code — aucune variable ne changera ça

export const PROVIDER_WIRING_LABEL: Record<ProviderWiring, string> = {
  wired: 'câblé',
  'wired-unconfigured': 'câblé, non configuré',
  'opt-in': 'opt-in explicite',
  'not-wired': 'non câblé',
}

export const PROVIDER_WIRING_MEANING: Record<ProviderWiring, string> = {
  wired: 'Le chemin d’appel existe dans le code et ses credentials sont présents dans cet environnement.',
  'wired-unconfigured':
    'Le chemin d’appel existe dans le code, mais la clé n’est pas présente ici. Un appel échouerait en ProviderUnavailableError — pas en fallback muet.',
  'opt-in':
    'Le chemin d’appel existe mais n’est pas actif par défaut : il exige une activation explicite par variable d’environnement. Absent ne veut pas dire cassé.',
  'not-wired':
    'Aucun chemin d’appel n’existe dans le code. Un appel lève une erreur typée — il n’y a jamais de fallback silencieux vers un autre provider. Aucune configuration ne l’activera.',
}

/* ─────────────────────── Provisioning d'un agent ─────────────────────── */

/**
 * Le piège de l'assistant, en trois états — jamais deux.
 *
 * `runtimeProvisioned` du contrat canonique est déjà ternaire ; on se contente
 * de le nommer. Le point : `null` (« pas applicable / pas lu ») ne doit PAS
 * s'afficher comme `false` (« assistant manquant »), sinon un runtime non
 * LangGraph lèverait une alerte pour un défaut qui n'existe pas chez lui.
 */
export type ProvisioningState = 'provisioned' | 'bare-graph' | 'not-applicable'

export function provisioningState(
  runtimeProvisioned: boolean | null,
): ProvisioningState {
  if (runtimeProvisioned === true) return 'provisioned'
  if (runtimeProvisioned === false) return 'bare-graph'
  return 'not-applicable'
}

export const PROVISIONING_LABEL: Record<ProvisioningState, string> = {
  provisioned: 'assistant provisionné',
  'bare-graph': 'graphe nu',
  'not-applicable': 'non applicable',
}

export const PROVISIONING_MEANING: Record<ProvisioningState, string> = {
  provisioned:
    'Le runtime est LangGraph et un assistant_id est persisté : le run porte bien les outils, le prompt et le modèle du copilote.',
  'bare-graph':
    'Le runtime est LangGraph mais assistant_id est vide. Le run N’ÉCHOUE PAS : il s’exécute contre le graphe nu, hérite des outils génériques hérités, et répond « pas de données » avec zéro appel d’outil — en paraissant parfaitement sain.',
  'not-applicable':
    'La question ne s’applique pas ou n’a pas pu être lue : le runtime n’est pas LangGraph (rien n’y provisionne d’assistant, donc une absence n’est pas un défaut), ou la colonne runtime elle-même n’est pas résolue.',
}

/* ──────────────────────────── Nature d'un outil ──────────────────────── */

/**
 * La nature d'un outil, présentée FAIL-CLOSED.
 *
 * `mutates` du registre est déjà fail-closed en base (migration 0023 : un outil
 * dont le handler n'a pas été PROUVÉ en lecture seule reste `true`). L'écran ne
 * doit pas rattraper ça en douceur : un outil dont on ne sait pas s'il mute est
 * présenté comme mutant, avec le mot qui va avec.
 */
export function mutationLabel(mutates: boolean): string {
  return mutates ? 'mutant' : 'lecture seule'
}

export const MUTATION_MEANING = {
  mutating:
    'Cet outil écrit, envoie, publie ou dépense — ou bien son handler n’a pas été prouvé en lecture seule, ce qui se traite pareil. La classification est fail-closed : le doute compte comme mutation.',
  readOnly:
    'Le handler de cet outil a été PROUVÉ en lecture seule. Ce n’est pas une déduction sur son nom.',
} as const
