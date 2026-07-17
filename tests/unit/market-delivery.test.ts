import { describe, it, expect } from 'vitest'
import {
  buildDeliveryPackage,
  decideStatus,
  computeChecksum,
  type DeliveredManifest,
  type EvidenceSummary,
} from '@/lib/agent-mission-control/market/delivery'

const manifest: DeliveredManifest = {
  id: 'manifest-atlas-v1',
  copilotId: 'copilot-atlas',
  version: 'v1.0.0-draft',
  systemPromptSummary: 'Atlas — market structure analyst.',
  allowedRoutes: ['/api/market/*'],
  forbiddenActions: ['place any market order', 'access a private key'],
  confirmationPolicy: 'risky-only',
  alwaysConfirmActions: [],
  memorySources: [],
  outputContract: { format: 'json', invariants: ['no bare signal'], schemaName: 'TechnicalAnalysisReport' },
  toolIds: ['read_market_snapshot'],
  maxStepsPerRun: 12,
  maxCostPerRunUsd: 0.4,
  updatedAt: '2026-07-18T00:00:00.000Z',
  skills: [{ label: 'Read ETH structure' }],
}

const snapshotEvidence: EvidenceSummary = {
  evidenceLevel: 'SNAPSHOT',
  testsPassed: 20,
  testsTotal: 20,
  securityScore: 1,
  contractCompliance: 1,
  benchmarkGlobal: 0.97,
  gatesBlocked: false,
  blockReasons: [],
  costUsd: 0.12,
  latencyMs: 1800,
}

function build(evidence: EvidenceSummary) {
  return buildDeliveryPackage({
    slug: 'atlas-market-structure',
    name: 'Atlas — Market Structure',
    version: 'v1.0.0-draft',
    model: 'gpt-5.4',
    runtime: 'langgraph',
    manifest,
    outputContractName: 'TechnicalAnalysisReport',
    requiredTools: ['read_market_snapshot'],
    maxLatencyMsTarget: 4000,
    evidence,
    sourceStatus: ['candles: SNAPSHOT', 'accountRisk: UNAVAILABLE'],
    readme: '# Atlas',
    handlerSource: 'export const handler = () => {}',
    builtAt: '2026-07-18T00:00:00.000Z',
    pushedAt: '2026-07-18T00:00:00.000Z',
  })
}

describe('delivery package (Lot 10)', () => {
  it('honest status: SNAPSHOT evidence → DELIVERABLE-SNAPSHOT, never LIVE', () => {
    const pkg = build(snapshotEvidence)
    expect(pkg.status).toBe('DELIVERABLE-SNAPSHOT')
  })

  it('blocked gates → BLOCKED regardless of benchmark', () => {
    expect(
      decideStatus({ ...snapshotEvidence, gatesBlocked: true, blockReasons: ['unsafeAction'] }),
    ).toBe('BLOCKED')
  })

  it('security < 1 → BLOCKED (safety is absolute)', () => {
    expect(decideStatus({ ...snapshotEvidence, securityScore: 0.99 })).toBe('BLOCKED')
  })

  it('SNAPSHOT evidence never yields DELIVERABLE-LIVE', () => {
    expect(decideStatus({ ...snapshotEvidence, evidenceLevel: 'SNAPSHOT' })).not.toBe(
      'DELIVERABLE-LIVE',
    )
  })

  it('produces TradeAgent-intake files + registry entry, activates NOTHING', () => {
    const pkg = build(snapshotEvidence)
    expect(Object.keys(pkg.files)).toContain('agents/atlas-market-structure/manifest.json')
    expect(pkg.registryEntry.source).toBe('aigent')
    expect(pkg.registryEntry.manifestPath).toBe('agents/atlas-market-structure/manifest.json')
    // Import procedure is explicitly human-gated.
    expect(pkg.importProcedure.join(' ')).toMatch(/human operator only/i)
    expect(pkg.rollbackProcedure.length).toBeGreaterThan(0)
  })

  it('checksum is reproducible and changes when a file changes', () => {
    const c1 = computeChecksum({ manifest, files: { a: 'x' } })
    const c2 = computeChecksum({ manifest, files: { a: 'x' } })
    const c3 = computeChecksum({ manifest, files: { a: 'y' } })
    expect(c1).toBe(c2)
    expect(c1).not.toBe(c3)
    expect(c1.startsWith('sha256:')).toBe(true)
  })
})
