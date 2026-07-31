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

  const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const firstHourStart = currentHourStart - (hours - 1) * HOUR_MS

  const buckets = new Map<number, HourlyBucket>()
  for (let h = 0; h < hours; h += 1) {
    const hourMs = firstHourStart + h * HOUR_MS
    buckets.set(hourMs, {
      hourMs,
      label: `${String(new Date(hourMs).getHours()).padStart(2, '0')}:00`,
      completed: 0,
      running: 0,
      'needs-confirmation': 0,
      blocked: 0,
      failed: 0,
      total: 0,
    })
  }

  for (const run of windowRuns) {
    const startedMs = Date.parse(run.startedAt)
    if (Number.isNaN(startedMs)) continue
    const hourMs = Math.floor(startedMs / HOUR_MS) * HOUR_MS
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

/**
 * Coût horaire cumulable pour un graphe.
 *
 * ATTENTION : un run dont `costUsd` vaut `null` n'a pas coûté zéro — son coût
 * n'était pas mesurable. On le compte donc dans `unmeasuredRuns` au lieu de
 * l'additionner comme 0, pour que l'écran puisse dire que la courbe est un
 * MINORANT et non un total.
 */
export type HourlyCost = {
  hourMs: number
  label: string
  usd: number
  measuredRuns: number
  unmeasuredRuns: number
}

export function buildHourlyCost(
  windowRuns: AgentRun[] | null,
  nowMs: number,
  hours = 24,
): HourlyCost[] | null {
  if (windowRuns === null) return null

  const currentHourStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const firstHourStart = currentHourStart - (hours - 1) * HOUR_MS

  const buckets = new Map<number, HourlyCost>()
  for (let h = 0; h < hours; h += 1) {
    const hourMs = firstHourStart + h * HOUR_MS
    buckets.set(hourMs, {
      hourMs,
      label: `${String(new Date(hourMs).getHours()).padStart(2, '0')}:00`,
      usd: 0,
      measuredRuns: 0,
      unmeasuredRuns: 0,
    })
  }

  for (const run of windowRuns) {
    const startedMs = Date.parse(run.startedAt)
    if (Number.isNaN(startedMs)) continue
    const bucket = buckets.get(Math.floor(startedMs / HOUR_MS) * HOUR_MS)
    if (!bucket) continue
    if (run.costUsd === null || run.costUsd === undefined) {
      bucket.unmeasuredRuns += 1
    } else {
      bucket.usd += run.costUsd
      bucket.measuredRuns += 1
    }
  }

  return [...buckets.values()].sort((a, b) => a.hourMs - b.hourMs)
}

/**
 * Le pic d'un histogramme, pour borner un axe sans le laisser respirer à l'infini.
 * `null` quand il n'y a pas de série — l'appelant ne doit pas inventer d'échelle.
 */
export function peakTotal(buckets: HourlyBucket[] | null): number | null {
  if (buckets === null || buckets.length === 0) return null
  return buckets.reduce((max, b) => (b.total > max ? b.total : max), 0)
}
