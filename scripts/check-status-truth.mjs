#!/usr/bin/env node
/**
 * Status-truth guard — ONE vocabulary per status, in the dashboard.
 *
 * A single agent could read `ACTIVE` on /admin/agents, `ACTIVE` on its detail
 * header and `IDLE` on the project team canvas at the same instant, and none of
 * the three was technically wrong: each component spelled its own labels for a
 * different underlying field (lifecycle `copilots.status`, runtime
 * `AvailableAgent.status`, a canvas-local node state). Three vocabularies in the
 * same visual slot is indistinguishable, for an operator, from three answers.
 *
 * WHAT THIS SCRIPT ACTUALLY CHECKS, stated exactly: no DISPLAY-CASED status
 * literal is written anywhere in the scanned surfaces. That is a text scan. It
 * cannot follow a value to the screen and it does not verify where any rendered
 * word came from — it verifies that no component INVENTS one.
 *
 * WHY THAT IS THE RIGHT RULE HERE. The console renders every status as its raw,
 * lower-case ENUM VALUE, passed straight through from the data:
 * `{agent.status}`, `{agent.lifecycleStatus}`, `{agent.lastRunStatus}`,
 * `{run.status}`, `{copilot.displayStatus ?? copilot.status}`. One field, one
 * spelling, owned by the data. A capitalised literal in these directories is
 * therefore the signature of a SECOND vocabulary being written next to the
 * first — the exact regression above.
 *
 * NO LABEL MODULE EXISTS TODAY. `src/lib/agent-mission-control/labels.ts` was
 * deleted and nothing imports it; an earlier version of this header asserted
 * that every displayed status "comes from" that module, which was false — a
 * green gate whose success sentence describes a file that is not there teaches
 * people to trust a check that proves something else. The success line below is
 * therefore computed from whether that module is on disk, so it can only ever
 * state what is true. If the module is reintroduced it becomes the owner of any
 * display-cased word and this guard keeps components from bypassing it.
 *
 * What is flagged: a quoted `'Active'` / `'ACTIVE'` / `'Draft'` / `'Idle'` /
 * `'Inactive'` / `'Unavailable'` — the DISPLAY casings. All-lowercase spellings
 * (`'active'`, `'draft'`) are the enum VALUES: they are data, they key the
 * tables, they compare against DB columns, and they are deliberately NOT
 * flagged. Comments are skipped: this guard is about what renders.
 *
 * KNOWN BLIND SPOT, recorded rather than hidden: the pattern below lists the
 * five words the surfaces actually contradicted each other on. `'Degraded'`,
 * `'Completed'`, `'Failed'`, `'Running'`, `'Paused'`, `'Archived'` and
 * `'Production'` are equally status words and are NOT matched, so this guard
 * does not claim to catch them. Widening it is a separate mission: it goes red
 * on files outside the current scope.
 *
 * Scope: the dashboard — `src/app/admin/**` and `src/components/console/**`.
 * `src/app/(site)/**` and `src/components/marketing/**` are a separate world by
 * doctrine (AGENTS.md: Tailwind Plus blocks, static vitrine) and are excluded.
 *
 * WHY `src/components/console` IS IN THE LIST. The dashboard's status words are
 * rendered by the console screens, not by the routes — the routes only fetch.
 * Scanning the route layer alone let any status literal live one directory away
 * from the guard: proved, not assumed — `const LABEL = 'Active'` placed in that
 * directory passed before it was added here, and fails after.
 *
 * Exit 0 = clean, exit 1 = violation. Read-only, no network, no secret.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCANNED_DIRS = [join(ROOT, 'src/app/admin'), join(ROOT, 'src/components/console')]

/**
 * Where a shared display vocabulary WOULD live if the dashboard ever needed one.
 *
 * Not an assertion that it exists — its presence is probed at runtime (see
 * `main`) precisely so no message here can outlive the file. It is outside
 * `SCANNED_DIRS`, so it needs no exemption from the walk.
 */
const VOCABULARY_MODULE = 'src/lib/agent-mission-control/labels.ts'

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

/** Is a shared vocabulary module on disk right now? Decides the wording, not the rule. */
async function vocabularyModuleExists() {
  try {
    return (await stat(join(ROOT, VOCABULARY_MODULE))).isFile()
  } catch {
    return false
  }
}

async function main() {
  const violations = []
  const matchedDebt = new Set()

  for (const dir of SCANNED_DIRS) {
    for await (const file of walk(dir)) {
      const rel = relative(ROOT, file)
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
    'display-cased status literal(s) in the dashboard — a status renders as its raw enum ' +
      `value; a display vocabulary, if one is ever needed, belongs in ${VOCABULARY_MODULE} ` +
      'and gets imported, never spelled here'
  )

  const stale = [...KNOWN_DEBT].filter((entry) => !matchedDebt.has(entry))
  report(stale, 'stale known-debt file(s) — no longer violating; delete them from KNOWN_DEBT')

  if (failed) {
    console.error('\nStatus-truth guard FAILED.\n')
    process.exit(1)
  }

  const scanned = SCANNED_DIRS.map((dir) => `${relative(ROOT, dir)}/**`).join(' and ')
  const ownership = (await vocabularyModuleExists())
    ? `${VOCABULARY_MODULE} exists and is the only place a display-cased status word may be written`
    : `no display vocabulary module exists (${VOCABULARY_MODULE} is absent), so every status word on screen is a raw enum value passed through from the data`
  console.log(
    `✓ Status-truth guard passed — no display-cased status literal (${DISPLAY_LITERAL_RE.source}) ` +
      `in ${scanned}; ${ownership} (${KNOWN_DEBT.size} known debt file(s) still exempted).`
  )
}

await main()
