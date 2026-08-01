import 'server-only'

import appPackage from '../../../package.json'

/**
 * Visual Tooling — l'état RÉEL des outils visuels périphériques d'Aigent.
 *
 * CE MODULE NE MENT PAS SUR CE QU'IL IGNORE. Un outil non configuré est
 * `UNAVAILABLE`, jamais « éteint » : la différence entre « je sais qu'il est
 * down » et « je n'ai jamais eu d'adresse à sonder » est exactement ce que cet
 * écran existe pour dire. Une sonde qui échoue conserve sa raison ; elle ne
 * dégénère pas en booléen faux.
 *
 * SERVER-ONLY, ET AUCUNE VALEUR DE SECRET NE SORT. On ne lit des variables
 * d'environnement que pour leur PRÉSENCE (`Boolean(...)`) et pour des URL de
 * base non secrètes. Aucun jeton n'est renvoyé au client, ni en clair, ni
 * tronqué, ni dans un message d'erreur — les messages sont normalisés avant de
 * quitter ce module.
 *
 * FAIL-CLOSED ET BORNÉ. Chaque sonde a un timeout court et ne suit pas les
 * redirections ; une sonde lente ne peut pas retenir le rendu de la page. Aucune
 * sonde n'écrit, n'authentifie ni ne déclenche quoi que ce soit à distance : ce
 * sont des GET/HEAD sur des racines locales.
 */

/**
 * L'échelle d'état, du plus faible au plus fort.
 *
 * - `UNAVAILABLE` : rien de configuré — on ne sait rien, et on le dit.
 * - `INSTALLED`   : le code/l'artefact est présent dans le produit, mais rien
 *                   n'a été contacté (cas d'un composant embarqué, pas d'un
 *                   service).
 * - `CONFIGURED`  : une adresse existe, mais la sonde n'a pas abouti.
 * - `RUNNING`     : le service a répondu.
 * - `CONNECTED`   : le service a répondu ET a accepté notre appel (pas de mur
 *                   d'authentification). Un 401 reste donc `RUNNING`.
 * - `VERIFIED`    : le service fait DÉMONTRABLEMENT son travail.
 *
 * `VERIFIED` n'est jamais atteint par une sonde HTTP : un 200 prouve qu'un
 * service répond, pas qu'il a reçu une trace ou peuplé un dashboard. Il est
 * réservé aux outils dont la preuve est produite ici même, dans la page — voir
 * `canvas-aigent`, dont le rendu EST la démonstration.
 */
export type ToolStatus =
  | 'VERIFIED'
  | 'CONNECTED'
  | 'RUNNING'
  | 'CONFIGURED'
  | 'INSTALLED'
  | 'NOT_CONFIGURED'
  | 'UNAVAILABLE'
  | 'ERROR'

export interface ToolProbe {
  /** Identifiant stable, utilisé comme clé de rendu et dans les tests. */
  id: string
  name: string
  /** Ce que l'outil fait, en français, pour un lecteur non technique. */
  purpose: string
  status: ToolStatus
  /** URL d'ouverture — jamais un secret, jamais une URL portant un jeton. */
  url: string | null
  /** Version rapportée par le service, `null` si non publiée. */
  version: string | null
  /** Raison lisible de l'échec ou de l'absence. Jamais un secret. */
  detail: string
  /** Latence de la sonde en ms, `null` si aucune sonde n'a été lancée. */
  latencyMs: number | null
  /** Horodatage ISO de la sonde, `null` si non sondé. */
  checkedAt: string | null
  /** Ce qu'il faut faire pour rendre l'outil disponible, si applicable. */
  remediation: string | null
}

/** Au-delà, on considère le service non joignable. Court, exprès. */
const PROBE_TIMEOUT_MS = 1_500

/**
 * La version d'XYFlow, lue dans le `package.json` du produit.
 *
 * Recopier « 12.11.2 » en dur en ferait une chaîne à maintenir à la main, qui
 * mentirait au premier `npm update`. La dépendance est épinglée à l'exact, donc
 * la valeur déclarée EST la version installée. Si le champ disparaît, la version
 * reste `null` — jamais une valeur inventée.
 */
const XYFLOW_VERSION: string | null =
  typeof appPackage.dependencies?.['@xyflow/react'] === 'string'
    ? appPackage.dependencies['@xyflow/react']
    : null

