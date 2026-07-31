import 'server-only'

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
 * - `UNAVAILABLE` : aucune adresse configurée — on ne sait rien, et on le dit.
 * - `CONFIGURED`  : une adresse existe, mais la sonde n'a pas abouti.
 * - `RUNNING`     : le service a répondu.
 *
 * Il n'existe volontairement PAS de valeur « VERIFIED » ici : vérifier qu'un
 * outil fait son travail (une trace réellement reçue, un dashboard réellement
 * peuplé) demande une preuve métier que cette sonde ne produit pas. Prétendre
 * l'inverse depuis un simple 200 serait un faux vert.
 */
export type ToolStatus = 'RUNNING' | 'CONFIGURED' | 'UNAVAILABLE'

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
async function probe(url: string): Promise<{ ok: boolean; version: string | null; latencyMs: number; reason: string }> {
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
      version: res.headers.get('x-version') ?? null,
      latencyMs,
      reason: authWall
        ? `Réponse HTTP ${res.status} — le service répond mais refuse cet appel (authentification).`
        : `Réponse HTTP ${res.status}.`,
    }
  } catch (err) {
    return { ok: false, version: null, latencyMs: Date.now() - started, reason: safeReason(err) }
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
      status: 'UNAVAILABLE',
      url: null,
      version: null,
      detail: 'Aucune adresse configurée — cet outil n’a jamais été sondé.',
      latencyMs: null,
      checkedAt: null,
      remediation,
    }
  }

  const result = await probe(url)
  return {
    ...base,
    status: result.ok ? 'RUNNING' : 'CONFIGURED',
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
        purpose: 'Qualité, coûts et latence des appels LLM.',
      },
      envUrl('LANGFUSE_BASEURL') ?? envUrl('LANGFUSE_HOST'),
      'Renseigner LANGFUSE_BASEURL vers une instance Langfuse joignable.',
    ),
    fromUrl(
      {
        id: 'grafana',
        name: 'Grafana',
        purpose: 'Santé de l’infrastructure : serveurs et GPU.',
      },
      envUrl('GRAFANA_URL'),
      'Renseigner GRAFANA_URL vers une instance Grafana joignable.',
    ),
    fromUrl(
      {
        id: 'n8n',
        name: 'n8n',
        purpose: 'Intégrations périphériques uniquement — notifications, synchronisations. Jamais un runtime d’agent.',
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
  const studio: ToolProbe = {
    id: 'langsmith-studio',
    name: 'LangSmith Studio',
    purpose: 'Inspecte visuellement les exécutions du graphe, pas à pas.',
    status: langgraph?.status === 'RUNNING' ? 'CONFIGURED' : 'UNAVAILABLE',
    url:
      langgraphUrl && langgraph?.status === 'RUNNING'
        ? `https://smith.langchain.com/studio/thread?baseUrl=${encodeURIComponent(langgraphUrl)}`
        : null,
    version: null,
    detail:
      langgraph?.status === 'RUNNING'
        ? 'L’Agent Server local répond ; le lien Studio est donc ouvrable. Que Studio affiche réellement le graphe n’est PAS vérifié ici — cela dépend d’une session LangSmith côté navigateur.'
        : 'Studio se branche sur l’Agent Server local, qui ne répond pas. Aucun lien n’est proposé.',
    latencyMs: null,
    checkedAt: langgraph?.checkedAt ?? null,
    remediation:
      langgraph?.status === 'RUNNING'
        ? 'Ouvrir le lien dans un navigateur connecté à LangSmith pour confirmer l’affichage du graphe.'
        : 'Démarrer l’Agent Server local (port 2024).',
  }

  // Obsidian n'est PAS sondable : c'est une application de bureau locale, sans
  // port HTTP. Prétendre la sonder produirait un état inventé. On déclare donc
  // explicitement qu'elle n'est pas mesurable depuis le serveur.
  const obsidian: ToolProbe = {
    id: 'obsidian',
    name: 'Obsidian',
    purpose: 'Workspace humain éditable — notes, Canvas et Bases du vault Aigent.',
    status: 'UNAVAILABLE',
    url: null,
    version: null,
    detail:
      'Application de bureau : aucun port HTTP à sonder. Son état ne peut pas être mesuré depuis le serveur.',
    latencyMs: null,
    checkedAt: null,
    remediation: 'Vérification manuelle sur le poste — voir docs/visual-reviews/AIGENT-VISUAL-STACK-001.',
  }

  // Ordre de lecture : le runtime produit d'abord, puis son inspecteur, puis
  // les périphériques, puis ce qui n'est pas mesurable depuis le serveur.
  const langgraphFirst = tools.filter((t) => t.id === 'langgraph')
  const peripherals = tools.filter((t) => t.id !== 'langgraph')
  const all = [...langgraphFirst, studio, ...peripherals, obsidian]

  return {
    tools: all,
    runningCount: all.filter((t) => t.status === 'RUNNING').length,
    probedAt: new Date().toISOString(),
  }
}
