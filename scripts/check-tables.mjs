#!/usr/bin/env node
/**
 * Table guard — three defects the Catalyst `Table` primitive cannot prevent on
 * its own, because each of them is a relationship BETWEEN two elements that the
 * caller writes independently.
 *
 * Scope: the dashboard only (src/app/admin/**, src/components/agent-ops/**,
 * src/components/views/**, src/components/shell/**), never src/components/ui/**
 * (the primitive owns the native markup) and never the marketing site, which
 * writes plain <table> by design.
 *
 * ── 1. `sticky top-*` on a TableHead requires `fixed` on the Table ───────────
 * Documented at the source, in src/components/ui/table.tsx: a non-`fixed`
 * `Table` wraps the <table> in an `overflow-x-auto` scrollport. CSS computes
 * `overflow-y` to `auto` as soon as `overflow-x` is not `visible`, so that
 * wrapper becomes a vertical scroll container too — and a `position: sticky`
 * header sticks to ITS nearest scrollport, which is that inner wrapper, not the
 * caller's own `overflow-y-auto` box. The header therefore scrolls away with the
 * rows: the class list says "sticky", the pixels say otherwise. `fixed` drops
 * the scrollport (a `table-fixed w-full` table can never overflow horizontally),
 * which is what makes the header actually stick.
 *
 * ── 2. `hover:bg-*` on a TableRow requires `href` ────────────────────────────
 * The primitive already paints a hover fill on `<td>`/`<th>` — but ONLY when the
 * row is navigable, i.e. carries an `href` that renders the full-cell link. A
 * hand-written `hover:bg-*` on a row without `href` lights up under the cursor
 * and promises a click target that does not exist. It is also a lie to keyboard
 * users, who get no focus affordance at all.
 *
 * ── 3. A responsive cell must share its header's breakpoint ──────────────────
 * `hidden md:table-cell` on a <td> whose <th> says `hidden lg:table-cell` means
 * that between `md` and `lg` the body row has one more cell than the header row.
 * Every column after it shifts by one — the values land under the wrong titles,
 * at exactly the widths nobody tests at. Compared index by index against the
 * header row of the same table.
 *
 * Pure Node, no deps, no browser: all three are decidable from the source.
 * Run via `npm run check:tables`.
 *
 *   `--only=<sub>`  restricts the scan to paths containing <sub>. Meant for
 *                   fixing one file at a time and for probing the gate on a
 *                   fixture; CI takes no argument and scans the whole perimeter.
 *
 * ── What this gate does NOT guarantee ───────────────────────────────────────
 * See scripts/README-gates.md for the full blind-spot map. In short: it reads
 * SOURCE, so a table assembled from a variable className, a `fixed={someProp}`,
 * or a wrapper whose overflow is decided at runtime is invisible to it. It also
 * says nothing about whether a sticky header that IS fixed-backed actually
 * looks right — only that the CSS precondition holds.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SRC = join(ROOT, 'src')
const ALLOWLIST_PATH = join(HERE, 'table-guard-allowlist.json')

const DASHBOARD_DIRS = [
  join('app', 'admin'),
  join('components', 'admin-dashboard'),
  join('components', 'admin-shell'),
  join('components', 'runs-console'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]
const EXCLUDE_DIRS = [join('components', 'ui')]

/** Elements that carry table semantics — everything else is structural noise. */
const TABLE_TAGS = new Set(['Table', 'TableHead', 'TableBody', 'TableRow', 'TableHeader', 'TableCell'])

// A bare `fixed` prop, not the `table-fixed` utility that lives inside a
// className: the latter is preceded by `-`, the former by whitespace or `<`.
// Always applied to `propSlots()` output, never to the raw attribute text — see
// there for the false NEGATIVE this closes.
const FIXED_PROP_RE = /(?:^|\s)fixed(?![\w-])/
const HREF_PROP_RE = /(?:^|\s)href\s*=/
// A cell that spans several columns breaks the index-by-index comparison the
// column rule is built on: header 3 no longer faces cell 3. The rule abstains
// on such a row rather than invent a mismatch.
const SPAN_PROP_RE = /(?:^|\s)(?:colSpan|rowSpan)\s*=/
// Class tokens. Variants are allowed to prefix any of them (`dark:`, `md:`, …),
// which is why each pattern anchors on the utility rather than on the token.
const STICKY_CLASS_RE = /^(?:[\w[\]&>.-]+:)*sticky$/
const TOP_CLASS_RE = /^(?:[\w[\]&>.-]+:)*top-/
const HOVER_BG_CLASS_RE = /(?:^|:)hover:bg-/
const HIDDEN_CLASS_RE = /^(?:[\w[\]&>.-]+:)*hidden$/
const RESPONSIVE_CELL_RE = /^(sm|md|lg|xl|2xl):table-cell$/

