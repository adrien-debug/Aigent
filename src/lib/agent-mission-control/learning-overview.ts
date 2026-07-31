/**
 * learning-overview.ts — data adapter for the future Learning surface.
 *
 * COMPOSITION, NOT RE-DERIVATION: every aggregate below is read out of
 * `getDashboardOverview()` (`./dashboard-overview.ts`) — the reads, the
 * three-state null/measured/failed contract, and the N+1 refusal documented
 * on that module are reused verbatim, not re-implemented. If a rule needs to
 * change (e.g. what counts as an incident), it changes in ONE place
 * (`dashboard-overview.ts`) and this module inherits it for free.
 *
 * `import 'server-only'` is inherited transitively through
 * `dashboard-overview.ts` (which already opens with it) and through
 * `learning-runtime.ts`; this module does not need its own PostgREST reads
 * so it does not need the import directly, but it MUST NEVER be imported
 * from a client component — nothing here is safe to run in a browser bundle.
 */
import 'server-only'

import {
  getDashboardOverview,
  FULL_ACTION_QUEUE_LIMIT,
  type ActionItem,
  type DashboardOverview,
} from './dashboard-overview'
import { getLearningRuntimeHealth, type LearningRuntimeHealth } from './learning-runtime'
import type { RuntimeTelemetryEvent } from './runtime-telemetry-store'
import type { AgentRun } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Supervision snapshot — activity + incidents, derived ENTIRELY from fields
 * `dashboard-overview.ts` already reads (`windowRuns`, `recentTelemetryEvents`,
 * `telemetryHealth`). No new PostgREST call is made by this module.
 */
export type LearningSupervisionSnapshot = {
  /**
   * Runs observed in the shared 24h window. Mirrors the three-state contract
   * of `DashboardOverview.windowRuns` exactly: `null` here means the read
   * FAILED upstream (see `dashboard-overview.dataWarnings` for why), NOT that
   * zero runs happened. Consumers must render "Indisponible", never "0".
   */
  runsInWindow: AgentRun[] | null
  /** Count of terminal runs whose status is `failed`, within `runsInWindow`.
   *  `null` propagates from `runsInWindow === null` — an unread window has no
   *  countable failures, known or unknown. */
  failedRunsInWindow: number | null
  /** The same fleet runtime-telemetry health diagnostic the dashboard already
   *  computes — see `telemetry-health.ts` for the full state machine and its
   *  doctrine (silence is never evidence of inactivity). */
  telemetryHealth: DashboardOverview['telemetryHealth']
  /** Raw telemetry feed, newest first — `null` only when that read failed
   *  upstream (see `DashboardOverview.recentTelemetryEvents`). */
  recentTelemetryEvents: RuntimeTelemetryEvent[] | null
  /** How fresh this whole snapshot is — the SAME instant `getDashboardOverview`
   *  was called with, so a caller stitching multiple Learning panels together
   *  can prove they all describe one moment, not staggered reads. */
  asOf: string
}

/**
 * The reviewable action queue for Learning.
 *
 * `items` is `overview.actionItems` — la file dérivée UNE seule fois par
 * `dashboard-overview.ts`, avec ses vraies entrées, mais demandée sous un
 * plafond haut (`FULL_ACTION_QUEUE_LIMIT`) au lieu du défaut à 6 de l'aperçu.
 * La file n'est jamais re-dérivée ici : voir le commentaire sur
 * `actionItemsLimit` dans `dashboard-overview.ts` pour pourquoi une
 * re-dérivation produirait de fausses lignes « source indisponible ».
 */
export type LearningReviewQueue = {
  items: ActionItem[]
  /** `true` quand `items` est la file COMPLÈTE (plafond de revue), `false`
   *  quand c'est la tranche de six de l'aperçu. Permet à l'UI de dire
   *  honnêtement laquelle des deux elle montre. */
  isFullQueue: boolean
}

/**
 * Evaluation coverage — deliberately partial. `dashboard-overview.ts`
 * documents (on `getDashboardOverview`) that per-copilot scorecards
 * (release gate, benchmark, shadow/replay) cost an unavoidable N+1 — 10-15
 * PostgREST round trips PER COPILOT — and are refused on the cockpit read.
 * Learning inherits that refusal rather than re-introducing the N+1 here:
 * paying it would make this adapter exactly the kind of "cheap-looking read
 * that is secretly 12-48s" the dashboard's own doctrine warns against.
 */
export type LearningEvaluationsSnapshot = {
  /**
   * Always `null` in this mission: per-copilot scorecards (tests, benchmarks,
   * shadow, replay, release gate) are NOT read here. `reason` names why so a
   * caller never mistakes this for "we checked and found nothing".
   */
  perCopilotScorecards: null
  reason: string
}

