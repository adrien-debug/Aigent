#!/usr/bin/env node
/**
 * Status-truth guard — ONE vocabulary for agent status, in ONE file.
 *
 * A single agent could read `ACTIVE` on /admin/agents, `ACTIVE` on its detail
 * header and `IDLE` on the project team canvas at the same instant, and none of
 * the three was technically wrong: each component spelled its own labels for a
 * different underlying field (lifecycle `copilots.status`, runtime
 * `AvailableAgent.status`, a canvas-local node state). Three vocabularies in the
 * same visual slot is indistinguishable, for an operator, from three answers.
 *
 * The rule: a DISPLAYED status label may only come from
 * `src/lib/agent-mission-control/labels.ts`. A component imports the table; it
 * never writes the word.
 *
 * What is flagged: a quoted `'Active'` / `'ACTIVE'` / `'Draft'` / `'Idle'` /
 * `'Inactive'` / `'Unavailable'` — the DISPLAY casings. All-lowercase spellings
 * (`'active'`, `'draft'`) are the enum VALUES: they are data, they key the
 * tables, they compare against DB columns, and they are deliberately NOT
 * flagged. Comments are skipped: this guard is about what renders.
 *
 * Scope: the dashboard — `src/app/admin/**`. `src/app/(site)/**` and
 * `src/components/marketing/**` are a separate world by doctrine (AGENTS.md:
 * Tailwind Plus blocks, static vitrine) and are excluded.
 *
 * Exit 0 = clean, exit 1 = violation. Read-only, no network, no secret.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRS = [join(ROOT, 'src/app/admin')]

/** The file that OWNS every status label. */
const LABELS_MODULE = 'src/lib/agent-mission-control/labels.ts'

/**
 * The five statuses the surfaces actually contradicted each other on, in their
 * DISPLAY casings only. Capitalised or upper-case ⇒ it is being shown to a
 * human ⇒ it belongs in `labels.ts`.
 */
const DISPLAY_LITERAL_RE =
  /(['"])(ACTIVE|DRAFT|IDLE|INACTIVE|UNAVAILABLE|Active|Draft|Idle|Inactive|Unavailable)\1/

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
 * Comments quote labels to explain them — including the `{/* … *\/}` blocks that
 * document why a column is sized for "UNAVAILABLE". They render nothing, so
 * flagging them would train everyone to stop explaining their code.
 */
function stripComments(text) {
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
  const violations = []
  const matchedDebt = new Set()

  for (const dir of SCANNED_DIRS) {
    for await (const file of walk(dir)) {
      const rel = relative(ROOT, file)
      if (rel === LABELS_MODULE) continue
      const text = await readFile(file, 'utf8')

      stripComments(text).forEach((line, i) => {
        if (!DISPLAY_LITERAL_RE.test(line)) return
        if (KNOWN_DEBT.has(rel)) matchedDebt.add(rel)
        else violations.push(`${rel}:${i + 1}  ${line.trim()}`)
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

  report(
    violations,
    `agent status label(s) written outside ${LABELS_MODULE} — import the table, never spell the word`
  )

  const stale = [...KNOWN_DEBT].filter((entry) => !matchedDebt.has(entry))
  report(stale, 'stale known-debt file(s) — no longer violating; delete them from KNOWN_DEBT')

  if (failed) {
    console.error('\nStatus-truth guard FAILED.\n')
    process.exit(1)
  }
  console.log(
    `✓ Status-truth guard passed — every displayed agent status comes from ${LABELS_MODULE} (${KNOWN_DEBT.size} known debt file(s) still exempted).`
  )
}

await main()
