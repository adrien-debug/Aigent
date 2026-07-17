/**
 * AIG-TRADE-001 — LOT 9 (Trading Agent Factory surface).
 *
 * Display view-model derived from the typed roster (roster.ts) + tool handlers
 * (tools.ts) + delivery status (delivery.ts). PURE, offline, deterministic —
 * no network, no clock, no LLM. The page is a Server Component that reads
 * ROSTER directly; this module only shapes that data for the UI.
 *
 * Honest status (prompt Lot 9): the six agents are NOT materialized yet —
 * there is no proven Copilot/CopilotVersion behind them. Every agent is
 * therefore surfaced as EXPERIMENTAL / "Non matérialisé" at a display version
 * of v1.0.0-draft. Tool availability mirrors the handlers' real behaviour:
 * some read tools have NO wired source and always resolve UNAVAILABLE (account
 * risk), others are order-book/perp backed and are UNAVAILABLE without a live
 * source (liquidity, funding/OI).
 */

import type { DeliveryStatus } from '@/lib/agent-mission-control/market/delivery'
import type { TradingAgentDef } from '@/lib/agent-mission-control/market/agents/roster'

/** Display version for every agent — none is materialized into a real version yet. */
export const DISPLAY_VERSION = 'v1.0.0-draft'

/** Tool-availability, mirroring tools.ts handler behaviour (honest, invariant #8). */
export type ToolAvailability = 'available' | 'unavailable'

/**
 * Tools whose real handler resolves UNAVAILABLE with no live source wired.
 *  - read_account_risk_snapshot: NO account-read source exists — always
 *    UNAVAILABLE (tools.ts:251, "capital never fabricated").
 *  - read_liquidity_snapshot: order-book backed — UNAVAILABLE without a live
 *    order-book source (often the case).
 *  - read_funding_open_interest: perp-only — UNAVAILABLE without a perp source.
 */
const ALWAYS_UNAVAILABLE_TOOLS = new Set<string>([
  'read_account_risk_snapshot',
])
const OFTEN_UNAVAILABLE_TOOLS = new Set<string>([
  'read_liquidity_snapshot',
  'read_funding_open_interest',
])

export interface ToolSlot {
  id: string
  availability: ToolAvailability
  /** Short reason shown on unavailable tools. */
  note: string | null
}

export interface TradingAgentVM {
  slug: string
  name: string
  specialty: string
  description: string
  /** Kebab display tag from the accent field ('accent' | 'zinc') — always 'accent' today. */
  accent: 'accent' | 'zinc'
  version: string
  status: DeliveryStatus
  /** Human status label. */
  statusLabel: string
  materialized: false
  contractName: string
  tools: ToolSlot[]
  availableToolCount: number
  unavailableToolCount: number
  skills: readonly { label: string; detail?: string }[]
  outputInvariants: readonly string[]
  maxStepsPerRun: number
  maxCostPerRunUsd: number
  maxLatencyMsTarget: number
}

function toolSlot(id: string): ToolSlot {
  if (ALWAYS_UNAVAILABLE_TOOLS.has(id)) {
    return { id, availability: 'unavailable', note: 'no source wired' }
  }
  if (OFTEN_UNAVAILABLE_TOOLS.has(id)) {
    return { id, availability: 'unavailable', note: 'no live order-book / perp source' }
  }
  return { id, availability: 'available', note: null }
}

const STATUS_LABEL: Record<DeliveryStatus, string> = {
  'DELIVERABLE-LIVE': 'Deliverable — live',
  'DELIVERABLE-SNAPSHOT': 'Deliverable — snapshot',
  EXPERIMENTAL: 'Experimental',
  BLOCKED: 'Blocked',
  REJECTED: 'Rejected',
}

export function toAgentVM(agent: TradingAgentDef): TradingAgentVM {
  const tools = agent.toolIds.map(toolSlot)
  const available = tools.filter((t) => t.availability === 'available')
  const status: DeliveryStatus = 'EXPERIMENTAL'
  return {
    slug: agent.slug,
    name: agent.name,
    specialty: agent.specialty,
    description: agent.description,
    accent: agent.accent,
    version: DISPLAY_VERSION,
    status,
    statusLabel: STATUS_LABEL[status],
    materialized: false,
    contractName: agent.outputContract.schemaName,
    tools,
    availableToolCount: available.length,
    unavailableToolCount: tools.length - available.length,
    skills: agent.skills,
    outputInvariants: agent.outputContract.invariants,
    maxStepsPerRun: agent.maxStepsPerRun,
    maxCostPerRunUsd: agent.maxCostPerRunUsd,
    maxLatencyMsTarget: agent.maxLatencyMsTarget,
  }
}

export interface RosterSummary {
  agentCount: number
  contractCount: number
  toolReferences: number
  availableToolReferences: number
  unavailableToolReferences: number
}

export function summarizeRoster(vms: TradingAgentVM[]): RosterSummary {
  const contracts = new Set(vms.map((v) => v.contractName))
  let toolReferences = 0
  let availableToolReferences = 0
  for (const v of vms) {
    toolReferences += v.tools.length
    availableToolReferences += v.availableToolCount
  }
  return {
    agentCount: vms.length,
    contractCount: contracts.size,
    toolReferences,
    availableToolReferences,
    unavailableToolReferences: toolReferences - availableToolReferences,
  }
}
