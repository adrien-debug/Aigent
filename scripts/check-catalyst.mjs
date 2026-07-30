#!/usr/bin/env node
/**
 * Catalyst guard — "the console is 100% Catalyst", made executable.
 *
 * WHY THIS EXISTS. The original `check:catalyst` was deleted with the old
 * dashboard and never rewritten (`AGENTS.md`, `docs/known-gaps.md`). With
 * nothing enforcing it, the rebuilt console grew five raw `<select>` elements
 * and a raw checkbox — one of them carrying a comment that openly said it was
 * skipping "a Catalyst `Select` primitive this console does not carry". A design
 * rule with no gate is a suggestion, and this one had already been ignored.
 *
 * WHAT IT FORBIDS. A raw HTML control inside `src/components/console/**` when
 * `src/components/ui/` ships a primitive for it: select, checkbox/radio, input,
 * textarea, button, table parts, and headings.
 *
 * WHAT IT DELIBERATELY ALLOWS.
 *  - Layout elements (`div`, `span`, `p`, `ul`, `li`, `section`…). Catalyst has
 *    no primitive for a flex wrapper, and demanding one would be cargo cult.
 *  - `<a href>` to an EXTERNAL url. Catalyst's `Link` wraps `next/link`, which
 *    is for internal routes; sending a GitHub PR url through it would be a
 *    regression, not compliance. Internal hrefs must still use `Link`.
 *  - `<option>`, which is what `<Select>` takes as children.
 *  - `src/components/ui/` itself: the primitives are BUILT from raw elements.
 *  - `charts/`: hand-written SVG, a domain Catalyst does not cover.
 *
 * Pure Node, no deps. Run via `npm run check:catalyst`.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN = join(ROOT, 'src/components/console')

/** Raw tag → the primitive that must be used instead. */
const FORBIDDEN = {
  select: '<Select> from @/components/ui/select',
  textarea: '<Textarea> from @/components/ui/textarea',
  table: '<Table> from @/components/ui/table',
  thead: '<TableHead> from @/components/ui/table',
  tbody: '<TableBody> from @/components/ui/table',
  tr: '<TableRow> from @/components/ui/table',
  td: '<TableCell> from @/components/ui/table',
  th: '<TableHeader> from @/components/ui/table',
  button: '<Button> from @/components/ui/button',
  h1: '<Heading> from @/components/ui/heading',
  h2: '<Heading>/<Subheading> from @/components/ui/heading',
  h3: '<Subheading> from @/components/ui/heading',
}

/** Files exempt from the rule, with the reason each is exempt. */
const EXEMPT = [
  // Hand-written SVG; Catalyst ships no chart primitive.
  'src/components/console/charts/',
]

/**
 * Blank out comments before scanning. These files document their own design
 * decisions in prose that names the raw tags ("the kit hovers every `<tr>`",
 * "a plain <a> on purpose") — flagging that text would push an author to
 * "fix" a comment, or to delete the reasoning to appease the gate. Replaced
 * with spaces rather than removed so reported line numbers stay true.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length))
}

/**
 * Deliberate, documented exceptions — each one an anchor whose behaviour would
 * REGRESS under `next/link`. `/logout` is a GET route handler: next/link would
 * prefetch it and sign the operator out on hover.
 */
const ALLOWED_RAW_ANCHORS = [{ file: 'src/components/console/console-shell.tsx', href: '/logout' }]

const failures = []

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.name.endsWith('.tsx')) yield full
  }
}

for await (const file of walk(SCAN)) {
  const rel = relative(ROOT, file)
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue

  const text = stripComments(await readFile(file, 'utf8'))
  const lines = text.split('\n')

  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`

    for (const [tag, replacement] of Object.entries(FORBIDDEN)) {
      // `<tag` followed by whitespace, `>` or `/` — so `<table` never matches
      // `<TableRow>` and `<th` never matches `<thead>` twice.
      if (!new RegExp(`<${tag}(?=[\\s/>])`).test(line)) continue
      failures.push(`${at} — raw <${tag}>, use ${replacement}`)
    }

    // Inputs: a checkbox/radio needs <Checkbox>, anything else needs <Input>.
    if (/<input(?=[\s/>])/.test(line)) {
      const isToggle = /type=["'](checkbox|radio)["']/.test(line)
      failures.push(
        `${at} — raw <input>, use ${isToggle ? '<Checkbox> from @/components/ui/checkbox' : '<Input> from @/components/ui/input'}`
      )
    }

    // Anchors: external urls are legitimately raw, internal routes are not.
    if (/<a(?=[\s/>])/.test(line)) {
      const externalHref = /href=\{?["']?https?:\/\//.test(line) || /href=\{[^}]*(Url|url)\b/.test(line)
      // The href may sit on the next line; look ahead a little before judging.
      const window = lines.slice(index, index + 4).join(' ')
      const allowed = ALLOWED_RAW_ANCHORS.some(
        (entry) => rel === entry.file && window.includes(`href="${entry.href}"`)
      )
      const externalNearby = /href=\{?["']?https?:\/\//.test(window) || /href=\{[^}]*(Url|url)\b/.test(window)
      if (!externalHref && !externalNearby && !allowed) {
        failures.push(`${at} — raw <a> to an internal route, use <Link> from @/components/ui/link`)
      }
    }
  })
}

if (failures.length > 0) {
  console.error(`✗ check:catalyst — ${failures.length} raw control(s) where a primitive exists.\n`)
  for (const failure of failures) console.error(`  ${failure}`)
  console.error('\n  The console is 100% Catalyst (AGENTS.md § UI). Add the primitive to')
  console.error('  src/components/ui/ from the real kit rather than hand-rolling the control.')
  process.exit(1)
}

console.log('✓ check:catalyst — every console control with a Catalyst equivalent uses the primitive.')