/**
 * Normalise une erreur de sonde en message SÛR.
 *
 * Un `err.message` brut peut transporter une URL complète — donc potentiellement
 * un jeton en query string. On ne renvoie donc jamais le message d'origine :
 * seulement une catégorie.
 */
function safeReason(err: unknown): string {
  if (err instanceof Error && err.name === 'TimeoutError') return 'Aucune réponse avant expiration du délai.'
  if (err instanceof Error && err.name === 'AbortError') return 'Sonde interrompue.'
  return 'Service injoignable à cette adresse.'
}

/**
 * Sonde HTTP bornée. Ne suit aucune redirection et ne lit qu'un en-tête de
 * version quand le service en publie un.
 */
async function probe(url: string): Promise<{
  ok: boolean
  /** Le service a répondu ET accepté l'appel — pas de mur d'authentification. */
  accepted: boolean
  version: string | null
  latencyMs: number
  reason: string
}> {
  const started = Date.now()
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    })
    const latencyMs = Date.now() - started
    // Un 3xx d'un service local qui redirige vers son écran de login compte
    // comme « il répond » : le service tourne, c'est tout ce qu'on affirme.
    const ok = res.status > 0 && res.status < 500
    // 401/403 méritent d'être DITS : le service est là mais nous refuse. Le
    // masquer derrière un « a répondu » nu ferait chercher une panne côté
    // service alors que le problème est un credential.
    const authWall = res.status === 401 || res.status === 403
    return {
      ok,
      accepted: ok && !authWall,
      version: res.headers.get('x-version') ?? null,
      latencyMs,
      reason: authWall
        ? `Réponse HTTP ${res.status} — le service répond mais refuse cet appel (authentification).`
        : `Réponse HTTP ${res.status}.`,
    }
  } catch (err) {
    return {
      ok: false,
      accepted: false,
      version: null,
      latencyMs: Date.now() - started,
      reason: safeReason(err),
    }
  }
}

/** Construit l'état d'un outil sondable à partir d'une URL éventuelle. */
async function fromUrl(
  base: Omit<ToolProbe, 'status' | 'url' | 'version' | 'detail' | 'latencyMs' | 'checkedAt' | 'remediation'>,
  url: string | null,
  remediation: string,
): Promise<ToolProbe> {
  if (!url) {
    return {
      ...base,
      status: 'NOT_CONFIGURED',
      url: null,
      version: null,
      detail: 'Aucune adresse configurée — cet outil n’a jamais été sondé.',
      latencyMs: null,
      checkedAt: null,
      remediation,
    }
  }

  const result = await probe(url)
  // `CONNECTED` exige que l'appel ait été ACCEPTÉ. Un 401 s'arrête à
  // `RUNNING` : le service est bien là, mais nous n'avons rien pu en lire.
  // Adresse connue mais service muet : c'est une ERREUR constatée, pas une
  // simple « configuration ». La distinction compte pour l'opérateur — il sait
  // qu'il doit aller regarder, pas renseigner une variable.
  let status: ToolStatus = 'ERROR'
  if (result.accepted) status = 'CONNECTED'
  else if (result.ok) status = 'RUNNING'

  return {
    ...base,
    status,
    url,
    version: result.version,
    detail: result.reason,
    latencyMs: result.latencyMs,
    checkedAt: new Date().toISOString(),
    remediation: result.ok ? null : remediation,
  }
}

/**
 * Résout une URL de service depuis l'environnement.
 *
 * Retourne `null` — donc `UNAVAILABLE` — plutôt qu'un défaut fabriqué : une
 * adresse par défaut inventée produirait une sonde qui échoue et un
 * `CONFIGURED` mensonger sur un outil que personne n'a jamais installé.
 */
