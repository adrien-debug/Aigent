import type { AccountRiskSnapshot } from './account-risk'
import type { DerivativesSnapshot } from './derivatives'
import type { LiquiditySnapshot, VolatilityState } from './snapshot'
import { RISK_THRESHOLDS } from './risk-thresholds'

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical' | 'unavailable'
export type LockRecommendation =
  | 'no_action'
  | 'monitor'
  | 'reduce_exposure'
  | 'increase_collateral'
  | 'lock_withdrawals'
  | 'manual_review'
export type WithdrawalRecommendation =
  | 'approve_for_manual_execution'
  | 'reduce_amount'
  | 'defer'
  | 'reject_for_risk'
  | 'insufficient_data'

export interface RiskAssessment {
  risk_score: number | null
  risk_level: RiskLevel
  leverage_risk: number | null
  liquidity_risk: number | null
  concentration_risk: number | null
  volatility_risk: number | null
  liquidation_risk: number | null
  derivatives_risk: number | null
  withdrawal_risk: number | null
  lock_recommendation: LockRecommendation
  withdrawal_recommendation: WithdrawalRecommendation
  safe_withdrawal_amount_usd: string | null
  impact_on_ltv: string | null
  impact_on_liquidation_buffer: string | null
  reasons: string[]
  unavailable_inputs: string[]
}

function numeric(value?: string | number | null): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function upperRisk(
  value: number | null,
  threshold: { moderate: number; high: number; critical: number },
): number | null {
  if (value === null) return null
  if (value >= threshold.critical) return 100
  if (value >= threshold.high) return 75
  if (value >= threshold.moderate) return 45
  return 10
}

function lowerRisk(
  value: number | null,
  threshold: { moderate: number; high: number; critical: number },
): number | null {
  if (value === null) return null
  if (value <= threshold.critical) return 100
  if (value <= threshold.high) return 75
  if (value <= threshold.moderate) return 45
  return 10
}

function levelOf(score: number): Exclude<RiskLevel, 'unavailable'> {
  if (score >= RISK_THRESHOLDS.score.critical) return 'critical'
  if (score >= RISK_THRESHOLDS.score.high) return 'high'
  if (score >= RISK_THRESHOLDS.score.moderate) return 'moderate'
  return 'low'
}

