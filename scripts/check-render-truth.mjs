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
 *     only the metric names below are. Since 31/07/2026 the rule also covers the
 *     DISGUISED form `typeof row.x === 'number' ? row.x : 0`, which is the same
 *     coalescence dressed as a type guard — three shipped on the Qualification
 *     surface, under a comment claiming they refused a false zero. `: null` in
 *     the false branch is the correct shape and stays legal.
 *
 *  2. NaN BY COERCION. `Number(x?.y)` on an optional chain is `NaN` the moment
 *     the chain short-circuits, and `NaN` renders as the literal text "NaN".
 *
 *  3. ABSENCE ASSERTED IN WORDS. A nullable timestamp / metric used as a
 *     truthiness test whose false branch asserts a measurement ("never used",
 *     "none", "0"). Null means nobody wrote it — say so, do not measure it.
 *
 * SCOPE — read this before adding a directory.
 *
 * The guard used to scan three roots: `src/app/admin/**`, `src/lib/runs-console/**`
 * and `src/components/console/**`. The frontend reset deleted the first and the
 * third (AGENTS.md § Frontend). Keeping them listed made the guard announce that
 * it had cleared "the admin surfaces" while opening a third of what it named —
 * exactly the class of green-gate-that-lies this repo has been burned by.
 *
 * It scans `src/lib/runs-console/**`: the run metrics/filters/timeseries layer,
 * which is real, tested code and is what a rebuilt front will read its figures
 * from. When new read surfaces appear, add them HERE — and only once they exist
 * on disk.
 *
 * EXTENDED 31/07/2026 to the cockpit, now that it exists on disk:
 *   · `src/lib/cockpit/**`        — the pure derivations (buckets, named runs,
 *     agent cards) that turn `windowRuns` into what the screen draws. This is
 *     where a `null` window would get flattened into a calm-looking zero.
 *   · `src/components/cockpit/**` — the render surface itself, Recharts
 *     included. The 26/07/2026 `NaN` shipped from exactly this kind of module.
 *
 * EXTENDED again 31/07/2026 to the three surfaces of the restoration:
 *   · `src/components/runs/**`, `src/components/agents/**`,
 *     `src/components/projects/**` — they landed reading real aggregates, and
 *     the guard was passing GREEN over them without having scanned a single
 *     line. Two of the agents that built them flagged the hole themselves.
 *
 * Still NOT scanned, and it matters: the big aggregators
 * `dashboard-overview.ts`, `agent-detail.ts` and `data.ts`. They feed the
 * cockpit, so a fabricated zero born there arrives here already laundered and
 * this guard cannot see it. Extending to them is a separate mission — they are
 * large, and the metric-name list would need auditing against their contracts
 * first. Do not claim this guard covers them.
 *
 * ANTI-BLINDNESS: a scan root that has vanished, or a run that opened zero files,
 * FAILS. A guard that measured nothing must never exit 0 silently.
 *
 * Exit 0 = clean, exit 1 = violation. Read-only, no network, no secret.
 */
