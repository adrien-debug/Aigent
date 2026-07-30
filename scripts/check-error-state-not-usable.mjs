#!/usr/bin/env node
/**
 * Error-state-not-usable guard — fails if `ErrorStateBlocking`
 * (`src/components/console/states.tsx`) gains a `children` slot.
 *
 * WHY THIS EXISTS. This component's whole job is to make a surface read as
 * UNUSABLE when something failed — `role="alert"`, a dominant danger frame,
 * no dead form or stale table sitting "beside" it implying the screen still
 * half-works. A generic `children` prop is exactly how that guarantee erodes:
 * the moment a caller can drop arbitrary content inside it, some caller will
 * render the broken form right there, and the blocking state starts
 * cohabiting with the thing it was supposed to replace. The prop-type block
 * is checked for a bare `children` key; `retry` (a real, singular action slot)
 * stays allowed.
 *
 * Pure Node, no deps. Run via `npm run check:error-state-not-usable`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const STATES = join(ROOT, 'src/components/console/states.tsx')

function fail(message) {
  console.error(`✗ check:error-state-not-usable — ${message}`)
  process.exitCode = 1
}

const source = await readFile(STATES, 'utf8').catch(() => null)
if (source === null) {
  fail(`expected ${STATES} to exist.`)
  process.exit(1)
}

const start = source.indexOf('export function ErrorStateBlocking(')
if (start === -1) {
  fail('expected an exported ErrorStateBlocking component in states.tsx.')
} else {
  const block = source.slice(start, start + 1200)
  if (/\bchildren\s*\??\s*:/.test(block)) {
    fail('ErrorStateBlocking must not accept a `children` prop — a form or table rendered "beside" a blocking error implies the screen still half-works.')
  }
  if (!/role="alert"/.test(block)) {
    fail('ErrorStateBlocking must render role="alert" — it has to be announced, not just styled red.')
  }
}

if (process.exitCode !== 1) {
  console.log('✓ check:error-state-not-usable — ErrorStateBlocking cannot cohabit with the content it replaces.')
}
