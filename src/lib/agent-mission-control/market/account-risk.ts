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

function normalizeStoredSnapshot(body: unknown, accountId: string): StoredSnapshot | null {
  if (!body || typeof body !== 'object') return null
  const candidate = body as Record<string, unknown>
  if (candidate.account_id !== accountId) return null
  return {
    account_id: accountId,
    wallet_address: typeof candidate.wallet_address === 'string' ? candidate.wallet_address : null,
    total_equity_usd: typeof candidate.total_equity_usd === 'string' ? candidate.total_equity_usd : null,
    available_balance_usd:
      typeof candidate.available_balance_usd === 'string' ? candidate.available_balance_usd : null,
    collateral_usd: typeof candidate.collateral_usd === 'string' ? candidate.collateral_usd : null,
    borrowed_usd: typeof candidate.borrowed_usd === 'string' ? candidate.borrowed_usd : null,
    net_exposure_usd: typeof candidate.net_exposure_usd === 'string' ? candidate.net_exposure_usd : null,
    gross_exposure_usd:
      typeof candidate.gross_exposure_usd === 'string' ? candidate.gross_exposure_usd : null,
    leverage: typeof candidate.leverage === 'string' ? candidate.leverage : null,
    ltv: typeof candidate.ltv === 'string' ? candidate.ltv : null,
    liquidation_buffer_pct:
      typeof candidate.liquidation_buffer_pct === 'string' ? candidate.liquidation_buffer_pct : null,
    unrealized_pnl_usd:
      typeof candidate.unrealized_pnl_usd === 'string' ? candidate.unrealized_pnl_usd : null,
    realized_pnl_usd:
      typeof candidate.realized_pnl_usd === 'string' ? candidate.realized_pnl_usd : null,
    position_count:
      typeof candidate.position_count === 'number' && Number.isFinite(candidate.position_count)
        ? candidate.position_count
        : null,
    largest_position_pct:
      typeof candidate.largest_position_pct === 'string' ? candidate.largest_position_pct : null,
    concentration_score:
      typeof candidate.concentration_score === 'string' ? candidate.concentration_score : null,
    stablecoin_ratio:
      typeof candidate.stablecoin_ratio === 'string' ? candidate.stablecoin_ratio : null,
    btc_exposure_pct:
      typeof candidate.btc_exposure_pct === 'string' ? candidate.btc_exposure_pct : null,
    withdrawal_capacity_usd:
      typeof candidate.withdrawal_capacity_usd === 'string'
        ? candidate.withdrawal_capacity_usd
        : null,
    pending_withdrawals_usd:
      typeof candidate.pending_withdrawals_usd === 'string' ? candidate.pending_withdrawals_usd : null,
    risk_flags: Array.isArray(candidate.risk_flags)
      ? candidate.risk_flags.filter((flag): flag is string => typeof flag === 'string')
      : [],
    source_timestamp:
      typeof candidate.source_timestamp === 'number' && Number.isFinite(candidate.source_timestamp)
        ? candidate.source_timestamp
        : null,
  }
}

async function fetchTradeAgentAccountRisk(accountId: string): Promise<StoredSnapshot | null> {
  const baseUrl = process.env.TRADEAGENT_PORTFOLIO_RISK_URL?.replace(/\/+$/, '')
  const apiKey = process.env.TRADEAGENT_INTERNAL_API_KEY?.trim()
  if (!baseUrl || !apiKey) return null
  try {
    const response = await fetch(`${baseUrl}/${encodeURIComponent(accountId)}`, {
      headers: { 'x-tradeagent-internal-key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })
    if (response.status === 404) return null
    if (!response.ok) {
      console.error(
        '[market/account-risk] TradeAgent portfolio risk fetch failed',
        response.status,
      )
      return null
    }
    const body = await response.json()
    return normalizeStoredSnapshot(body, accountId)
  } catch (error) {
    console.error(
      '[market/account-risk] TradeAgent portfolio risk fetch errored',
      error instanceof Error ? error.message : 'unknown error',
    )
    return null
  }
}

function materializeAccountRiskSnapshot(
  stored: StoredSnapshot,
  asOf: number,
): AccountRiskSnapshot {
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
  return {
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
}

export async function readAccountRisk(
  accountId: string,
  asOf = Date.now(),
): Promise<AccountRiskSnapshot | null> {
  const cached = cache.get(accountId)
  if (cached && cached.expiresAt > asOf) return cached.snapshot
  if (cached) cache.delete(accountId)

  const remote = await fetchTradeAgentAccountRisk(accountId)
  const stored = remote ?? loadConfiguredSnapshots().get(accountId)
  if (!stored) return null
  const snapshot = materializeAccountRiskSnapshot(stored, asOf)
  if (cache.size >= MAX_ACCOUNT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest) cache.delete(oldest)
  }
  cache.set(accountId, { expiresAt: asOf + ACCOUNT_CACHE_TTL_MS, snapshot })
  return snapshot
}
