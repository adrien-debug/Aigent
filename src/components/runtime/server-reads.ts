/**
 * Lectures serveur de la surface Runtime — un onglet, une fonction.
 *
 * RSC DIRECT, jamais `/api/**`. Une route API rajouterait un aller-retour HTTP,
 * une seconde frontière d'auth et une seconde occasion de diverger du contrat.
 * Ce module est le SEUL de la surface à importer du `server-only` ; les écrans
 * reçoivent des objets déjà lus.
 *
 * DEUX PRINCIPES, TENUS PARTOUT ICI
 * ---------------------------------
 * 1. Chaque lecture est enveloppée dans `load`, qui conserve l'échec. Une lecture
 *    échouée ne devient jamais `[]` : sur une surface qui décrit précisément ce
 *    qui est câblé ou non, confondre « je n'ai pas pu lire » avec « il n'y a
 *    rien » produirait exactement le diagnostic inverse du vrai.
 * 2. Les panneaux sont lus en parallèle mais échouent INDÉPENDAMMENT. Un Agent
 *    Server éteint ne doit pas noircir l'onglet Télémétrie, qui lit Postgres.
 *
 * AUCUNE ÉCRITURE. Aucun run, aucun provisioning, aucun appel LLM. Les seules
 * fonctions appelées ici lisent ou sont pures — en particulier, de
 * `langgraph-assistants` on n'importe RIEN : tous ses exports utiles créent ou
 * suppriment un assistant sur l'Agent Server.
 */
import 'server-only'

import { resolveVisualizationsFor } from '@/components/visualizations/embed/registry'
import type { ResolvedVisualization } from '@/components/visualizations/embed/contract'

