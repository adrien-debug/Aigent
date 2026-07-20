import 'server-only'

export interface AccountRiskSnapshot {
  account_id: string
  wallet_address: string | null
  total_equity_usd: string | null
  available_balance_usd: string | null
  collateral_usd: string | null
  borrowed_usd: string | null
  net_exposure_usd: string | null
  gross_exposure_usd: string | null
  leverage: string | null
  ltv: string | null
  liquidation_buffer_pct: string | null
  unrealized_pnl_usd: string | null
  realized_pnl_usd: string | null
  position_count: number | null
  largest_position_pct: string | null
  concentration_score: string | null
  stablecoin_ratio: string | null
  btc_exposure_pct: string | null
  withdrawal_capacity_usd: string | null
  pending_withdrawals_usd: string | null
  risk_flags: string[]
  source_timestamp: number | null
  fetched_at: number
  freshness_status: 'live' | 'stale' | 'unavailable'
  unavailable_fields: string[]
  source: 'tradeagent-account-snapshot'
}

type StoredSnapshot = Omit<
  AccountRiskSnapshot,
  'fetched_at' | 'freshness_status' | 'unavailable_fields' | 'source'
>

const ACCOUNT_CACHE_TTL_MS = 10_000
const MAX_ACCOUNT_CACHE_ENTRIES = 16
const cache = new Map<string, { expiresAt: number; snapshot: AccountRiskSnapshot }>()
let cachedRaw: string | undefined
let storedById = new Map<string, StoredSnapshot>()

function loadConfiguredSnapshots(): Map<string, StoredSnapshot> {
  const raw = process.env.TRADEAGENT_ACCOUNT_RISK_SNAPSHOTS_JSON
  if (raw === cachedRaw) return storedById
  cachedRaw = raw
  storedById = new Map()
  cache.clear()
  if (!raw) return storedById
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) throw new Error('expected an array')
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const candidate = entry as StoredSnapshot
      if (typeof candidate.account_id === 'string' && candidate.account_id.length > 0) {
        storedById.set(candidate.account_id, candidate)
      }
    }
  } catch (error) {
    console.error(
      '[market/account-risk] configured snapshot payload is invalid',
      error instanceof Error ? error.message : 'unknown parse error',
    )
  }
  return storedById
}

export function readConfiguredAccountRisk(
  accountId: string,
  asOf = Date.now(),
): AccountRiskSnapshot | null {
  const cached = cache.get(accountId)
  if (cached && cached.expiresAt > asOf) return cached.snapshot
  if (cached) cache.delete(accountId)

  const stored = loadConfiguredSnapshots().get(accountId)
  if (!stored) return null
  const sourceTimestamp =
    typeof stored.source_timestamp === 'number' && Number.isFinite(stored.source_timestamp)
      ? stored.source_timestamp
      : null
  const ageMs = sourceTimestamp === null ? null : Math.max(0, asOf - sourceTimestamp)
  const nullableFields = [
    'wallet_address',
    'total_equity_usd',
    'available_balance_usd',
    'collateral_usd',
    'borrowed_usd',
    'net_exposure_usd',
    'gross_exposure_usd',
    'leverage',
    'ltv',
    'liquidation_buffer_pct',
    'unrealized_pnl_usd',
    'realized_pnl_usd',
    'position_count',
    'largest_position_pct',
    'concentration_score',
    'stablecoin_ratio',
    'btc_exposure_pct',
    'withdrawal_capacity_usd',
    'pending_withdrawals_usd',
    'source_timestamp',
  ] as const
  const snapshot: AccountRiskSnapshot = {
    ...stored,
    risk_flags: Array.isArray(stored.risk_flags)
      ? stored.risk_flags.filter((flag): flag is string => typeof flag === 'string')
      : [],
    source_timestamp: sourceTimestamp,
    fetched_at: asOf,
    freshness_status:
      sourceTimestamp === null ? 'unavailable' : ageMs !== null && ageMs <= 15_000 ? 'live' : 'stale',
    unavailable_fields: nullableFields.filter((field) => stored[field] === null || stored[field] === undefined),
    source: 'tradeagent-account-snapshot',
  }
  if (cache.size >= MAX_ACCOUNT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest) cache.delete(oldest)
  }
  cache.set(accountId, { expiresAt: asOf + ACCOUNT_CACHE_TTL_MS, snapshot })
  return snapshot
}

export function clearAccountRiskCache(): void {
  cache.clear()
  cachedRaw = undefined
  storedById.clear()
}