function envUrl(name: string): string | null {
  const raw = process.env[name]?.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    // On ne renvoie JAMAIS l'URL brute : on la reconstruit sans identifiants ni
    // query, pour qu'aucun jeton présent dans la variable ne parte au client.
    return `${parsed.protocol}//${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
  } catch {
    return null
  }
}

export interface VisualToolingData {
  tools: ToolProbe[]
  /** Nombre d'outils réellement joignables — dérivé, jamais saisi. */
  runningCount: number
  probedAt: string
}

/**
 * Lit l'état de tous les outils visuels. Les sondes sont PARALLÈLES et
 * INDÉPENDANTES : un Langfuse absent n'assombrit pas la ligne LangGraph.
 */
export async function readVisualTooling(): Promise<VisualToolingData> {
  const langgraphUrl = envUrl('LANGGRAPH_API_URL')

  const tools = await Promise.all([
    fromUrl(
      {
        id: 'langgraph',
        name: 'LangGraph Agent Server',
        purpose: 'Exécute les graphes d’agents. C’est le seul runtime produit d’Aigent.',
      },
      langgraphUrl,
      'Démarrer l’Agent Server local (port 2024) et renseigner LANGGRAPH_API_URL.',
    ),
    fromUrl(
      {
        id: 'langfuse',
        name: 'Langfuse',
        // « Coûts » retiré : le chemin tracé porte les étapes, statuts et
        // durées d'un run. Un coût n'apparaît que si un appel facturé a lieu —
        // le smoke de cette mission n'en produit aucun.
        purpose: 'Traces d’exécution des agents : étapes, statuts, durées et métadonnées de run.',
      },
      envUrl('LANGFUSE_BASEURL') ?? envUrl('LANGFUSE_HOST'),
      'Renseigner LANGFUSE_BASEURL vers une instance Langfuse joignable.',
    ),
    fromUrl(
      {
        id: 'grafana',
        name: 'Grafana',
        // Le dashboard livré (`aigent-runs`) mesure des RUNS D'AGENTS, pas des
        // machines : ni CPU, ni mémoire, ni GPU n'y figurent. Décrire Grafana
        // comme une surface d'infrastructure enverrait l'opérateur y chercher
        // ce qui n'y est pas.
        purpose:
          'Dashboard des runs d’agents : volume, états terminaux, taux de succès et latences, depuis runtime_telemetry_events.',
      },
      envUrl('GRAFANA_URL'),
      'Renseigner GRAFANA_URL vers une instance Grafana joignable.',
    ),
    fromUrl(
      {
        id: 'n8n',
        name: 'n8n',
        // Le workflow livré lit `/api/agent-ops/metrics` et rend un verdict de
        // flotte. La mention « jamais un runtime d'agent » reste vraie et
        // structurante : n8n orchestre autour d'Aigent, il n'exécute pas
        // d'agent.
        purpose:
          'Automatisations autour d’Aigent — veille de santé de flotte sur les métriques réelles. Jamais un runtime d’agent.',
      },
      envUrl('N8N_URL'),
      'Renseigner N8N_URL vers une instance n8n joignable.',
    ),
  ])

  /*
   * LangSmith Studio — état DÉRIVÉ, jamais sondé.
   *
   * Studio est une surface hébergée (`smith.langchain.com`) qui se branche sur
   * l'Agent Server LOCAL. Sonder le site hébergé donnerait un 200 permanent qui
   * ne prouve rien : le site répond même quand le serveur local est éteint, et
   * afficher « RUNNING » sur cette base serait un faux vert. Le seul fait
   * honnête est donc l'état du serveur que Studio inspecte.
   */
  const langgraph = tools.find((t) => t.id === 'langgraph')
  const langgraphReached =
    langgraph?.status === 'CONNECTED' || langgraph?.status === 'RUNNING'
  const studio: ToolProbe = {
    id: 'langsmith-studio',
    name: 'LangSmith Studio',
    purpose: 'Inspecte visuellement les exécutions du graphe, pas à pas.',
    /*
     * CONNECTED, PAS VERIFIED — mais pour une raison PLUS ÉTROITE qu'avant.
     *
     * Constaté le 2026-08-01, capture à l'appui
     * (docs/visual-reviews/AIGENT-VISUAL-STACK-002/langsmith-graph.png) :
     * Studio AFFICHE bien le graphe `agent_builder` — les cinq nœuds
     * `__start__ / agent / approval / tools / __end__`, leurs arêtes, les
     * schémas d'entrée — et se déclare « Connected » contre le serveur local.
     * L'hypothèse d'un mur de connexion bloquant était FAUSSE.
     *
     * Ce qui empêche encore `VERIFIED` : le tracing in-Studio est indisponible.
     * Studio réclame `langgraph-api >= 0.11.0` quand notre serveur rapporte
     * 1.4.2 (schémas de version différents), et aucun run n'a été soumis —
     * ç'aurait été un appel LLM facturé. Studio sait donc LIRE le graphe ; il
     * n'a pas été prouvé qu'il en OBSERVE une exécution.
     */
    status: langgraphReached ? 'CONNECTED' : 'UNAVAILABLE',
    url:
      langgraphUrl && langgraphReached
        ? `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(langgraphUrl)}`
        : null,
    version: null,
    detail: langgraphReached
      ? 'Studio rend le graphe `agent_builder` (5 nœuds, 6 arêtes) et se déclare « Connected » — vérifié par capture. Le tracing in-Studio reste indisponible : Studio réclame langgraph-api ≥ 0.11.0 quand le serveur rapporte 1.4.2. Aucune exécution n’a été observée, donc pas de `VERIFIED`.'
      : 'Studio se branche sur l’Agent Server local, qui ne répond pas. Aucun lien n’est proposé.',
    latencyMs: null,
    checkedAt: langgraph?.checkedAt ?? null,
    remediation: langgraphReached
      ? 'Le graphe s’ouvre déjà. Pour le tracing in-Studio : aligner la version de langgraph-api — voir docs/langsmith-studio.md.'
      : 'Démarrer l’Agent Server local (port 2024).',
  }

  /*
   * Canvas Aigent — le seul outil dont l'état est DÉMONTRABLE ici.
   *
   * Ce n'est pas un service : c'est une surface de ce produit, rendue par cette
   * application. On ne le sonde donc pas — on constate qu'il est embarqué. Son
   * état est `VERIFIED` uniquement parce que la preuve est produite dans la même
   * page : l'onglet LangGraph rend le graphe réel de l'Agent Server, et le
   * harnais de capture ÉCHOUE si le Canvas ou ses nœuds sont absents. C'est la
   * seule occurrence de `VERIFIED` dans cette console, et elle repose sur un
   * test qui casse — pas sur une déclaration.
   */
  const canvas: ToolProbe = {
    id: 'canvas-aigent',
    name: 'Canvas Aigent',
    purpose:
      'Représente visuellement la topologie du graphe LangGraph : nœuds, arêtes, inspecteur. Surface embarquée dans Aigent.',
    status: 'VERIFIED',
    url: '/runtime?tab=langgraph',
    version: XYFLOW_VERSION,
    detail:
      'Surface embarquée : aucun service à sonder. Le rendu du graphe réel est vérifié par le harnais de capture, qui échoue si le Canvas ou ses nœuds manquent.',
    latencyMs: null,
    checkedAt: null,
    remediation: null,
  }

  /*
   * Obsidian — INSTALLED, pas sondable, et surtout pas `VERIFIED`.
   *
   * C'est une application de bureau sans port HTTP : aucune sonde serveur ne
   * peut dire si elle tourne. Ce qui EST vérifiable depuis ici, c'est
   * l'artefact que le serveur possède — le vault versionné du repository, dont
   * la structure est validée par `npm run check:vault` (arêtes de Canvas
   * résolues, liens internes résolus, aucun secret). On déclare donc ce qu'on
   * sait — le vault existe et tient debout — sans prétendre savoir si
   * l'application est ouverte sur le poste d'Adrien.
   */
  const obsidian: ToolProbe = {
    id: 'obsidian',
    name: 'Obsidian',
    purpose: 'Workspace humain éditable — notes, Canvas et Base du vault Aigent.',
    status: 'INSTALLED',
    url: null,
    version: null,
    detail:
      'Vault versionné dans `vault/` : 2 Canvas, 1 Base, 7 modèles, notes d’agents alimentées par la télémétrie réelle. Structure validée par `npm run check:vault`. L’application de bureau n’a aucun port HTTP : son exécution ne peut pas être mesurée depuis le serveur.',
    latencyMs: null,
    checkedAt: null,
    remediation: 'Obsidian → Ouvrir un dossier comme coffre → `vault/`.',
  }

  // Ordre de lecture : le runtime produit d'abord, puis son inspecteur, puis
  // les périphériques, puis ce qui n'est pas mesurable depuis le serveur.
  const langgraphFirst = tools.filter((t) => t.id === 'langgraph')
  const peripherals = tools.filter((t) => t.id !== 'langgraph')
  const all = [...langgraphFirst, canvas, studio, ...peripherals, obsidian]

  // « Joignable » = le service a répondu, quel que soit le niveau atteint
  // ensuite. `CONFIGURED` (adresse connue, silence) n'en fait pas partie.
  const REACHED: readonly ToolStatus[] = ['VERIFIED', 'CONNECTED', 'RUNNING']

  return {
    tools: all,
    runningCount: all.filter((t) => REACHED.includes(t.status)).length,
    probedAt: new Date().toISOString(),
  }
}
