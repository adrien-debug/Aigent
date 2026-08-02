/**
 * Local E2E proof for Tool Builder core pipeline:
 * mission creation -> validation -> sandbox execution -> persistable row
 * (simulated in-memory) -> certification only after successful execution.
 */
import { randomUUID } from 'node:crypto'

import { advanceToolBuildMission } from '@/lib/agent-mission-control/tool-builder/advance'
import { startToolBuild } from '@/lib/agent-mission-control/tool-builder/mission'
import { TOOL_BUILDER_FIXTURES } from '@/lib/agent-mission-control/tool-builder/fixtures'

interface InMemoryRow {
  id: string
  toolId: string
  state: string
  rejectionReason: string | null
  evidence: unknown
}

async function runOne(label: string, fixture: (typeof TOOL_BUILDER_FIXTURES)[keyof typeof TOOL_BUILDER_FIXTURES]) {
  const missionId = randomUUID()
  const started = startToolBuild(fixture)
  const advanced = await advanceToolBuildMission(started)
  const row: InMemoryRow = {
    id: missionId,
    toolId: fixture.id,
    state: advanced.state,
    rejectionReason: advanced.rejectionReason,
    evidence: advanced.evidence,
  }
  return { label, row }
}

async function main() {
  const inMemoryStore: InMemoryRow[] = []
  const results = await Promise.all([
    runOne('deterministic-valid', TOOL_BUILDER_FIXTURES.deterministicValid),
    runOne('deterministic-invalid', TOOL_BUILDER_FIXTURES.deterministicInvalid),
    runOne('sandbox-unavailable', TOOL_BUILDER_FIXTURES.sandboxUnavailable),
  ])

  for (const result of results) {
    inMemoryStore.push(result.row)
  }

  const certified = inMemoryStore.find((row) => row.toolId === TOOL_BUILDER_FIXTURES.deterministicValid.id)
  const invalid = inMemoryStore.find((row) => row.toolId === TOOL_BUILDER_FIXTURES.deterministicInvalid.id)
  const unavailable = inMemoryStore.find((row) => row.toolId === TOOL_BUILDER_FIXTURES.sandboxUnavailable.id)

  if (!certified || !invalid || !unavailable) {
    throw new Error('missing fixture results in memory store')
  }
  if (certified.state !== 'CERTIFIED') {
    throw new Error(`expected deterministic-valid to certify, got ${certified.state}`)
  }
  if (invalid.state !== 'REJECTED') {
    throw new Error(`expected deterministic-invalid to reject, got ${invalid.state}`)
  }
  if (unavailable.state !== 'REJECTED') {
    throw new Error(`expected sandbox-unavailable to reject, got ${unavailable.state}`)
  }

  console.log('[tool-builder-e2e] PASS')
  console.log(JSON.stringify({ results, persistedRows: inMemoryStore.length }, null, 2))
}

main().catch((error) => {
  console.error('[tool-builder-e2e] FAIL', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
