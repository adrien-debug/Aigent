/**
 * Agent Mission Control — the ONE definition of "this health metric was
 * MEASURED", and the ONE rollup built on top of it.
 *
 * ─── WHY THIS MODULE EXISTS STANDALONE ──────────────────────────────────────
 *
 * The rule belongs, logically, next to the rollup that consumes it in
 * `dashboard-overview.ts`. It cannot live there. That file opens with
 * `import 'server-only'`, and taking a VALUE from it drags that guard into the
 * runtime graph of whoever imports it — no UI consumer after frontend reset.
 * is rendered by the `components` vitest project under BROWSER resolve
 * conditions (vitest.config.ts), where `server-only` resolves to the module that
 * throws. Measured, not assumed: the import was tried on an earlier branch and
 * `tests/unit/overview-screen-truth.test.tsx` died with "This module cannot be
 * imported from a Client Component".
 *
 * The answer is not a second copy of the rule (that is what this module
 * replaces: two character-for-character identical definitions, one in the data
 * layer and one in the screen, pinned together by a source-comparing test), and
 * it is not moving business logic into a React component either. It is a NEUTRAL
 * lib module — no `server-only`, no I/O, no framework — that both sides import.
 * It sits beside `types.ts` and `format.ts` for the same reason those two are
 * importable from anywhere: it only knows about shapes and arithmetic.
 *
 * KEEP IT NEUTRAL. The only import here is TYPE-ONLY, from `./types`. Adding a
 * value import of anything that reaches `server-only`, `next/*`, `postgrest`, or
 * the data layer silently re-breaks `/admin/projects` in the component suite.
 *
 * ─── WHY "MEASURED" NEEDS A RULE AT ALL ─────────────────────────────────────
 *
 * `Copilot.health` is a normalised blob: `data.ts` fills every key so consumers
 * never read `undefined`, and names whatever it could NOT prove in
 * `Copilot.healthUnavailableFields`. So a `0` in `health.costLast24hUsd` is
 * either a measured zero or a placeholder for "nobody knows" — and only the
 * companion list tells them apart. Summing without consulting it is how an
 * unproven cost rendered as a confident "$0.00".
 */
import type { Copilot, CopilotHealthMetric } from './types'

/**
 * Is this health metric a MEASUREMENT on this copilot?
 *
 * Three gates, in order, and the first two matter as much as the third:
 *  1. `healthUnavailableFields === undefined` — the row never went through the
 *     data layer, so NOTHING is proven. The contract (`types.ts` ›
 *     `Copilot.healthUnavailableFields`) says to treat every metric as
 *     unavailable in that case, not as measured. A raw PostgREST row cast by
 *     `camelRows` lands here.
 *  2. the metric is named in that list — the data layer read the row and could
 *     not prove this figure; the number in `health` is a normalisation
 *     placeholder.
 *  3. otherwise the value must actually be a finite number. `NaN`/`Infinity`
 *     are not measurements, and neither is a missing key on a partially written
 *     `health` jsonb (`health: {}` is what
 *     `scripts/provision-tradeagent-roster.mjs` inserts).
 *
 * Body kept VERBATIM from the two copies it replaces — this consolidation does
 * not re-litigate the definition PR #38 established.
 */
export function isMeasuredHealth(copilot: Copilot, metric: CopilotHealthMetric): boolean {
  if (copilot.healthUnavailableFields === undefined) return false
  if (copilot.healthUnavailableFields.includes(metric)) return false
  return Number.isFinite(copilot.health?.[metric])
}

/**
 * A rollup over a team, carrying its own coverage.
 *
 * The three fields exist so a caller can tell apart ALL FIVE states the metric
 * can be in, WITHOUT re-deriving anything from the team:
 *
 *  | state                | shape                                    | renders            |
 *  |----------------------|------------------------------------------|--------------------|
 *  | absent measurement   | `null` (not a `MeasuredSum` at all)       | `Indisponible`     |
 *  | measured zero        | `{ value: 0, measured: n>0, unmeasured }` | a real `0`/`$0.00` |
 *  | measured positive    | `{ value: >0, measured: n>0, unmeasured }`| the figure         |
 *  | full coverage        | `unmeasured === 0`                        | claim completeness |
 *  | partial coverage     | `unmeasured > 0`                          | disclose the gap   |
 *
 * `measured` and `unmeasured` are BOTH carried rather than one plus a team
 * length: coverage ("what fraction of the team backs this figure") and support
 * ("is there any evidence at all") are different questions, and a caller that
 * had to reach back to the team array to answer the second one would be
 * re-implementing the rule this module exists to centralise.
 *
 * `measured + unmeasured === team.length`, always — including the empty team,
 * where both are 0. Note that a returned `measured === 0` therefore ONLY ever
 * means "empty team": a non-empty team that proved nothing returns `null`.
 *
 * `value` is a LOWER BOUND whenever `unmeasured > 0`. Printing it as "the total"
 * in that case is the same overclaim as the `$0.00`, phrased in prose — state
 * the coverage instead.
 */
export type MeasuredSum = {
  /** Sum over the members that PROVED the metric. Exact when `unmeasured === 0`,
   *  a lower bound otherwise. A genuine measured `0` is a real `0` here. */
  value: number
  /** Members that proved the metric — the figure's support. `0` only ever
   *  happens on an EMPTY team (a non-empty team proving none returns `null`). */
  measured: number
  /** Members the figure could NOT cover — the gap to disclose. */
  unmeasured: number
}

/**
 * Sum a health metric over a team, counting ONLY the members that proved it.
 *
 * Rollup semantics, unchanged from PR #38 and applied identically by `/admin`
 * and `/admin/projects`:
 *  · EMPTY team → a measured `0` (`{ value: 0, measured: 0, unmeasured: 0 }`).
 *    With no agent assigned there is no run to have been made and no cost to
 *    have been incurred; that zero is a FACT, not a placeholder, and it must
 *    render as a real zero.
 *  · NON-EMPTY team, zero members proved it → `null`. A total nobody measured
 *    is not `0` — it renders `Indisponible`.
 *  · otherwise → the proven sum, a genuine `0` included, with its coverage.
 *
 * Never `?? 0` on a member's metric: that is precisely the coalescence that
 * turned "nobody measured" into a confident figure.
 */
export function sumMeasuredHealth(team: Copilot[], metric: CopilotHealthMetric): MeasuredSum | null {
  let value = 0
  let measured = 0
  let unmeasured = 0
  for (const copilot of team) {
    if (isMeasuredHealth(copilot, metric)) {
      value += copilot.health[metric]
      measured += 1
    } else {
      unmeasured += 1
    }
  }
  if (team.length > 0 && measured === 0) return null
  return { value, measured, unmeasured }
}