function isDashboardFile(relPath) {
  return DASHBOARD_DIRS.some((dir) => relPath.startsWith(dir + '/') || relPath === dir)
}

function isExcluded(relPath) {
  return EXCLUDE_DIRS.some((dir) => relPath.startsWith(dir + '/') || relPath === dir)
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.tsx$/.test(entry.name)) yield full
  }
}

/**
 * Blank out `/* … *​/` blocks, newlines preserved so every reported line number
 * stays true. Without this, a JSX comment showing the very markup this gate
 * forbids (they exist, right above the code that fixed it) would be read as
 * markup. `//` comments are left alone on purpose: stripping them would need to
 * tell a comment apart from the `//` of a URL inside a string.
 */
function blankBlockComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/**
 * JSX tag scanner. Not a parser: it walks to each tag's closing `>` while
 * tracking quotes and `{}` depth, which is what makes it survive the two things
 * a regex cannot handle here — `className={clsx('a > b', { x })}` and
 * `onClick={() => …}`, both of which contain a `>` that does not end the tag.
 */
function scanTags(text) {
  const tags = []
  const opener = /<(\/?)([A-Z][\w.]*)/g
  let match
  while ((match = opener.exec(text))) {
    const [, slash, name] = match
    let i = opener.lastIndex
    let depth = 0
    let quote = null
    let end = -1
    for (; i < text.length; i++) {
      const ch = text[i]
      if (quote) {
        if (ch === quote && text[i - 1] !== '\\') quote = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0) {
        end = i
        break
      }
    }
    if (end === -1) break
    const attrs = text.slice(opener.lastIndex, end).replace(/\/$/, '')
    tags.push({
      name,
      closing: slash === '/',
      selfClosing: text[end - 1] === '/',
      attrs,
      line: text.slice(0, match.index).split('\n').length,
    })
    // Resume AFTER the tag: attribute values may themselves contain `<Foo`
    // inside a string, and those are not elements.
    opener.lastIndex = end + 1
  }
  return tags
}

/** Table-only element tree. Non-table tags are ignored — they never carry column semantics. */
function buildTree(tags) {
  const root = { name: 'root', attrs: '', line: 0, children: [] }
  const stack = [root]
  for (const tag of tags) {
    if (!TABLE_TAGS.has(tag.name)) continue
    if (tag.closing) {
      const at = stack.findLastIndex((frame) => frame.name === tag.name)
      if (at > 0) stack.length = at
      continue
    }
    const node = { name: tag.name, attrs: tag.attrs, line: tag.line, children: [] }
    stack[stack.length - 1].children.push(node)
    if (!tag.selfClosing) stack.push(node)
  }
  return root
}

