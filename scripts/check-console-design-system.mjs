#!/usr/bin/env node
/**
 * Structural guard for the local Aigent console design system — not an aesthetic gate.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const failures = []

async function read(rel) {
  return readFile(join(ROOT, rel), 'utf8')
}

const screenPrimitives = await read('src/components/console/screen-primitives.tsx')
const chartCard = await read('src/components/console/charts/chart-card.tsx')
const theme = await read('src/theme.css')
const statusDot = await read('src/components/ui/status-dot.tsx')
const overviewFiles = [
  'src/components/console/overview/overview-operating-state.tsx',
  'src/components/console/overview/overview-action-queue.tsx',
  'src/components/console/overview/overview-fleet-health.tsx',
  'src/components/console/overview/overview-run-activity.tsx',
  'src/components/console/overview/overview-telemetry-panel.tsx',
  'src/components/console/overview/overview-deliveries.tsx',
  'src/components/console/overview/overview-helpers.ts',
]
const overviewSource = (await Promise.all(overviewFiles.map(read))).join('\n')

// 1. Shared surface chrome must come from console-variants, not be duplicated.
for (const [file, text] of [
  ['screen-primitives.tsx', screenPrimitives],
  ['chart-card.tsx', chartCard],
]) {
  if (text.includes('border-line-strong bg-surface-overlay shadow-[var(--shadow-card-lg)]')) {
    failures.push(`${file} — duplicated primary surface chrome; use consoleSurfaceClasses()`)
  }
  if (text.includes('border-line bg-surface-raised shadow-[var(--shadow-card-sm)]')) {
    failures.push(`${file} — duplicated secondary surface chrome; use consoleSurfaceClasses()`)
  }
}

if (!screenPrimitives.includes("from './console-variants'")) {
  failures.push('screen-primitives.tsx — must import console surface/typography helpers')
}

// 2. Removed dormant tokens must not be referenced.
if (/--ds-/.test(theme.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  failures.push('theme.css — --ds-* aliases must not remain as a dormant contract')
}
const srcScan = [screenPrimitives, chartCard, statusDot, theme]
if (srcScan.some((t) => /\bcopper-\d{2,3}\b/.test(t) || /--color-copper/.test(t))) {
  failures.push('source files still reference the removed copper palette')
}

// 3. Consolidated status-dot must not use raw zinc ring for neutral.
if (/ring-zinc-400/.test(statusDot)) {
  failures.push('status-dot.tsx — neutral tone must use semantic content tokens, not zinc-400')
}

// 4. PanelRow must use client navigation, not a native document <a>.
if (/<a\s+href=/.test(screenPrimitives)) {
  failures.push('screen-primitives.tsx — PanelRow must use Link, not a native <a>')
}

// 5. Feature screens compose the shared grammar; they do not fork it locally.
if (/\boverviewTypography\b/.test(overviewSource)) {
  failures.push('overview — private typography roles are forbidden; use consoleTypography')
}
if (/\bconsolePanelChrome\b/.test(overviewSource)) {
  failures.push('overview — compose Section/KpiCard/PanelRow instead of rebuilding panel chrome')
}

if (failures.length > 0) {
  console.error(`✗ check:console-design-system — ${failures.length} violation(s).\n`)
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}

console.log('✓ check:console-design-system — surface helpers centralized, dormant tokens absent, PanelRow uses Link.')