import { getAvailableAgents, type AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { getProjects } from '@/lib/agent-mission-control/data'
import { listRepos, type GithubRepoSummary } from '@/lib/agent-mission-control/github'
import { agentServerUrl, AGENT_BUILDER_GRAPH_ID } from '@/lib/agent-mission-control/langgraph-client'
import {
  getGraphTopology,
  listAssistants,
  listThreads,
  type ExplorerAssistant,
  type ExplorerThread,
  type GraphTopology,
} from '@/lib/agent-mission-control/langgraph-explorer'
import { LOCAL_VLLM_MODEL_IDS } from '@/lib/agent-mission-control/model-catalog'
import { LOCAL_VLLM_ENDPOINTS } from '@/lib/agent-mission-control/model-local'
import { providerAvailable } from '@/lib/agent-mission-control/model-router'
import {
  listRecentRuntimeTelemetryEvents,
  summarizeFleetRuntimeTelemetry,
  type RuntimeTelemetryEvent,
  type RuntimeTelemetryFleetSummary,
} from '@/lib/agent-mission-control/runtime-telemetry-store'
import { diagnoseTelemetryHealth, type TelemetryHealthDiagnostic } from '@/lib/agent-mission-control/telemetry-health'
import type { Project } from '@/lib/agent-mission-control/types'
import { load, loadSync, type Loaded, type ProviderWiring } from './model'

/* ───────────────────────────── Télémétrie ───────────────────────────── */

/** Au-delà de ce silence, la boucle de retour est considérée muette. */
const MUTE_THRESHOLD_DAYS = 7

/** Combien d'événements récents la table affiche. */
const RECENT_EVENTS_LIMIT = 50

export interface TelemetryTabData {
  fleet: Loaded<RuntimeTelemetryFleetSummary>
  events: Loaded<RuntimeTelemetryEvent[]>
  /**
   * Les panneaux Grafana du canal, deja resolus cote serveur.
   *
   * MEME SOURCE, DEUX LECTURES. Ces panneaux tracent exactement la table que
   * cet onglet resume en chiffres — `runtime_telemetry_events`. Les mettre ici
   * n'ajoute donc aucune donnee : ils donnent la FORME de ce que les `Fact`
   * donnent en valeur. C'est la seule raison de leur presence, et c'est aussi
   * pourquoi ils ne vont pas ailleurs dans Runtime : les autres onglets
   * (outils, providers, modeles) ne parlent pas de cette table.
   */
  visualizations: readonly ResolvedVisualization[]
  /**
   * Le diagnostic de santé du canal.
   *
   * `diagnoseTelemetryHealth` est PUR : c'est nous qui lui fournissons les
   * faits, y compris `lastEventLookupFailed`. C'est ce qui lui permet de rendre
   * `unavailable` — « je ne sais pas » — au lieu d'un `loop_muted` fabriqué à
   * partir d'une lecture qui a échoué.
   */
  health: TelemetryHealthDiagnostic
}

export async function readTelemetryTab(): Promise<TelemetryTabData> {
  const [fleet, events, visualizations] = await Promise.all([
    load(() => summarizeFleetRuntimeTelemetry()),
    load(() => listRecentRuntimeTelemetryEvents(RECENT_EVENTS_LIMIT)),
    // Accessoires : l'echec du RESOLVEUR ne doit pas emporter l'onglet. Une
    // source Grafana muette, elle, se dit d'elle-meme dans son cadre.
    resolveVisualizationsFor('activity', 'reliability').catch(
      () => [] as ResolvedVisualization[],
    ),
  ])

  const health = diagnoseTelemetryHealth({
    // Présence du jeton d'ingestion — jamais sa VALEUR, ni ici ni plus loin.
    ingestionTokenConfigured: Boolean(process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN),
    // `null` DÉLIBÉRÉMENT, et pas `fleet.data.reportingAgents`.
    //
    // Ce champ attend le nombre d'agents dont le MANIFESTE DÉCLARE la
    // télémétrie (niveau 1). `reportingAgents` est le nombre d'agents
    // OBSERVÉS dans la fenêtre d'événements — une population différente.
    // Les substituer produisait deux mensonges :
    //   · un compte à 0 faisait afficher « zéro agent déclare la télémétrie
    //     dans son manifeste », affirmation jamais mesurée ;
    //   · `loop_muted` devenait INATTEIGNABLE — il exige `déclaré > 0` ET
    //     (jamais reçu OU périmé), or « déclaré > 0 » valait alors « reçu
    //     récemment ». Le seul statut qui dit « la boucle d'amélioration
    //     s'est tue » ne pouvait donc jamais s'afficher, sur l'écran fait
    //     pour le lever.
    //
    // Aucun loader ne rend aujourd'hui le compte déclaré. `null` fait
    // basculer le diagnostic sur `unavailable`, qui est la réponse vraie :
    // on ne peut pas le dire. Le compte OBSERVÉ reste affiché à côté, sous
    // son vrai nom.
    agentsWithTelemetryDeclared: null,
    lastEventReceivedAt: fleet.ok ? fleet.data.lastSeenAt : null,
    lastEventLookupFailed: !fleet.ok,
    now: new Date().toISOString(),
    muteThresholdDays: MUTE_THRESHOLD_DAYS,
  })

  return { fleet, events, health, visualizations }
}

/* ───────────────────────────── LangGraph ────────────────────────────── */

export interface LangGraphTabData {
  /**
   * L'endpoint CONFIGURÉ, tel que le résolveur le calcule.
   *
   * `resolveAgentServerUrl` LÈVE pour un endpoint distant hors production et
   * pour un endpoint local en production. Cette levée est un état à AFFICHER,
   * pas une erreur à avaler : elle décrit une configuration refusée, ce qui est
   * une information de premier ordre sur cette surface.
   */
  endpoint: Loaded<string>
  /** La présence du secret de service — jamais sa valeur. */
  secretConfigured: boolean
  /**
   * L'accessibilité de l'Agent Server, DÉDUITE d'une lecture réelle.
   *
   * Il n'existe aucune fonction de ping dans le lib : la seule preuve honnête
   * qu'un serveur répond est une lecture qui a abouti. `assistants` porte donc
   * double sens — la liste, et le fait que le serveur est joignable.
   */
  assistants: Loaded<ExplorerAssistant[]>
  threads: Loaded<ExplorerThread[]>
  topology: Loaded<GraphTopology>
  graphId: string
  /**
   * Le roster, pour croiser les assistants du serveur avec ce que la base
   * prétend avoir provisionné. C'est là que le piège du graphe nu se voit.
   */
  agents: Loaded<AvailableAgent[]>
}

export async function readLangGraphTab(): Promise<LangGraphTabData> {
  const endpoint = loadSync(() => agentServerUrl())

  // Si l'endpoint lui-même est refusé, aucune lecture distante n'a de sens :
  // on ne tente pas six appels condamnés pour afficher six fois la même cause.
  if (!endpoint.ok) {
    const unreachable: Loaded<never> = { ok: false, reason: endpoint.reason }
    return {
      endpoint,
      secretConfigured: Boolean(process.env.LANGGRAPH_SERVER_SECRET?.trim()),
      assistants: unreachable,
      threads: unreachable,
      topology: unreachable,
      graphId: AGENT_BUILDER_GRAPH_ID,
      agents: await load(() => getAvailableAgents()),
    }
  }

  const [assistants, threads, topology, agents] = await Promise.all([
    load(() => listAssistants()),
    load(() => listThreads()),
    load(() => getGraphTopology(AGENT_BUILDER_GRAPH_ID)),
    load(() => getAvailableAgents()),
  ])

  return {
    endpoint,
    secretConfigured: Boolean(process.env.LANGGRAPH_SERVER_SECRET?.trim()),
    assistants,
    threads,
    topology,
    graphId: AGENT_BUILDER_GRAPH_ID,
    agents,
  }
}

/* ─────────────────────────────── Outils ─────────────────────────────── */

export interface ToolsTabData {
  /**
   * Le roster, pour dire quels outils sont réellement MONTÉS et lesquels ne
   * résolvent vers aucun handler. Le registre dit ce qui existe ; seul le roster
   * dit ce qui est utilisé.
   */
  agents: Loaded<AvailableAgent[]>
}

export async function readToolsTab(): Promise<ToolsTabData> {
  return { agents: await load(() => getAvailableAgents()) }
}

/* ────────────────────────────── Providers ───────────────────────────── */

export interface ProviderRow {
  id: string
  label: string
  wiring: ProviderWiring
  /** Ce que le provider sait faire dans CE repo, pas dans l'absolu. */
  note: string
  /** Les variables consultées, par NOM. Jamais une valeur. */
  envVars: readonly string[]
  toolUse: boolean
}

export interface ProvidersTabData {
  providers: ProviderRow[]
  agents: Loaded<AvailableAgent[]>
}

/**
 * Les quatre providers que ce repo nomme — dont un qui n'a pas de code.
 *
 * `mistral` N'EST PAS un membre du type `ModelProvider` : il n'a ni chemin
 * d'appel, ni ligne de tarification, ni entrée de registre. Il figure ici
 * précisément parce qu'il est nommé ailleurs dans le produit et qu'un écran qui
 * l'omettrait laisserait croire qu'il n'a jamais été envisagé. Il est présenté
 * `not-wired` : aucune variable d'environnement ne l'activera, un appel lève une
 * erreur typée, et il n'y a jamais de repli silencieux vers un autre provider.
 */
export function readProviders(): ProviderRow[] {
  // `providerAvailable` est une lecture d'environnement pure : aucun réseau,
  // aucun appel LLM. Le second argument n'est consulté que pour `local`.
  const openai = providerAvailable('openai', '')
  const google = providerAvailable('google', '')
  // Le parc local est disponible dès qu'AU MOINS un de ses endpoints est câblé —
  // c'est bien un opt-in partiel, pas un tout-ou-rien.
  const localConfigured = LOCAL_VLLM_MODEL_IDS.filter((id) => providerAvailable('local', id))

  return [
    {
      id: 'openai',
      label: 'OpenAI',
      wiring: openai ? 'wired' : 'wired-unconfigured',
      note: 'SDK officiel, tool-use complet. Chemin de référence des deux voies d’exécution.',
      envVars: ['OPENAI_API_KEY'],
      toolUse: true,
    },
    {
      id: 'google',
      label: 'Google — Gemini',
      wiring: google ? 'wired' : 'wired-unconfigured',
      note: 'REST v1beta. Le tool-use EST câblé : functionDeclarations, functionCallingConfig, et les réponses d’outil repartent en functionResponse.',
      envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      toolUse: true,
    },
    {
      id: 'local',
      label: 'Local — parc vLLM',
      // Opt-in, TOUJOURS. Même tous endpoints câblés, ce provider n'est pas
      // « disponible » au même sens que les deux précédents : il exige une
      // activation explicite et un parc allumé. On ne le promeut pas en `wired`.
      wiring: 'opt-in',
      note:
        localConfigured.length > 0
          ? `Client OpenAI-compatible. ${localConfigured.length} endpoint(s) sur ${LOCAL_VLLM_MODEL_IDS.length} configuré(s) dans cet environnement. Hôte injoignable ⇒ ProviderUnavailableError, jamais un repli muet.`
          : `Client OpenAI-compatible. Aucun des ${LOCAL_VLLM_MODEL_IDS.length} endpoints n’est configuré ici — ce qui est l’état normal d’un poste hors du parc, pas une panne.`,
      envVars: ['VLLM_LOCAL_API_KEY', ...LOCAL_VLLM_MODEL_IDS.map((id) => LOCAL_VLLM_ENDPOINTS[id].urlEnvVar)],
      toolUse: true,
    },
    {
      id: 'mistral',
      label: 'Mistral',
      wiring: 'not-wired',
      note: 'Aucun chemin d’appel n’existe. Un appel lève une erreur typée — jamais un repli silencieux vers un autre provider. Aucune clé ne l’activera : il faudrait du code.',
      envVars: [],
      toolUse: false,
    },
  ]
}

export async function readProvidersTab(): Promise<ProvidersTabData> {
  return { providers: readProviders(), agents: await load(() => getAvailableAgents()) }
}

/* ─────────────────────────────── Modèles ────────────────────────────── */

export interface LocalModelRow {
  id: string
  description: string
  contextTokens: number
  urlEnvVar: string
  modelEnvVar: string
  /** L'endpoint est-il câblé ICI ? Lecture d'env pure, aucun réseau. */
  configured: boolean
}

export interface ModelsTabData {
  local: LocalModelRow[]
  /**
   * Les modèles réellement CONFIGURÉS sur les agents du catalogue.
   *
   * Il n'existe aucun catalogue exporté de modèles OpenAI/Google dans ce repo :
   * les identifiants ne vivent que dans la table de tarification, qui n'est pas
   * exportée. Plutôt que de recopier une liste qui dériverait en silence, cet
   * onglet montre ce qui est OBSERVÉ — les modèles que les agents déclarent et
   * ceux que les runs ont prouvés.
   */
  agents: Loaded<AvailableAgent[]>
}

export async function readModelsTab(): Promise<ModelsTabData> {
  const local: LocalModelRow[] = LOCAL_VLLM_MODEL_IDS.map((id) => {
    const spec = LOCAL_VLLM_ENDPOINTS[id]
    return {
      id,
      description: spec.description,
      contextTokens: spec.contextTokens,
      urlEnvVar: spec.urlEnvVar,
      modelEnvVar: spec.modelEnvVar,
      // `providerAvailable('local', id)` ne fait qu'une lecture d'environnement.
      // Il ne prouve PAS que l'hôte répond — seulement qu'il est déclaré.
      configured: providerAvailable('local', id),
    }
  })

  return { local, agents: await load(() => getAvailableAgents()) }
}

/* ─────────────────────────────── Dépôts ─────────────────────────────── */

export interface RepositoriesTabData {
  projects: Loaded<Project[]>
  /**
   * Les dépôts visibles par le jeton GitHub configuré.
   *
   * Sert à répondre à la seule question honnête que cette surface peut poser sur
   * un dépôt sans le cloner : est-il LISIBLE ? Un dépôt qu'un projet référence
   * mais qui n'apparaît pas ici n'est pas un dépôt vide — c'est un dépôt qu'on
   * ne voit pas, ce qui est un fait différent et souvent une question de droits.
   */
  repos: Loaded<GithubRepoSummary[]>
}

export async function readRepositoriesTab(): Promise<RepositoriesTabData> {
  const [projects, repos] = await Promise.all([
    load(() => getProjects()),
    load(() => listRepos()),
  ])
  return { projects, repos }
}
