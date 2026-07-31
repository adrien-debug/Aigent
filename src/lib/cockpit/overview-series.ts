/**
 * Dérivations pures pour le cockpit — aucune dépendance React, aucun accès réseau.
 *
 * DOCTRINE (AGENTS.md § « Vérité des données ») : une valeur non mesurée reste
 * `null`, jamais coercée en `0`. Ces fonctions ne fabriquent donc JAMAIS une série
 * plate à zéro pour combler un trou :
 *
 *  · `windowRuns === null`  → la lecture a ÉCHOUÉ → toute série vaut `null`, et
 *    l'écran doit rendre « Indisponible », pas un axe vide. Une fenêtre non lue
 *    n'est pas une fenêtre calme.
 *  · `windowRuns === []`    → la lecture a RÉUSSI et la fenêtre est vide. C'est une
 *    mesure : les séries existent, à zéro, et c'est vrai.
 *
 * Ces deux cas sont visuellement différents à l'écran. Les confondre peindrait une
 * flotte sereine par-dessus un backend mort.
 */
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

/** Les cinq statuts terminaux ou en vol, dans un ordre d'empilement stable. */
export const RUN_STATUSES: readonly AgentRunStatus[] = [
  'completed',
  'running',
  'needs-confirmation',
  'blocked',
  'failed',
] as const

export type HourlyBucket = {
  /** Début de l'heure, en ms epoch — l'axe le formate, la donnée reste brute. */
  hourMs: number
  /** Libellé court `HH:00`, calculé une fois ici plutôt qu'à chaque rendu. */
  label: string
  completed: number
  running: number
  'needs-confirmation': number
  blocked: number
  failed: number
  total: number
}

export type StatusSlice = {
  status: AgentRunStatus
  count: number
}

const HOUR_MS = 3_600_000

/**
 * Squelette des `hours` dernières heures glissantes, une entrée par heure.
 *
 * Toutes les heures de la fenêtre existent, y compris celles sans run : une
 * heure sans activité est une MESURE (0), pas un trou. C'est légitime parce que
 * la fenêtre, elle, a bien été lue — le cas « non lue » est traité en amont par
 * un `return null`.
 */
function hourSkeleton<T>(nowMs: number, hours: number, seed: (hourMs: number, label: string) => T) {
  const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const firstHourStart = currentHourStart - (hours - 1) * HOUR_MS
  const buckets = new Map<number, T>()
  for (let h = 0; h < hours; h += 1) {
    const hourMs = firstHourStart + h * HOUR_MS
    const label = `${String(new Date(hourMs).getHours()).padStart(2, '0')}:00`
    buckets.set(hourMs, seed(hourMs, label))
  }
  return buckets
}

/** L'heure pleine d'un horodatage ISO, ou `null` s'il est illisible. */
function hourOf(startedAt: string): number | null {
  const ms = Date.parse(startedAt)
  return Number.isNaN(ms) ? null : Math.floor(ms / HOUR_MS) * HOUR_MS
}

/**
 * Histogramme horaire sur les `hours` dernières heures glissantes.
 *
 * Les buckets sont créés pour TOUTES les heures de la fenêtre, y compris celles
 * sans run : une heure sans activité est une mesure (0), pas un trou. C'est
 * légitime ici — contrairement à un KPI absent — parce que la fenêtre a été lue.
 */
export function buildHourlyBuckets(
  windowRuns: AgentRun[] | null,
  nowMs: number,
  hours = 24,
): HourlyBucket[] | null {
  if (windowRuns === null) return null

  const buckets = hourSkeleton<HourlyBucket>(nowMs, hours, (hourMs, label) => ({
    hourMs,
    label,
    completed: 0,
    running: 0,
    'needs-confirmation': 0,
    blocked: 0,
    failed: 0,
    total: 0,
  }))

  for (const run of windowRuns) {
    const hourMs = hourOf(run.startedAt)
    if (hourMs === null) continue
    const bucket = buckets.get(hourMs)
    // Un run hors fenêtre est ignoré plutôt que replié sur un bord : le replier
    // gonflerait une heure qui n'a rien vu.
    if (!bucket) continue
    bucket[run.status] += 1
    bucket.total += 1
  }

  return [...buckets.values()].sort((a, b) => a.hourMs - b.hourMs)
}

/** Répartition par statut sur la fenêtre. `null` si la fenêtre n'a pas été lue. */
export function buildStatusBreakdown(windowRuns: AgentRun[] | null): StatusSlice[] | null {
  if (windowRuns === null) return null
  const counts = new Map<AgentRunStatus, number>(RUN_STATUSES.map((s) => [s, 0]))
  for (const run of windowRuns) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1)
  }
  return RUN_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }))
}