import { readFile, readdir, access } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRS = [
  join(ROOT, 'src/lib/runs-console'),
  join(ROOT, 'src/lib/cockpit'),
  join(ROOT, 'src/components/cockpit'),
  join(ROOT, 'src/components/runs'),
  join(ROOT, 'src/components/agents'),
  join(ROOT, 'src/components/projects'),
  join(ROOT, 'src/components/builder'),
  join(ROOT, 'src/components/qualification'),
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
  // Compteurs de PREUVE de la surface Qualification. Ce sont des mesures au
  // même titre qu'un score : `would_mutate_count = 0` est lu comme « le shadow
  // a intercepté toutes les mutations », donc une colonne jamais écrite
  // retombée à 0 délivre un certificat d'innocuité que personne n'a mesuré.
  // Les deux graphies sont listées : ces champs traversent la frontière
  // PostgREST, où la ligne brute est encore en snake_case.
  'sampledRunCount',
  'sampled_run_count',
  'wouldMutateCount',
  'would_mutate_count',
  'caseCount',
  'case_count',
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

/**
 * The `?? 0` WEARING A TYPE GUARD'S CLOTHES.
 *
 *     sampledRunCount: typeof row.sampled_run_count === 'number' ? row.sampled_run_count : 0
 *
 * Semantically identical to `row.sampled_run_count ?? 0` — a NULL column becomes
 * a confident zero — but it reads as a careful narrowing, which is exactly why
 * it survived review. The Qualification surface shipped three of these, one of
 * them on `would_mutate_count`, under a comment claiming the code refused a
 * false zero.
 *
 * The false branch is what the rule turns on, and only `0` is banned there:
 *   · `: null`      → the honest fix, and the shape this guard wants to see;
 *   · `: undefined` → not a measurement either, left alone;
 *   · `: 0`         → a fabricated measurement. Red.
 *
 * The metric name is required on the LEFT of the `typeof`, so ordinary
 * narrowings (`typeof node.width === 'number' ? node.width : 0` — geometry) are
 * not matched. The operand is matched loosely (`[^\n]*?`) because the guarded
 * expression and the returned expression are written many ways, and requiring
 * them to be textually identical would let a one-character difference walk
 * straight through.
 */
const TYPEOF_GUARD_TO_ZERO_RE = new RegExp(
  String.raw`typeof\s+[^\n]*?\.(?:${alt(METRIC_FIELDS)})\b[^\n]*?===\s*['"]number['"][^\n]*?\?[^\n]*?:\s*0\b`
)

/**
 * The ONE legitimate `?? 0` on a metric: seeding a RUNNING SUM.
 *
 *     card.costUsd = (card.costUsd ?? 0) + run.costUsd
 *
 * Why this is not the banned coalescence. The banned shape takes an unmeasured
 * value and publishes 0 as if it were the measurement. This shape does the
 * opposite: the accumulator is seeded `null`, each `?? 0` is reached only after
 * the caller has PROVEN the incoming value is measured, and if nothing is ever
 * measured the field is never assigned and stays `null`. The zero is an
 * arithmetic identity for `+`, never a claim about the metric.
 *
 * The pattern is deliberately tight — it requires the SAME metric name on both
 * sides of `=` and an `+` immediately after the parenthesis. It therefore still
 * fails on the dangerous look-alikes, each verified by probe:
 *   · `card.costUsd = other.costUsd ?? 0`        (no accumulation → red)
 *   · `card.costUsd = (card.costUsd ?? 0)`       (no `+`          → red)
 *   · `total.costUsd = (card.costUsd ?? 0) + x`  (different field → red)
 *
 * It does NOT verify the caller's guard — that stays a human reading. What it
 * guarantees is that the only exempted shape is one that cannot publish a zero.
 */
const RUNNING_SUM_RE = new RegExp(
  String.raw`([\w$]+(?:\.[\w$]+)*\.(?:${alt(METRIC_FIELDS)}))\s*=\s*\(\s*\1\s*(?:\?\?|\|\|)\s*0\s*\)\s*\+`
)
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
const KNOWN_DEBT = new Set([])

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
  let scannedFiles = 0

  for (const dir of SCANNED_DIRS) {
    // Anti-cécité 1/2 : une racine de scan disparue fait ÉCHOUER la gate.
    // Sans ça, supprimer un répertoire suffirait à rendre ce garde vert.
    try {
      await access(dir)
    } catch {
      console.error(`\n✗ Render-truth guard FAILED — scan root missing: ${relative(ROOT, dir)}`)
      console.error(
        "  Une gate ne doit jamais passer au vert parce que sa cible a disparu.\n" +
          "  Si ce répertoire a été supprimé volontairement, retire-le de SCANNED_DIRS\n" +
          '  dans ce script, en connaissance de cause.\n'
      )
      process.exit(1)
    }

    for await (const file of walk(dir)) {
      scannedFiles += 1
      const rel = relative(ROOT, file)
      const text = await readFile(file, 'utf8')

      stripComments(text).forEach((line, i) => {
        const record = (bucket) => {
          if (KNOWN_DEBT.has(rel)) matchedDebt.add(rel)
          else bucket.push(`${rel}:${i + 1}  ${line.trim()}`)
        }
        if (METRIC_TO_ZERO_RE.test(line) && !RUNNING_SUM_RE.test(line)) record(metricToZero)
        if (TYPEOF_GUARD_TO_ZERO_RE.test(line)) record(metricToZero)
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

  // Anti-cécité 2/2 : les racines existaient mais n'ont rendu aucun fichier.
  if (scannedFiles === 0) {
    console.error('\n✗ Render-truth guard FAILED — 0 fichier scanné.')
    console.error("  Les racines existent mais sont vides : cette gate n'a rien mesuré.\n")
    process.exit(1)
  }

  const roots = SCANNED_DIRS.map((d) => relative(ROOT, d)).join(', ')
  console.log(
    `✓ Render-truth guard passed — no fabricated zero, no NaN coercion and no asserted absence.\n` +
      `  ${scannedFiles} fichier(s) scanné(s) dans ${roots} (${KNOWN_DEBT.size} known debt file(s) exempted).`
  )
}

// Run the scan only when this file IS the entry point — a bare top-level
// `await main()` would make any importer of `stripComments` silently run this
// guard, and inherit its process.exit(1).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
