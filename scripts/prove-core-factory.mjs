#!/usr/bin/env node
/**
 * AIGENT-CORE-FACTORY-035 — deterministic proof of the new core's authoring gate.
 *
 * Proves, WITHOUT any live LLM/network call, that the canonical registry is the
 * single authority on executability and that the manifest validator refuses a
 * phantom capability at authoring time (NEEDS_TOOL) instead of letting it become
 * a silent run-time "no data". This is the part of the E2E proof that is fully
 * deterministic; the LIVE LangGraph run (a billed OpenAI call against the local
 * Agent Server) is the separate, stack-dependent half.
 *
 * Run: npx tsx scripts/prove-core-factory.mjs   (no secrets, no network)
 */
import { REGISTRY_HASH } from '../src/lib/agent-mission-control/registry/index.ts'
import { RUNTIME_IDS, getRuntime } from '../src/lib/agent-mission-control/registry/runtimes.ts'
import { TOOL_IDS, getTool } from '../src/lib/agent-mission-control/registry/tools.ts'
import { validateManifestAgainstRegistry } from '../src/lib/agent-mission-control/registry/manifest-validation.ts'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

console.log('AIGENT-CORE-FACTORY-035 — core authoring-gate proof\n')

console.log('1. Registry is the single authority')
check('registry hash is stable 8-hex', /^[0-9a-f]{8}$/.test(REGISTRY_HASH), REGISTRY_HASH)
check('exactly one executable runtime (langgraph)',
  RUNTIME_IDS.filter((id) => getRuntime(id).engine !== 'none').join(',') === 'langgraph')
check('all declared tools are certified + read-only',
  TOOL_IDS.every((id) => getTool(id).certification === 'certified' && getTool(id).mutates === false),
  `${TOOL_IDS.length} tools`)

console.log('\n2. A certified manifest validates + is provisionable')
const good = validateManifestAgainstRegistry('langgraph', [
  { id: 'read_recent_runs' },
  { id: 'read_copilot_summary' },
])
check('ok === true', good.ok === true)
check('no missing required', good.missingRequired.length === 0)
check('no blockers', good.blockers.length === 0)

console.log('\n3. A phantom REQUIRED tool is refused at authoring time (NEEDS_TOOL)')
const phantom = validateManifestAgainstRegistry('langgraph', [{ id: 'wire_transfer_funds' }])
check('ok === false', phantom.ok === false)
check('phantom listed as missingRequired', phantom.missingRequired.includes('wire_transfer_funds'))
check('resolution === phantom',
  phantom.tools.find((t) => t.id === 'wire_transfer_funds')?.resolution === 'phantom')

console.log('\n4. An OPTIONAL phantom degrades instead of blocking')
const degraded = validateManifestAgainstRegistry('langgraph', [
  { id: 'read_recent_runs' },
  { id: 'nice_to_have_capability', optional: true },
])
check('no missing required', degraded.missingRequired.length === 0)
check('degradable === true', degraded.degradable === true)
check('optional gap surfaced', degraded.missingOptional.includes('nice_to_have_capability'))

console.log('\n5. A runtime with no real engine is refused')
const badRuntime = validateManifestAgainstRegistry('custom', [{ id: 'read_recent_runs' }])
check('ok === false', badRuntime.ok === false)
check('runtime not executable', badRuntime.runtime.executable === false)

console.log('')
if (failures > 0) {
  console.error(`✗ PROOF FAILED — ${failures} assertion(s) did not hold.`)
  process.exit(1)
}
console.log('✓ CORE AUTHORING-GATE PROOF PASSED — registry authority + eager NEEDS_TOOL refusal hold.')
