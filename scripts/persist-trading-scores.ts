/**
 * AIG-TRADE-001 — RETIRED.
 *
 * This script USED to PATCH a fully hardcoded blob onto every trading copilot:
 *   - `copilot_versions.scores` with `testPassRate: 1` and
 *     `benchmarkScore: <constante en dur 0.985>` (evidenceLevel:'FIXTURE'), and
 *   - `copilots.health` with `testPassRate: 1, benchmarkScore: 0.985,
 *     runsLast24h: 4, avgLatencyMs: 900, ...`.
 *
 * Those values were then read back through the app as if they were MEASURED
 * results. They were not: they came from a source-level constant, not from any
 * run. Order d'Adrien — aucun hardcode qui se fait passer pour de la donnée.
 * A benchmark score must be produced by the real benchmark runner and persisted
 * from that run's actual output, never stamped from a constant here.
 *
 * The write body has therefore been removed entirely. The trading copilots'
 * scores now come exclusively from the real benchmark runner. There is no
 * fabricated injection left to run.
 *
 * NOTE (residual): rows already written to the DB by a PREVIOUS execution of
 * this script keep the fabricated values — this change does NOT touch the DB.
 * Clearing them is a separate, deliberate operation.
 *
 * This file is intentionally left as a no-op stub rather than deleted so the
 * historical AIG-TRADE-001 reference resolves and the retirement is documented
 * in place. Do not re-add a hardcoded score PATCH here.
 */
export {}
