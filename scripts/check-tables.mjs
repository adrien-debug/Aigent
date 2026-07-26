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
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const DASHBOARD_DIRS = [
  join('app', 'admin'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]
const EXCLUDE_DIRS = [join('components', 'ui')]

/** Elements that carry table semantics — everything else is structural noise. */
const TABLE_TAGS = new Set(['Table', 'TableHead', 'TableBody', 'TableRow', 'TableHeader', 'TableCell'])

// A bare `fixed` prop, not the `table-fixed` utility that lives inside a
// className: the latter is preceded by `-`, the former by whitespace or `<`.
const FIXED_PROP_RE = /(?:^|\s)fixed(?![\w-])/
const HREF_PROP_RE = /(?:^|\s)href\s*=/
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

function checkFile(file, text) {
  const where = (line) => `${relative(ROOT, file)}:${line}`
  const root = buildTree(scanTags(blankBlockComments(text)))
  const sticky = []
  const hover = []
  const columns = []

  for (const table of tables(root)) {
    const isFixed = FIXED_PROP_RE.test(table.attrs)

    for (const node of descendants(table)) {
      if (node.name !== 'TableHead') continue
      const tokens = classTokens(node.attrs)
      const isSticky = tokens.some((token) => STICKY_CLASS_RE.test(token))
      const hasOffset = tokens.some((token) => TOP_CLASS_RE.test(token))
      if (isSticky && hasOffset && !isFixed) {
        sticky.push(
          `${where(node.line)}  <TableHead sticky top-*> under a non-fixed <Table> (line ${table.line}) — ` +
            'the Table\'s own overflow-x-auto scrollport traps the sticky header; add `fixed`'
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
      if (headers.length > 0) {
        for (const row of descendants(body)) {
          if (row.name !== 'TableRow') continue
          const cells = row.children.filter((child) => child.name === 'TableCell')
          if (cells.length !== headers.length) continue
          cells.forEach((cell, index) => {
            const headerBp = responsiveBreakpoint(headers[index])
            const cellBp = responsiveBreakpoint(cell)
            if (headerBp === cellBp) return
            columns.push(
              `${where(cell.line)}  column ${index + 1} appears at ${cellBp ?? 'always'} but its header ` +
                `(line ${headers[index].line}) appears at ${headerBp ?? 'always'} — the columns shift between the two`
            )
          })
        }
      }
    }
  }

  for (const node of everyNode(root)) {
    if (node.name !== 'TableRow') continue
    if (!classTokens(node.attrs).some((token) => HOVER_BG_CLASS_RE.test(token))) continue
    if (HREF_PROP_RE.test(node.attrs)) continue
    hover.push(
      `${where(node.line)}  <TableRow hover:bg-*> without href — a row that lights up must be navigable ` +
        '(pass `href`, which also renders the full-cell link and the focus ring)'
    )
  }

  return { sticky, hover, columns }
}

async function main() {
  const sticky = []
  const hover = []
  const columns = []

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    if (!isDashboardFile(rel) || isExcluded(rel)) continue
    const found = checkFile(file, await readFile(file, 'utf8'))
    sticky.push(...found.sticky)
    hover.push(...found.hover)
    columns.push(...found.columns)
  }

  let failed = false
  const groups = [
    [sticky, 'sticky header(s) under a non-fixed <Table> (the header never sticks)'],
    [hover, 'hover-lit <TableRow>(s) with no href (interaction promised, none delivered)'],
    [columns, 'responsive column(s) whose breakpoint differs from its header (columns shift)'],
  ]
  for (const [violations, label] of groups) {
    if (violations.length === 0) continue
    failed = true
    console.error(`\n✗ ${violations.length} ${label}:\n`)
    for (const violation of violations) console.error('  ' + violation)
  }

  if (failed) {
    console.error('\nTable guard FAILED.\n')
    process.exit(1)
  }
  console.log('✓ Table guard passed — sticky heads are fixed-backed, hover rows are navigable, columns line up.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
