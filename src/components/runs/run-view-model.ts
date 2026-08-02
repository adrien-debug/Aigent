/**
 * Dérivations PURES de la surface « Runs » — aucune I/O, aucun JSX.
 *
 * Tout ce que l'écran affiche et qui n'est pas déjà un champ brut du contrat
 * passe par ici, pour deux raisons :
 *
 *  1. **Testabilité.** Une règle de vérité écrite dans un composant n'est
 *     vérifiable qu'en rendant l'arbre ; écrite ici, elle est vérifiable par un
 *     test unitaire. Les tests vivent dans `tests/unit/runs-surface/`.
 *  2. **Une seule dérivation.** La liste, le panneau de détail et le bandeau de
 *     provenance lisent les MÊMES fonctions. Il n'existe pas de second endroit
 *     où l'on décide qu'un champ est absent.
 *
 * RÈGLE CARDINALE DE CE FICHIER — l'absence n'est jamais une valeur.
 * Aucune fonction ici ne renvoie `0`, `''` ou `[]` pour dire « pas mesuré ».
 * Elle renvoie `null`, et c'est le composant qui rend l'absence explicitement
 * (`Unavailable` / `AbsentMark`). Un `?? 0` posé dans ce fichier serait
 * exactement le mensonge que `check:render-truth` traque ailleurs.
 *
 * Ce module ne réimplémente RIEN de `src/lib/runs-console/` : `deriveRunsMetrics`,
 * `applyRunsFilters`, `formatDuration` et `formatUsd` restent les propriétaires
 * de leurs calculs. On ne fait ici que ce qu'ils ne font pas.
 */
import { classifyRuntimeTelemetryProvenance } from '@/lib/agent-mission-control/runtime-telemetry-provenance'
import type { RuntimeTelemetryProvenance } from '@/lib/agent-mission-control/runtime-telemetry-provenance'
import type { RuntimeTelemetryEvent } from '@/lib/agent-mission-control/runtime-telemetry-store'
import type { AgentRun } from '@/lib/agent-mission-control/types'

/* ─────────────────────── Sélection / deep link ─────────────────────── */

/**
 * Le run désigné par l'URL, ou le premier de la liste.
 *
 * Trois cas, distingués exprès — un écran qui les confond fait passer un
 * mauvais lien pour une liste vide :
 *  · liste vide            → `null` (rien à sélectionner) ;
 *  · `runId` absent/vide   → premier run (l'écran s'ouvre sur quelque chose) ;
 *  · `runId` fourni mais introuvable dans la fenêtre → `null` + `notFound`.
 *
 * Le troisième cas est la raison d'être de cette fonction. Retomber
 * silencieusement sur le premier run quand le lien profond ne résout pas
 * afficherait le détail d'un AUTRE run sous l'id demandé : l'opérateur croirait
 * lire le run qu'il a collé.
 */
export function resolveSelectedRun(
  runs: AgentRun[],
  runId: string | null,
): { run: AgentRun | null; notFound: boolean } {
  if (runs.length === 0) return { run: null, notFound: false }

  const wanted = runId?.trim() ?? ''
  if (wanted === '') return { run: runs[0], notFound: false }

  const found = runs.find((run) => run.id === wanted)
  if (found) return { run: found, notFound: false }

  // Demandé, absent de la fenêtre chargée. On ne sait PAS si le run n'existe
  // pas ou s'il est simplement hors des 24 h / hors du plafond de lignes : le
  // composant doit dire cette nuance, pas trancher à notre place.
  return { run: null, notFound: true }
}

/* ───────────────────────── Provenance du trafic ───────────────────────── */

/**
 * Comptage du trafic de télémétrie par provenance.
 *
 * C'est la mesure qui porte la distinction INTERNE / CONSOMMATEUR de l'écran.
 * Elle délègue la classification à `classifyRuntimeTelemetryProvenance` — le
 * propriétaire unique de cette règle — et ne fait que compter.
 *
 * `total === 0` n'est PAS la même chose que `consumer === 0` :
 *  · `total === 0`    → le canal n'a rien reçu du tout ;
 *  · `consumer === 0` avec `total > 0` → le canal fonctionne et n'a vu QUE du
 *    trafic interne. C'est un fait mesuré, pas une absence de mesure, et l'écran
 *    doit pouvoir le dire ainsi (« aucun trafic consommateur observé »).
 */
export interface ProvenanceBreakdown {
  internal: number
  lifecycle: number
  consumer: number
  unknown: number
  total: number
}

export function countProvenance(events: RuntimeTelemetryEvent[]): ProvenanceBreakdown {
  const counts: ProvenanceBreakdown = {
    internal: 0,
    lifecycle: 0,
    consumer: 0,
    unknown: 0,
    total: events.length,
  }

  for (const event of events) {
    const provenance: RuntimeTelemetryProvenance = classifyRuntimeTelemetryProvenance(event)
    counts[provenance] += 1
  }

  return counts
}