export type LearningOverview = {
  supervision: LearningSupervisionSnapshot
  reviewQueue: LearningReviewQueue
  evaluations: LearningEvaluationsSnapshot
  learningRuntime: LearningRuntimeHealth
  /** Warnings from the underlying dashboard read, passed through unchanged so
   *  a Learning-specific caller does not have to re-derive them. */
  dataWarnings: string[]
}

// ---------------------------------------------------------------------------
// Reason string for the deliberately-unmeasured evaluations zone
// ---------------------------------------------------------------------------

/**
 * Exported so a test (or a future caller) can assert against the exact
 * string instead of re-typing it and drifting — same idiom as
 * `RUNS_READ_FAILED_WARNING` in `dashboard-overview.ts`.
 */
export const EVALUATIONS_NOT_MEASURED_REASON =
  'Per-copilot scorecards (tests, benchmarks, shadow, replay, release gate) are not read on this surface: ' +
  'each one costs 10-15 PostgREST round trips per copilot (N+1), the same cost dashboard-overview.ts already ' +
  'refuses to pay for the cockpit. This zone is honestly unmeasured, not a degraded read.'

// ---------------------------------------------------------------------------
// Pure — supervision snapshot
// ---------------------------------------------------------------------------

/** Pure so the "what counts as a failed run" rule is unit-testable without a
 *  fetch — mirrors the terminal-status classification `computeSuccess24h`
 *  already uses in `dashboard-overview.ts` (only `failed` counts, `blocked` /
 *  `needs-confirmation` / `running` do not fold into it). */
export function computeFailedRunsInWindow(runsInWindow: AgentRun[] | null): number | null {
  if (runsInWindow === null) return null
  return runsInWindow.filter((r) => r.status === 'failed').length
}

export function buildSupervisionSnapshot(
  overview: Pick<DashboardOverview, 'windowRuns' | 'telemetryHealth' | 'recentTelemetryEvents'>,
  asOf: string
): LearningSupervisionSnapshot {
  return {
    runsInWindow: overview.windowRuns,
    failedRunsInWindow: computeFailedRunsInWindow(overview.windowRuns),
    telemetryHealth: overview.telemetryHealth,
    recentTelemetryEvents: overview.recentTelemetryEvents,
    asOf,
  }
}

// ---------------------------------------------------------------------------
// Server collector
// ---------------------------------------------------------------------------

/**
 * Read-only Learning overview. Never writes.
 *
 * REVIEW QUEUE CHOICE: `dashboard-overview.ts`'s `buildActionItems` defaults
 * to `limit: 6` because the cockpit only has room for a short list. Learning
 * is a dedicated review surface, not a compact widget, so truncating to 6
 * there would silently hide real queue items from the one screen whose whole
 * job is to review them. This function therefore calls `buildActionItems`
 * A SECOND TIME with a high limit, reusing the exact same inputs
 * `getDashboardOverview` already assembled — `overview.copilots`,
 * `overview.projectRows`, `overview.pendingArchitectApprovals` and
 * `overview.recentDeliveries` carry everything `buildActionItems` needs, so
 * this is a second PURE call (no I/O), not a second read. The alternative
 * (reusing `overview.actionItems` as-is) was rejected because it would quietly
 * present a truncated cockpit view as if it were Learning's complete queue —
 * see `LearningReviewQueue.isFullQueue` for how a caller can tell them apart
 * either way this function is ever changed.
 */
export async function getLearningOverview(nowMs: number = Date.now()): Promise<LearningOverview> {
  const [overview, learningRuntime] = await Promise.all([
    // Limite haute : Learning est une surface de revue dédiée, pas la colonne
    // tronquée de l'aperçu. La limite traverse la dérivation d'origine plutôt
    // que d'être appliquée après coup — voir `FULL_ACTION_QUEUE_LIMIT`.
    getDashboardOverview(nowMs, { actionItemsLimit: FULL_ACTION_QUEUE_LIMIT }),
    getLearningRuntimeHealth(),
  ])

  const asOf = new Date(nowMs).toISOString()

  return {
    supervision: buildSupervisionSnapshot(overview, asOf),
    reviewQueue: {
      // La file arrive DÉJÀ complète : `getDashboardOverview` a reçu
      // `actionItemsLimit` ci-dessus, donc `overview.actionItems` est la file
      // entière, dérivée UNE fois avec les vraies entrées.
      //
      // La re-dériver ici serait une faute : `latestSandboxByCopilot`,
      // `scorecards` et `missionRuns` ne sont pas exposés sur
      // `DashboardOverview`, et les remplacer par `null`/vide fabriquerait des
      // lignes « source indisponible » pour des sources lues sans erreur — un
      // faux négatif, exactement le symétrique du faux zéro que la doctrine
      // interdit. Une seule dérivation, une limite qui varie.
      items: overview.actionItems,
      isFullQueue: true,
    },
    evaluations: {
      perCopilotScorecards: null,
      reason: EVALUATIONS_NOT_MEASURED_REASON,
    },
    learningRuntime,
    dataWarnings: overview.dataWarnings,
  }
}
