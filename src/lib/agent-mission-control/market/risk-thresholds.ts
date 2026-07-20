export const RISK_THRESHOLDS = Object.freeze({
  leverage: { moderate: 1.5, high: 2.5, critical: 4 },
  ltv: { moderate: 0.5, high: 0.7, critical: 0.85 },
  liquidationBufferPct: { moderate: 35, high: 20, critical: 10 },
  concentrationPct: { moderate: 35, high: 55, critical: 75 },
  volatilityAnnualizedPct: { moderate: 55, high: 80, critical: 120 },
  liquiditySpreadBps: { moderate: 5, high: 12, critical: 25 },
  fundingAnnualizedPct: { moderate: 10, high: 25, critical: 50 },
  unrealizedLossEquityPct: { moderate: 5, high: 12, critical: 25 },
  netExposureEquityMultiple: { moderate: 1, high: 2, critical: 3.5 },
  withdrawalAvailablePct: { moderate: 25, high: 50, critical: 80 },
  score: { moderate: 25, high: 50, critical: 75 },
})