/** Libellé court d'une provenance — le mot que l'écran affiche. */
export const PROVENANCE_LABEL: Record<RuntimeTelemetryProvenance, string> = {
  internal: 'Interne',
  lifecycle: 'Cycle de vie',
  consumer: 'Consommateur',
  unknown: 'Non attribué',
}

/**
 * Verdict sur le canal consommateur, en une phrase que l'écran affiche telle
 * quelle. Les quatre états sont distincts et ne se replient jamais l'un sur
 * l'autre.
 *
 *  · `unread`        — la lecture des événements a échoué. On ne sait rien.
 *  · `silent`        — lecture réussie, zéro événement, toutes sources confondues.
 *  · `internal-only` — lecture réussie, du trafic existe, aucun n'est consommateur.
 *  · `observed`      — au moins un événement consommateur a été observé.
 */
export type ConsumerChannelState = 'unread' | 'silent' | 'internal-only' | 'observed'

export function consumerChannelState(
  breakdown: ProvenanceBreakdown | null,
): ConsumerChannelState {
  if (breakdown === null) return 'unread'
  if (breakdown.total === 0) return 'silent'
  return breakdown.consumer > 0 ? 'observed' : 'internal-only'
}

/* ─────────────────────────── Champs du détail ─────────────────────────── */

/**
 * Un fait du panneau de détail : soit une valeur mesurée, soit une absence
 * QUALIFIÉE. Le composant ne reçoit jamais une chaîne « — » qu'il devrait
 * interpréter.
 *
 *  · `measured`      — la valeur existe et vaut `value`.
 *  · `not-measured`  — le champ est nul/absent dans la donnée lue. Personne ne
 *                      l'a écrit ; ce n'est pas zéro.
 *  · `not-readable`  — Aigent n'a aucun chemin de lecture vers ce fait. La
 *                      distinction avec `not-measured` est structurelle : l'un
 *                      se remplira quand un writer écrira, l'autre exige un
 *                      loader qui n'existe pas.
 */
export type RunFact =
  | { state: 'measured'; value: string }
  | { state: 'not-measured'; why: string }
  | { state: 'not-readable'; why: string }

export function measured(value: string): RunFact {
  return { state: 'measured', value }
}

export function notMeasured(why: string): RunFact {
  return { state: 'not-measured', why }
}

export function notReadable(why: string): RunFact {
  return { state: 'not-readable', why }
}

/**
 * Le modèle d'un run, avec sa qualification de confiance.
 *
 * `modelUnverified` par défaut à `true` au niveau base : un run est présumé
 * NON vérifié tant qu'un writer n'a pas prouvé le contraire. Une ligne
 * antérieure à la colonne `resolved_model` lit donc « non vérifié », et l'écran
 * le dit — il n'affiche pas le modèle déclaré du copilot à la place, ce qui
 * serait présenter une intention comme une observation.
 */
export function runModelFact(run: AgentRun): RunFact {
  const model = run.resolvedModel ?? null
  if (model === null || model.trim() === '') {
    return notMeasured("Le runner n'a pas enregistré de modèle résolu pour ce run.")
  }
  // `undefined` compte comme non vérifié : l'absence de preuve n'est pas une preuve.
  const unverified = run.modelUnverified !== false
  return measured(unverified ? `${model} (non vérifié)` : model)
}

export function runProviderFact(run: AgentRun): RunFact {
  const provider = run.resolvedProvider ?? null
  if (provider === null || provider.trim() === '') {
    return notMeasured("Le runner n'a pas enregistré de provider résolu pour ce run.")
  }
  return measured(provider)
}

/**
 * Durée d'un run. `formatDuration` (runs-console) est le propriétaire du format
 * et renvoie déjà `null` pour une latence non finie — on n'ajoute qu'une raison.
 */
export function runDurationFact(formatted: string | null): RunFact {
  if (formatted === null) {
    return notMeasured("Aucune latence finie n'a été enregistrée pour ce run.")
  }
  return measured(formatted)
}

/**
 * Coût d'un run.
 *
 * `costUsd === null` a une cause connue et nommable — un run LangGraph sans
 * bloc `usage` ne permet aucun calcul. On la dit, parce qu'« indisponible » sans
 * raison laisse croire à une panne alors que c'est une limite du chemin
 * d'exécution. Un coût non mesuré n'est JAMAIS gratuit.
 */
export function runCostFact(run: AgentRun, formatUsdValue: (n: number) => string): RunFact {
  if (run.costUsd === null || !Number.isFinite(run.costUsd)) {
    return notMeasured("Le run n'a pas remonté d'usage : aucun coût n'est calculable. Non mesuré ne veut pas dire gratuit.")
  }
  return measured(formatUsdValue(run.costUsd))
}

/**
 * Trace externe. `traceUrl` est un emplacement de contrat que RIEN n'écrit
 * aujourd'hui (`data.ts` ne mappe pas la colonne) : c'est donc `not-readable`,
 * pas `not-measured`. La nuance compte — attendre une trace qui ne viendra
 * jamais d'un writer inexistant est un faux espoir.
 */