function classTokens(attrs) {
  return attrs.split(/[\s"'`{}()[\],]+/).filter(Boolean)
}

/**
 * The attribute text with every VALUE blanked out — quoted strings and `{…}`
 * expressions — so only the attribute NAMES survive. Prop detection must run on
 * this, never on the raw text: `<Table className="fixed inset-0">` contains the
 * word `fixed` preceded by a space, which made the raw-text regex read a
 * `fixed` prop that is not there and SILENCE a real sticky violation. Blanking
 * preserves length (and newlines), so nothing downstream shifts.
 */
function propSlots(attrs) {
  let out = ''
  let quote = null
  let depth = 0
  for (let i = 0; i < attrs.length; i++) {
    const ch = attrs[i]
    if (quote) {
      out += ch === '\n' ? '\n' : ' '
      if (ch === quote && attrs[i - 1] !== '\\') quote = null
      continue
    }
    if (depth > 0) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
      out += ch === '\n' ? '\n' : ' '
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ' '
      continue
    }
    if (ch === '{') {
      depth = 1
      out += ' '
      continue
    }
    out += ch
  }
  return out
}

/** Breakpoint at which a `hidden … <bp>:table-cell` column appears, or null when always visible. */
function responsiveBreakpoint(node) {
  const tokens = classTokens(node.attrs)
  if (!tokens.some((token) => HIDDEN_CLASS_RE.test(token))) return null
  const responsive = tokens.find((token) => RESPONSIVE_CELL_RE.test(token))
  return responsive ? responsive.split(':')[0] : null
}

/**
 * Descendants of `node`, stopping at any nested Table (which owns its own
 * rules): used for the two per-table rules, where crossing into an inner table
 * would attribute its head/columns to the outer one.
 */
function* descendants(node) {
  for (const child of node.children) {
    yield child
    if (child.name !== 'Table') yield* descendants(child)
  }
}

/** Every node, tables included — the row rule is table-agnostic. */
function* everyNode(node) {
  for (const child of node.children) {
    yield child
    yield* everyNode(child)
  }
}

function* tables(node) {
  for (const child of node.children) {
    if (child.name === 'Table') yield child
    yield* tables(child)
  }
}

function firstOfName(node, name) {
  for (const child of descendants(node)) if (child.name === name) return child
  return null
}

/**
 * Stable identity of a finding: `file|rule|subject`.
 *
 * The subject is derived from CONTENT, never from a line number. An allowlist
 * entry keyed on a line rots the first time somebody inserts an import above,
 * and a rotten waiver either silences the wrong thing or re-opens a decision
 * nobody re-took. Editing the offending classes DOES change the key, which is
 * the intended behaviour: a different override is a different decision.
 */
function subjectOf(rule, node, extra) {
  if (rule === 'responsive-column-mismatch') return `column-${extra}`
  const tokens = classTokens(node.attrs).filter((token) => /[:-]/.test(token) || token === 'sticky')
  return tokens.sort().join(' ') || '(no-class)'
}

function checkFile(file, text) {
  const rel = relative(ROOT, file)
  const findings = []
  const add = (rule, line, subject, message) =>
    findings.push({ rule, file: rel, line, subject, key: `${rel}|${rule}|${subject}`, message })
  const root = buildTree(scanTags(blankBlockComments(text)))

  for (const table of tables(root)) {
    const isFixed = FIXED_PROP_RE.test(propSlots(table.attrs))

    for (const node of descendants(table)) {
      if (node.name !== 'TableHead') continue
      const tokens = classTokens(node.attrs)
      const isSticky = tokens.some((token) => STICKY_CLASS_RE.test(token))
      const hasOffset = tokens.some((token) => TOP_CLASS_RE.test(token))
      if (isSticky && hasOffset && !isFixed) {
        add(
          'sticky-head-needs-fixed',
          node.line,
          subjectOf('sticky-head-needs-fixed', node),
          `<TableHead sticky top-*> under a non-fixed <Table> (line ${table.line}) — the Table's own ` +
            'overflow-x-auto scrollport traps the sticky header, so it never sticks.\n' +
            '      → sortie recommandée : passer `fixed` au <Table> (il devient `w-full table-fixed` et ' +
            'perd le scrollport interne).\n' +
            '      → sinon : retirer `sticky top-*`, qui ne fait rien et ment au lecteur.'
        )
      }
    }

    // Column alignment is only decidable when both rows list the same number of
    // cells. A row built with a conditional cell has no static column index at
    // all, so comparing a shifted prefix would invent violations.
    const head = firstOfName(table, 'TableHead')
    const body = firstOfName(table, 'TableBody')
    if (head && body) {
      const headerRow = firstOfName(head, 'TableRow')
      const headers = headerRow ? headerRow.children.filter((child) => child.name === 'TableHeader') : []
      const headerSpans = headers.some((header) => SPAN_PROP_RE.test(propSlots(header.attrs)))
      if (headers.length > 0 && !headerSpans) {
        for (const row of descendants(body)) {
          if (row.name !== 'TableRow') continue
          const cells = row.children.filter((child) => child.name === 'TableCell')
          if (cells.length !== headers.length) continue
          if (cells.some((cell) => SPAN_PROP_RE.test(propSlots(cell.attrs)))) continue
          cells.forEach((cell, index) => {
            const headerBp = responsiveBreakpoint(headers[index])
            const cellBp = responsiveBreakpoint(cell)
            if (headerBp === cellBp) return
            add(
              'responsive-column-mismatch',
              cell.line,
              subjectOf('responsive-column-mismatch', cell, index + 1),
              `column ${index + 1} appears at ${cellBp ?? 'always'} but its header (line ${headers[index].line}) ` +
                `appears at ${headerBp ?? 'always'} — between the two breakpoints the body row has one more ` +
                'cell than the header row and every column after it slides under the wrong title.\n' +
                '      → sortie recommandée : aligner les deux sur le MÊME breakpoint ' +
                '(`hidden <bp>:table-cell` des deux côtés), ou rendre les deux toujours visibles.'
            )
          })
        }
      }
    }
  }

  for (const node of everyNode(root)) {
    if (node.name !== 'TableRow') continue
    if (!classTokens(node.attrs).some((token) => HOVER_BG_CLASS_RE.test(token))) continue
    if (HREF_PROP_RE.test(propSlots(node.attrs))) continue
    add(
      'hover-row-needs-href',
      node.line,
      subjectOf('hover-row-needs-href', node),
      '<TableRow hover:bg-*> without href — the row lights up under the cursor and promises a click ' +
        'target that does not exist, and offers nothing at all to the keyboard.\n' +
        '      → sortie recommandée : passer `href` (le primitive rend alors le lien pleine cellule ET ' +
        "l'anneau de focus).\n" +
        '      → sinon : retirer le `hover:bg-*`, qui promet une interaction absente.'
    )
  }

  return findings
}

const RULE_LABELS = {
  'sticky-head-needs-fixed': 'sticky header(s) under a non-fixed <Table> (the header never sticks)',
  'hover-row-needs-href': 'hover-lit <TableRow>(s) with no href (interaction promised, none delivered)',
  'responsive-column-mismatch': 'responsive column(s) whose breakpoint differs from its header (columns shift)',
}

/**
 * Written-justification allowlist. Same contract as
 * class-collision-allowlist.json, deliberately: an entry without a real
 * `reason` is not a debt record, it is a silencer, and the gate refuses to
 * START rather than honour one — a malformed waiver must never read as a pass.
 */
async function loadAllowlist() {
  let raw
  try {
    raw = await readFile(ALLOWLIST_PATH, 'utf8')
  } catch {
    return new Map()
  }
  const entries = JSON.parse(raw).entries ?? []
  const keys = new Map()
  const invalid = []
  for (const entry of entries) {
    const knownRule = Object.hasOwn(RULE_LABELS, entry.rule)
    if (!entry.file || !knownRule || !entry.subject || typeof entry.reason !== 'string' || entry.reason.trim().length < 15) {
      invalid.push(entry)
      continue
    }
    keys.set(`${entry.file}|${entry.rule}|${entry.subject}`, entry)
  }
  if (invalid.length > 0) {
    console.error('✗ check:tables — allowlist invalide (scripts/table-guard-allowlist.json).')
    console.error('  Chaque entrée exige file, rule ∈ {' + Object.keys(RULE_LABELS).join(', ') + '},')
    console.error('  subject, et une justification `reason` écrite (≥ 15 caractères).\n')
    for (const entry of invalid) console.error(`  ${JSON.stringify(entry)}`)
    process.exit(2)
  }
  return keys
}

async function main() {
  // `--only=<substring>` restricts the scan; CI passes nothing and scans all.
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='))
  const only = onlyArg ? onlyArg.slice('--only='.length) : null

  const allowed = await loadAllowlist()
  const used = new Set()
  const violations = []

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    if (!isDashboardFile(rel) || isExcluded(rel)) continue
    if (only && !relative(ROOT, file).includes(only)) continue
    for (const finding of checkFile(file, await readFile(file, 'utf8'))) {
      if (allowed.has(finding.key)) {
        used.add(finding.key)
        continue
      }
      violations.push(finding)
    }
  }

  if (violations.length > 0) {
    for (const [rule, label] of Object.entries(RULE_LABELS)) {
      const group = violations.filter((violation) => violation.rule === rule)
      if (group.length === 0) continue
      console.error(`\n✗ ${group.length} ${label}:\n`)
      for (const violation of group.sort((a, b) => a.line - b.line)) {
        console.error(`  ${violation.file}:${violation.line}  [${violation.rule}]`)
        console.error(`      ${violation.message}`)
        // The waiver key is printed verbatim so the third exit is copy-pasteable
        // — and so that taking it is a visible, reviewable act rather than a
        // quiet edit nobody can diff against the violation it hides.
        console.error(
          `      → dette assumée (dernier recours) : {"file":"${violation.file}","rule":"${violation.rule}",` +
            `"subject":"${violation.subject}","reason":"…"} dans scripts/table-guard-allowlist.json\n`
        )
      }
    }
    console.error('Table guard FAILED.\n')
    process.exit(1)
  }

  // Under `--only` most of the perimeter was never read, so an unused entry
  // proves nothing — only a full scan can call an allowlist entry stale.
  if (!only) {
    const stale = [...allowed.keys()].filter((key) => !used.has(key))
    if (stale.length > 0) {
      console.warn('⚠ check:tables — entrées d’allowlist devenues inutiles (le défaut a disparu) :')
      for (const key of stale) console.warn(`    ${key.split('|').join('  ')}`)
      console.warn('  → les retirer de scripts/table-guard-allowlist.json.\n')
    }
  }

  // A green run must never hide the debt it is standing on: every active waiver
  // is reprinted on SUCCESS. This is the difference between a gate that passes
  // and a gate that has been talked into passing.
  if (used.size > 0) {
    console.log(`⚠ ${used.size} défaut(s) de table éteint(s) par allowlist — la gate passe MALGRÉ eux :`)
    for (const key of used) {
      const entry = allowed.get(key)
      console.log(`    ${entry.file}  [${entry.rule}]  ${entry.subject}`)
      console.log(`      ${entry.reason}`)
    }
  }
  console.log('✓ Table guard passed — sticky heads are fixed-backed, hover rows are navigable, columns line up.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
