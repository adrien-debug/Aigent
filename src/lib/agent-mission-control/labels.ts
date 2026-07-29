/**
 * Agent Mission Control — static display labels.
 *
 * UI constants (enum → human label), NOT data. Live in their own module so the
 * running app never imports the mock dataset. Enum values come from `types.ts`.
 *
 * THE SINGLE PLACE A STATUS LABEL MAY EXIST (AIGENT-UI-TRUTH-026). One agent
 * used to read `ACTIVE` on the catalogue, `ACTIVE` on its detail header and
 * `IDLE` on the team canvas at the same instant, because three components each
 * spelled their own vocabulary. A component must import from here and must
 * never write `'Active'` / `'DRAFT'` / `'Idle'` itself — `check-status-truth.mjs`
 * enforces it over `src/app/admin/**`.
 *
 * An agent carries several independent statuses. Two of them reach the /admin
 * home page, and they must stay two distinct labels on screen, never one
 * ambiguous badge:
 *   - RUNTIME  — `AvailableAgent.status`, what the runtime can prove today
 *   - RUN      — `AgentRun.status`, the outcome of one execution
 *
 * Only those two tables are restored here. The lifecycle (`copilots.status`),
 * executable, runtime-id, provider, version-stage and platform tables are
 * deliberately ABSENT: no surface in this build shows them, and an export with
 * no consumer fails `quality:dead` (knip). Restore one from git history the day
 * a screen actually renders it — never "for later".
 *
 * `import type` only from `available-agents.ts`: that module is `server-only`
 * and a type import is erased at compile time, so this file stays importable
 * from a client component.
 */
import type { AvailableAgentStatus } from './available-agents'
import type { AgentRunStatus } from './types'

/**
 * RUNTIME — `AvailableAgent.status`, derived from persisted runtime truth.
 *
 * Deliberately NOT the same words as the lifecycle vocabulary where the two
 * differ in meaning: an agent whose lifecycle is `draft` is `Inactive` at
 * runtime, and showing "Draft" in a runtime slot is what made a single agent
 * read as two different states on two screens.
 */
export const AVAILABLE_AGENT_STATUS_LABELS: Record<AvailableAgentStatus, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  degraded: 'Dégradé',
  unavailable: 'Indisponible',
}

/** RUN — the outcome of one execution (`agent_runs.status`). */
export const AGENT_RUN_STATUS_LABELS: Record<AgentRunStatus, string> = {
  completed: 'Terminé',
  failed: 'Échec',
  blocked: 'Bloqué',
  'needs-confirmation': 'Confirmation requise',
  running: 'En cours',
}

/**
 * The exact word every surface uses for an ABSENT measurement.
 *
 * One spelling, one place: "Indisponible" and "—" and "0" drifting across
 * cards is how an unmeasured value starts reading as a measured zero. A `null`
 * metric renders THIS, never a fabricated figure.
 */
export const UNAVAILABLE_LABEL = 'Indisponible'
