#!/usr/bin/env node
/**
 * Render-truth guard — keeps an ABSENCE from being rendered as a MEASUREMENT.
 *
 * The data layer already distinguishes "not measured" from "measured as
 * nothing" (`unavailableFields`, `healthUnavailableFields`, every `| null` in
 * `agent-detail.ts`). The lie was reintroduced one line before the pixels: a
 * `?? 0` on a metric, a `Number(x?.y)` that yields `NaN`, a ternary whose false
 * branch says "never used" about a column nothing ever writes. The Performance
 * page shipped `OPEN WARNINGS / NaN / across 0 of 4 agents`; the Observability
 * page told operators a tool had never run because the runner never wrote
 * `tools.last_used_at`.
 *
 * Three checks, each on a concrete COALESCENCE, never on a vocabulary. Writing
 * the word `null`, comparing to `null`, or defaulting a layout number to 0 is
 * all perfectly fine — what is banned is turning an unmeasured value into a
 * confident number or a confident sentence.
 *
 *  1. METRIC COALESCED TO ZERO. `x.successRate ?? 0`, `run.costUsd || 0` — the
 *     left side is a NAMED measurement from the contracts, and 0 is a claim
 *     about it. Counters, map lookups and geometry defaults are not matched:
 *     only the metric names below are.
 *
 *  2. NaN BY COERCION. `Number(x?.y)` on an optional chain is `NaN` the moment
 *     the chain short-circuits, and `NaN` renders as the literal text "NaN".
 *
 *  3. ABSENCE ASSERTED IN WORDS. A nullable timestamp / metric used as a
 *     truthiness test whose false branch asserts a measurement ("never used",
 *     "none", "0"). Null means nobody wrote it — say so, do not measure it.
 *
 * Scope: the surfaces users actually read — `src/app/admin/**`,
 * `src/components/agent-ops/**`, `src/components/views/**` (the
 * catalyst-in-layers migration moved page-level render logic here — see the
 * migration plan) and `src/components/shell/**`. Exit 0 = clean, exit 1 =
 * violation. Read-only, no network, no secret.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRS = [
  join(ROOT, 'src/app/admin'),
  join(ROOT, 'src/app/admin-v2'),
  join(ROOT, 'src/components/aigent-v2'),
  join(ROOT, 'src/components/agent-ops'),
  join(ROOT, 'src/components/views'),
  join(ROOT, 'src/components/shell'),
]

/**
 * Field names that ARE measurements in this codebase's contracts (`types.ts`,
 * `agent-detail.ts`, `available-agents.ts`). Kept as an explicit list rather
 * than a shape heuristic: `counts.get(id) ?? 0` is a correct accumulator and
 * `node.width ?? 0` is geometry — neither is a measurement about an agent.
 */
const METRIC_FIELDS = [
  'successRate',
  'passRate',
  'testPassRate',
  'benchmarkScore',
  'shadowAgreement',
  'avgLatencyMs',
  'latencyMs',
  'avgDurationMs',
  'costUsd',
  'cost24hUsd',
  'costLast24hUsd',
  'lastRunCostUsd',
  'totalCostLast24hUsd',
  'runsLast24h',
  'errorRateLast24h',
  'errorRateLast7d',
  'callsLast7d',
  'toolCallCount',
  'unsafeAttemptCount',
  'unsafeActionCount',
  'tokensIn',
  'tokensOut',
]

/** Nullable "when did this happen" fields — null means nobody wrote the column. */
const NULLABLE_FACT_FIELDS = [
  'lastUsedAt',
  'lastRunAt',
  'lastErrorAt',
  'lastActivityAt',
  'latestActivityAt',
  'finishedAt',
  'scannedAt',
  'executedModel',
  'resolvedModel',
  ...METRIC_FIELDS,
]

/** False-branch strings that ASSERT a measurement instead of reporting absence. */
const ASSERTION_LITERALS = [
  'never used',
  'never run',
  'never called',
  'never',
  'not used',
  'no runs',
  'no run',
  'no data',
  'none',
  '0',
  'up to date',
]

const alt = (names) => names.join('|')