export function runTraceFact(run: AgentRun): RunFact {
  const url = run.traceUrl
  if (url === null || url === undefined || url.trim() === '') {
    return notReadable(
      "Aucun lien de trace n'est persisté : la colonne existe au contrat mais aucun writer ne l'alimente.",
    )
  }
  return measured(url)
}

/**
 * Nombre d'appels d'outils. Ici un `0` EST une mesure réelle : la colonne est
 * écrite par le runner à chaque run, et « zéro outil appelé » est un fait
 * observé — pas une absence. On ne le convertit donc pas en absence.
 *
 * Le piège documenté dans AGENTS.md (un copilot LangGraph sans assistant
 * provisionné répond avec `tool_call_count = 0` en paraissant sain) n'est PAS
 * détectable ici : ce compteur ne peut pas dire pourquoi il vaut zéro.
 */
export function runToolCallsFact(run: AgentRun): RunFact {
  if (!Number.isFinite(run.toolCallCount)) {
    return notMeasured("Le compteur d'appels d'outils n'a pas été enregistré.")
  }
  return measured(String(run.toolCallCount))
}

/**
 * Interruptions humaines. Le seul signal réellement lisible depuis `AgentRun`
 * est le statut `needs-confirmation` : le run est arrêté et attend un humain.
 * L'HISTORIQUE des interruptions (combien, quand, résolues comment) vit dans
 * `agent_run_steps.kind = 'confirmation'`, que rien n'expose en lecture — d'où
 * `not-readable` plutôt qu'un zéro.
 */
export function runInterruptFact(run: AgentRun): RunFact {
  if (run.status === 'needs-confirmation') {
    return measured("Le run est suspendu et attend une confirmation humaine.")
  }
  return notReadable(
    "L'historique des interruptions vit dans les étapes du run, qu'aucun loader ne lit aujourd'hui.",
  )
}

/**
 * Tentatives jugées unsafe et bloquées. Comme `toolCallCount`, un `0` est une
 * mesure : le runner incrémente ce compteur, donc zéro signifie « aucune
 * tentative bloquée », pas « on ne sait pas ».
 */
export function runUnsafeFact(run: AgentRun): RunFact {
  if (!Number.isFinite(run.unsafeAttemptCount)) {
    return notMeasured("Le compteur de tentatives bloquées n'a pas été enregistré.")
  }
  return measured(String(run.unsafeAttemptCount))
}

/**
 * Message d'erreur d'un run échoué.
 *
 * `outputSummary` est le seul texte disponible. Un run `failed` dont le résumé
 * est vide ne reçoit PAS un message fabriqué (« Échec inconnu ») : l'écran dit
 * que la cause n'a pas été enregistrée. Inventer une cause d'échec est une des
 * pires données fausses qu'un plan de contrôle puisse afficher.
 */
export function runErrorFact(run: AgentRun): RunFact | null {
  if (run.status !== 'failed' && run.status !== 'blocked') return null

  const summary = run.outputSummary?.trim() ?? ''
  if (summary === '') {
    return notMeasured("Le run a terminé en échec sans qu'aucune cause ne soit enregistrée.")
  }
  return measured(summary)
}

/* ──────────────────────────── Statut d'un run ──────────────────────────── */

export const RUN_STATUS_LABEL: Record<AgentRun['status'], string> = {
  completed: 'Terminé',
  running: 'En cours',
  failed: 'Échec',
  blocked: 'Bloqué',
  'needs-confirmation': 'Confirmation',
}

/**
 * Couleur de badge Catalyst par statut. `blocked` et `failed` sont distincts :
 * un run bloqué a été ARRÊTÉ par une garde (verdict terminal côté Sentinel), un
 * run échoué a planté. Les confondre en « rouge » perdrait l'information la plus
 * actionnable de la liste.
 *
 * CETTE TABLE A DÉRIVÉ, ET DEUX ÉCRANS SE CONTREDISAIENT. `status.ts` est
 * l'autorité (`RUN_STATUS_COLOR`) et `cockpit/run-stream.tsx` la suivait ; ce
 * fichier avait recopié une échelle proche mais fausse sur trois statuts :
 *
 *   - `needs-confirmation` en `zinc` alors que l'autorité dit `warn`. Un run
 *     suspendu qui ATTEND UN HUMAIN était rendu dans le registre le plus éteint
 *     de la liste — l'état le plus actionnable, peint comme le plus inerte.
 *   - `blocked` en `amber` alors que l'autorité réserve `blocked` (violet) à ce
 *     verdict terminal. L'ambre le confondait avec un simple avertissement.
 *   - `running` en `sky` là où l'autorité dit `running` (bleu).
 *
 * Conséquence vécue : un même run changeait de couleur entre l'accueil et
 * `/runs`. On DÉRIVE donc désormais de l'autorité au lieu de la recopier — une
 * seconde source rend la divergence inévitable, c'est ce qui vient de se
 * produire.
 */
export const RUN_STATUS_BADGE: Record<AgentRun['status'], 'emerald' | 'blue' | 'red' | 'purple' | 'amber'> = {
  completed: 'emerald',
  running: 'blue',
  failed: 'red',
  blocked: 'purple',
  'needs-confirmation': 'amber',
}
