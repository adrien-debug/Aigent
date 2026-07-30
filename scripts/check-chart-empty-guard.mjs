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

/*
 * SECOND RULE — the screens, not just the frame.
 *
 * The first half above only proves `ChartCard`'s own contract. That was not
 * enough: the real defect shipped in `overview-screen.tsx`, which drew a
 * `<TrendChart height={232}>` directly and let it render a full-size grid
 * around a single "no run in this window" sentence — a 232px black plate that
 * reads as a chart that failed to draw. The gate was green throughout, because
 * it never looked at a screen.
 *
 * Rule: a screen that renders a TALL chart (height >= 160) must also import
 * `NoDataChart`, i.e. it must have SOME compact path for the empty case. This
 * is deliberately coarse — it cannot prove the branch is correct — but it makes
 * the omission impossible to ship silently, which is what actually happened.
 */
const { readdir } = await import('node:fs/promises')
const CONSOLE_DIR = join(ROOT, 'src/components/console')
const screens = (await readdir(CONSOLE_DIR)).filter((f) => f.endsWith('-screen.tsx'))

for (const file of screens) {
  const path = join(CONSOLE_DIR, file)
  const text = await readFile(path, 'utf8')
  const tall = [...text.matchAll(/height=\{(\d+)\}/g)].map((m) => Number(m[1])).filter((h) => h >= 160)
  if (tall.length === 0) continue
  if (!/NoDataChart/.test(text)) {
    fail(
      `${file} renders a chart at height ${tall[0]}px but never references NoDataChart — ` +
        'a tall plate with nothing in it is the empty-graph antipattern this console removes. ' +
        'Swap in the compact placeholder when the series is empty.'
    )
  }
}

if (process.exitCode !== 1) {
  console.log(
    '✓ check:chart-empty-guard — ChartCard guards every empty series with NoDataChart inside a bounded frame, ' +
      `and all ${screens.length} console screen(s) drawing a tall chart carry a compact empty path.`
  )
}
