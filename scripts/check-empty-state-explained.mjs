#!/usr/bin/env node
/**
 * Empty-state-explained guard — fails if any of the console's "why is this
 * empty" components (`EmptyStateIllustrated`, `ConfigurationRequired`,
 * `EvidenceMissing`, `DataUnavailable` in `src/components/console/states.tsx`)
 * ships with its explanatory prop made OPTIONAL.
 *
 * WHY THIS EXISTS. A title alone ("No runs", "Not configured") reads as a
 * verdict with no reasoning: the reader cannot tell an expected, benign empty
 * result from something they need to go fix. Each of these four components
 * therefore carries a second, REQUIRED prop that names the "why" (`reason`,
 * `description`, `detail`) — this gate greps their prop-type blocks for the
 * `?:` that would make that prop optional and fails if one appears, so a
 * later edit cannot quietly relax the contract back to a bare title.
 *
 * Pure Node, no deps. Run via `npm run check:empty-state-explained`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const STATES = join(ROOT, 'src/components/console/states.tsx')

/** component name → required explanatory prop that must NOT be optional (`propName?:`). */
const CONTRACTS = [
  { component: 'EmptyStateIllustrated', prop: 'reason' },
  { component: 'ConfigurationRequired', prop: 'description' },
  { component: 'EvidenceMissing', prop: 'detail' },
  { component: 'DataUnavailable', prop: 'detail' },
]

function fail(message) {
  console.error(`✗ check:empty-state-explained — ${message}`)
  process.exitCode = 1
}

const source = await readFile(STATES, 'utf8').catch(() => null)
if (source === null) {
  fail(`expected ${STATES} to exist.`)
  process.exit(1)
}

/** Extracts the `export function Name({ ... }: { ... }) {` prop-type block. */
function propBlock(src, component) {
  const start = src.indexOf(`export function ${component}(`)
  if (start === -1) return null
  // Grab a generous window past the opening — these prop-type blocks are all
  // well under 1200 chars in this file.
  return src.slice(start, start + 1600)
}

for (const { component, prop } of CONTRACTS) {
  const block = propBlock(source, component)
  if (block === null) {
    fail(`expected an exported component named ${component} in states.tsx.`)
    continue
  }
  const optional = new RegExp(`\\b${prop}\\?\\s*:`).test(block)
  const required = new RegExp(`\\b${prop}\\s*:`).test(block)
  if (optional) {
    fail(`${component}'s \`${prop}\` prop is optional — a bare title with no "why" is exactly the empty-state defect this gate exists to block.`)
  } else if (!required) {
    fail(`${component} does not declare a required \`${prop}\` prop at all.`)
  }
}

if (process.exitCode !== 1) {
  console.log('✓ check:empty-state-explained — every empty-ish console state requires its explanatory prop.')
}