const METRIC_TO_ZERO_RE = new RegExp(String.raw`\.(?:${alt(METRIC_FIELDS)})\b[^\n]*?(?:\?\?|\|\|)\s*0\b`)
const NAN_COERCION_RE = /Number\([^)]*\?\./
const ASSERTED_ABSENCE_RE = new RegExp(
  String.raw`\.(?:${alt(NULLABLE_FACT_FIELDS)})\b[^\n]*\?[^\n]*:\s*['"](?:${alt(ASSERTION_LITERALS)})['"]`,
  'i'
)

/**
 * Known debt this guard DELIBERATELY does not fail on yet, because the fix
 * belongs to a file another mission owns.
 *
 * Scoped to the FILE, not the line: line numbers rot the moment anyone edits
 * above them, and a guard that goes red on an unrelated edit gets disabled
 * rather than obeyed. Shrink-only by construction — the guard also fails when a
 * listed file stops violating, so a migrated file cannot leave a stale blanket
 * exemption behind to cover the next regression.
 */
const KNOWN_DEBT = new Set([
  // AIGENT-UI-TRUTH-026 wave 2 — a run whose tool calls were never counted is
  // not a run with zero tool calls. Relocated from
  // src/app/admin/agents/[id]/runs/page.tsx by the catalyst-in-layers
  // migration (page.tsx is now a thin data+View shell; this render logic
  // moved to the view file verbatim — see the migration plan).
  'src/components/views/agents/agent-runs-view.tsx',
])

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full
    }
  }
}

/**
 * Blank out comments while preserving line numbering.
 *
 * Comments here carry the counter-examples ("`?? 0` on a metric") that explain
 * the rule; flagging them would train everyone to stop explaining their code.
 * Covers the `{/* … *\/}` JSX blocks too.
 */
export function stripComments(text) {
  const out = []
  let inBlock = false
  for (const raw of text.split('\n')) {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) {
        out.push('')
        continue
      }
      line = ' '.repeat(end + 2) + line.slice(end + 2)
      inBlock = false
    }
    // Single-line block comments first, so an opener that also closes on the
    // same line does not flip the flag.
    line = line.replace(/\/\*[\s\S]*?\*\//g, ' ')
    const open = line.indexOf('/*')
    if (open !== -1) {
      line = line.slice(0, open)
      inBlock = true
    }
    const lineComment = line.indexOf('//')
    if (lineComment !== -1) line = line.slice(0, lineComment)
    out.push(line)
  }
  return out
}

async function main() {
  const metricToZero = []
  const nanCoercions = []
  const assertedAbsence = []
  const matchedDebt = new Set()

  for (const dir of SCANNED_DIRS) {
    for await (const file of walk(dir)) {
      const rel = relative(ROOT, file)
      const text = await readFile(file, 'utf8')

      stripComments(text).forEach((line, i) => {
        const record = (bucket) => {
          if (KNOWN_DEBT.has(rel)) matchedDebt.add(rel)
          else bucket.push(`${rel}:${i + 1}  ${line.trim()}`)
        }
        if (METRIC_TO_ZERO_RE.test(line)) record(metricToZero)
        if (NAN_COERCION_RE.test(line)) record(nanCoercions)
        if (ASSERTED_ABSENCE_RE.test(line)) record(assertedAbsence)
      })
    }
  }

  let failed = false
  const report = (items, title) => {
    if (items.length === 0) return
    failed = true
    console.error(`\n✗ ${items.length} ${title}:\n`)
    for (const item of items) console.error('  ' + item)
  }

  report(metricToZero, 'measurement(s) coalesced to 0 — an unmeasured metric is not a zero')
  report(nanCoercions, 'Number() coercion(s) over an optional chain — renders the text "NaN"')
  report(assertedAbsence, 'absence(s) asserted in words — an unwritten column is not a measurement')

  const stale = [...KNOWN_DEBT].filter((entry) => !matchedDebt.has(entry))
  report(stale, 'stale known-debt file(s) — no longer violating; delete them from KNOWN_DEBT')

  if (failed) {
    console.error('\nRender-truth guard FAILED.\n')
    process.exit(1)
  }
  console.log(
    `✓ Render-truth guard passed — no fabricated zero, no NaN coercion and no asserted absence in the admin surfaces (${KNOWN_DEBT.size} known debt file(s) still exempted).`
  )
}

// Run the scan only when this file IS the entry point. `stripComments` is
// imported by scripts/check-catalyst.mjs (one comment-stripper for both guards,
// not two that drift); a bare top-level `await main()` would make that guard
// silently run this one — and inherit its process.exit(1).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