export function calculateRisk(input: {
  account: AccountRiskSnapshot | null
  spotPrice: string | null
  volatility: VolatilityState | null
  liquidity: LiquiditySnapshot | null
  derivatives: DerivativesSnapshot | null
  requestedWithdrawalUsd?: number | null
}): RiskAssessment {
  const unavailable: string[] = []
  const reasons: string[] = []
  const account = input.account
  if (!account) unavailable.push('account')
  if (input.spotPrice === null) unavailable.push('spot')
  if (!input.volatility) unavailable.push('volatility')
  if (!input.liquidity) unavailable.push('liquidity')
  if (!input.derivatives) unavailable.push('derivatives')

  const leverageRisk = upperRisk(numeric(account?.leverage), RISK_THRESHOLDS.leverage)
  const ltvRisk = upperRisk(numeric(account?.ltv), RISK_THRESHOLDS.ltv)
  const bufferRisk = lowerRisk(
    numeric(account?.liquidation_buffer_pct),
    RISK_THRESHOLDS.liquidationBufferPct,
  )
  const liquidationRisk =
    ltvRisk === null && bufferRisk === null
      ? null
      : Math.max(ltvRisk ?? 0, bufferRisk ?? 0)
  const concentrationRisk = upperRisk(
    numeric(account?.largest_position_pct) ?? numeric(account?.concentration_score),
    RISK_THRESHOLDS.concentrationPct,
  )
  const volatilityRisk = upperRisk(
    numeric(input.volatility?.annualizedPct),
    RISK_THRESHOLDS.volatilityAnnualizedPct,
  )
  const liquidityRisk = upperRisk(
    input.liquidity?.spreadBps ?? null,
    RISK_THRESHOLDS.liquiditySpreadBps,
  )
  const annualizedFunding = numeric(input.derivatives?.annualized_funding_rate)
  const fundingRisk = upperRisk(
    annualizedFunding === null ? null : Math.abs(annualizedFunding),
    RISK_THRESHOLDS.fundingAnnualizedPct,
  )
  const derivativesRisk = input.derivatives?.derivatives_regime === 'unavailable'
    ? null
    : Math.max(
        fundingRisk ?? 0,
        ['crowded_long', 'crowded_short'].includes(input.derivatives?.derivatives_regime ?? '')
          ? 90
          : input.derivatives?.derivatives_regime === 'deleveraging'
            ? 75
            : 10,
      )

  const requested = input.requestedWithdrawalUsd ?? null
  const available = numeric(account?.withdrawal_capacity_usd)
    ?? numeric(account?.available_balance_usd)
  const withdrawalRatio =
    requested !== null && available !== null && available > 0
      ? (requested / available) * 100
      : null
  const withdrawalRisk = upperRisk(
    withdrawalRatio,
    RISK_THRESHOLDS.withdrawalAvailablePct,
  )

  const weighted: Array<[number | null, number, string]> = [
    [leverageRisk, 18, 'leverage'],
    [liquidationRisk, 22, 'liquidation'],
    [concentrationRisk, 15, 'concentration'],
    [volatilityRisk, 12, 'volatility'],
    [liquidityRisk, 10, 'liquidity'],
    [derivativesRisk, 13, 'derivatives'],
    [withdrawalRisk, 10, 'withdrawal'],
  ]
  let totalWeight = 0
  let weightedScore = 0
  for (const [risk, weight, name] of weighted) {
    if (risk === null) {
      unavailable.push(name)
      continue
    }
    totalWeight += weight
    weightedScore += risk * weight
    if (risk >= 75) reasons.push(`${name}_risk_high`)
    else if (risk >= 45) reasons.push(`${name}_risk_moderate`)
  }
  if (account?.risk_flags) reasons.push(...account.risk_flags)

  if (!account || totalWeight === 0) {
    return {
      risk_score: null,
      risk_level: 'unavailable',
      leverage_risk: leverageRisk,
      liquidity_risk: liquidityRisk,
      concentration_risk: concentrationRisk,
      volatility_risk: volatilityRisk,
      liquidation_risk: liquidationRisk,
      derivatives_risk: derivativesRisk,
      withdrawal_risk: withdrawalRisk,
      lock_recommendation: 'manual_review',
      withdrawal_recommendation: 'insufficient_data',
      safe_withdrawal_amount_usd: null,
      impact_on_ltv: null,
      impact_on_liquidation_buffer: null,
      reasons: [...new Set(reasons)],
      unavailable_inputs: [...new Set(unavailable)],
    }
  }

  const riskScore = Math.round(weightedScore / totalWeight)
  const riskLevel = levelOf(riskScore)
  let lockRecommendation: LockRecommendation = 'no_action'
  if (riskLevel === 'critical') lockRecommendation = 'lock_withdrawals'
  else if (liquidationRisk === 100) lockRecommendation = 'increase_collateral'
  else if (riskLevel === 'high') lockRecommendation = 'reduce_exposure'
  else if (riskLevel === 'moderate') lockRecommendation = 'monitor'
  let riskMultiplier = 0.1
  if (riskLevel === 'low') riskMultiplier = 0.75
  else if (riskLevel === 'moderate') riskMultiplier = 0.4
  const safeAmount =
    available === null ? null : Math.max(0, available * riskMultiplier)
  const equity = numeric(account.total_equity_usd)
  const borrowed = numeric(account.borrowed_usd)
  const collateral = numeric(account.collateral_usd)
  const postWithdrawalCollateral =
    requested !== null && collateral !== null ? Math.max(0, collateral - requested) : null
  const postLtv =
    borrowed !== null && postWithdrawalCollateral !== null && postWithdrawalCollateral > 0
      ? borrowed / postWithdrawalCollateral
      : null
  const currentBuffer = numeric(account.liquidation_buffer_pct)
  const postBuffer =
    requested !== null && equity !== null && equity > 0 && currentBuffer !== null
      ? Math.max(0, currentBuffer - (requested / equity) * 100)
      : null
  const withdrawalRecommendation: WithdrawalRecommendation =
    requested === null || available === null
      ? 'insufficient_data'
      : requested > available || riskLevel === 'critical'
        ? 'reject_for_risk'
        : safeAmount !== null && requested > safeAmount
          ? 'reduce_amount'
          : riskLevel === 'high'
            ? 'defer'
            : 'approve_for_manual_execution'

  return {
    risk_score: riskScore,
    risk_level: riskLevel,
    leverage_risk: leverageRisk,
    liquidity_risk: liquidityRisk,
    concentration_risk: concentrationRisk,
    volatility_risk: volatilityRisk,
    liquidation_risk: liquidationRisk,
    derivatives_risk: derivativesRisk,
    withdrawal_risk: withdrawalRisk,
    lock_recommendation: lockRecommendation,
    withdrawal_recommendation: withdrawalRecommendation,
    safe_withdrawal_amount_usd: safeAmount === null ? null : safeAmount.toFixed(2),
    impact_on_ltv: postLtv === null ? null : postLtv.toFixed(4),
    impact_on_liquidation_buffer: postBuffer === null ? null : postBuffer.toFixed(2),
    reasons: [...new Set(reasons)],
    unavailable_inputs: [...new Set(unavailable)],
  }
}
