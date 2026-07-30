#!/usr/bin/env node
/**
 * Chart empty-guard — fails if `ChartCard` (or any container in
 * `src/components/console/charts/**`) can render a tall, chart-shaped plate
 * with no path that swaps in `NoDataChart` for an empty series.
 *
 * WHY THIS EXISTS. A big fixed-height rectangle rendered unconditionally is
 * the exact "empty graph" antipattern: it looks like a chart failed to draw
 * rather than a chart that has nothing to plot. `ChartCard` is the console's
 * one sanctioned frame for this, and its contract is that it must (a) accept
 * an `isEmpty` signal and (b) actually reference `NoDataChart` when it is
 * true. This gate checks both, textually, against the real source.
 *
 * Pure Node, no deps. Run via `npm run check:chart-empty-guard`.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()
const CHART_CARD = join(ROOT, 'src/components/console/charts/chart-card.tsx')

function fail(message) {
  console.error(`✗ check:chart-empty-guard — ${message}`)
  process.exitCode = 1
}

const source = await readFile(CHART_CARD, 'utf8').catch(() => null)
if (source === null) {
  fail(`expected ${CHART_CARD} to exist — the console's chart frame contract lives there.`)
  process.exit(1)
}

if (!/isEmpty\s*:\s*boolean/.test(source)) {
  fail('ChartCard must declare a required `isEmpty: boolean` prop — an inferred/optional signal lets an empty series slip through unguarded.')
}

if (!/import\s*\{\s*NoDataChart\s*\}\s*from\s*['"]\.\/no-data-chart['"]/.test(source)) {
  fail('ChartCard must import NoDataChart from ./no-data-chart.')
}

// The render must actually branch on isEmpty and mention NoDataChart in that branch,
// not just import it unused.
const ternaryGuard = /isEmpty\s*\?\s*<NoDataChart/.test(source)
const ifGuard = /if\s*\(\s*isEmpty\s*\)[\s\S]{0,120}<NoDataChart/.test(source)
if (!ternaryGuard && !ifGuard) {
  fail('ChartCard must render <NoDataChart /> on the isEmpty branch — found isEmpty and NoDataChart but no guard wiring them together.')
}

if (!/max-h-/.test(source)) {
  fail('ChartCard body must carry a bounded max-h- rung — an unbounded chart frame grows with its data, which this console never allows.')
}

if (process.exitCode !== 1) {
  console.log('✓ check:chart-empty-guard — ChartCard guards every empty series with NoDataChart, inside a bounded frame.')
}
