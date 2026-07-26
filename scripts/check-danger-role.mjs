#!/usr/bin/env node
/**
 * Danger-role guard — fails CI when failure and destruction are painted with
 * the colour of success.
 *
 * The design system has ONE chromatic hue, `accent` (green), and it means
 * "healthy / primary / done". For a long time it was also the only colour with
 * any meaning at all, so an error banner, a failed run and a cascade delete all
 * borrowed it: the interface said "success" while reporting an incident. That
 * is the failure mode this guard makes un-shippable. `--state-danger-*`
 * (src/app/globals.css) is the semantic channel those surfaces must consume.
 *
 * Scope: src/app/admin/**, src/components/agent-ops/**, src/components/views/**
 * (the catalyst-in-layers migration moved page-level render logic here — see
 * the migration plan) and src/components/shell/** — the dashboard, same scope
 * as `check:catalyst`. NOT src/components/ui/** (the primitives own their
 * palette), NOT the marketing site.
 *
 * Rules:
 *   1) alert-accent — an element carrying `role="alert"` also carries an accent
 *      class, an `--accent-*` role token, or an accent `color`/`tone` prop.
 *   2) named-danger-accent — a component whose NAME says Error / Danger /
 *      Warning renders the accent anywhere in its body.
 *   3) destructive-accent-button — a `<Button color="accent">` whose `onClick`
 *      names a delete / remove / destroy handler: the destructive act wearing
 *      the same affordance as the page's happy path.
 *
 * Deliberate limit, rule 1: only the opening tag of the alert element is read,
 * not its subtree. Walking children without an AST would either miss the tag
 * boundaries or swallow a whole page (src/app/admin/error.tsx is a full-screen
 * `role="alert"`). A green descendant inside an alert is therefore NOT caught —
 * this guard proves the container is honest, it does not prove the whole region
 * is. Widening it needs a real parser, not a bigger regex.
 *
 * ALLOWLIST is debt, not permission: every entry is a surface that predates the
 * danger channel and lives outside the pass that introduced this guard. The
 * count is printed on every green run so it stays visible and shrinks.
 *
 * An entry that no longer matches anything FAILS the guard. A permission that
 * outlives the violation it covered is a dormant permission: the file gets
 * repaired, nobody deletes the line, and the next accent painted into that same
 * file is waved through by an exemption written for a bug that no longer exists.
 * Five entries had already rotted that way and the guard stayed green:
 * run-benchmark-button, new-project-workbench and project-team-relation-dialogs
 * (×2) now consume --state-danger-*, and dashboard-kpi-strip repainted its
 * warning triangle zinc — deliberately neither accent nor danger.
 * Same contract as KNOWN_DEBT in scripts/check-render-truth.mjs.
 *
 * Pure Node, no deps. Run via `node scripts/check-danger-role.mjs`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const DASHBOARD_DIRS = [
  join('app', 'admin'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]
const EXCLUDE_DIRS = [join('components', 'ui')]

const RULES = {
  alert: 'alert-accent',
  named: 'named-danger-accent',
  destructive: 'destructive-accent-button',
}

/**
 * Pre-existing violations, each one a real finding still to be burned down.
 * Matched on file + rule, never on a line number — line numbers rot on the
 * first edit and an allowlist that silently stops matching is worse than none.
 * Removing an entry must be a code fix, never a convenience — and once the fix
 * lands, deleting the entry is MANDATORY: an unmatched entry fails the guard.
 */
const ALLOWLIST = [
  {
    file: 'src/components/agent-ops/run-copilot-panel.tsx',
    rule: RULES.alert,
    reason:
      'HITL "Human approval required" panel: a pending decision is not a failure — the fix is the wrong `role`, not the colour',
  },
  {
    file: 'src/components/agent-ops/agent-builder-workbench.tsx',
    rule: RULES.alert,
    reason:
      'HITL approval gate: same as run-copilot-panel — `role="alert"` misapplied to a pending decision',
  },
]

// Accent worn as a class (`text-accent-400`, `bg-accent-500/10`) or as a named
// role token, in either arbitrary-value form: `var(--accent-soft)` and the
// Tailwind v4 shorthand `ring-(--accent-line)` both contain `--accent-`.
const ACCENT_STYLE_RE = /\baccent-\d{2,3}\b|--accent-[a-z-]+/
// Accent handed to a primitive as a prop: color="accent" / "accentStrong" /
// "accentSolid", tone="accent-600", badgeColor="accent".
const ACCENT_PROP_RE = /(?:color|tone|badgeColor)\s*=\s*(?:"|'|\{')accent/

const DESTRUCTIVE_HANDLER_RE = /\b(?:delete|remove|destroy)\w*/i
const DANGER_NAMED_RE = /Error|Danger|Warning/
// React components only: a lowercase name is a helper (`isAbortError`), not a
// surface that can paint anything.
const DECLARATION_RE = /^(?:export\s+)?(?:function|const)\s+([A-Z]\w*)/

function isDashboardFile(relPath) {
  return DASHBOARD_DIRS.some((dir) => relPath.startsWith(dir + sep) || relPath === dir)
}

function isExcluded(relPath) {
  return EXCLUDE_DIRS.some((dir) => relPath.startsWith(dir + sep) || relPath === dir)
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.tsx$/.test(entry.name)) {
      yield full
    }
  }
}

/** 1-indexed line number of a character offset. */
function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1
  return line
}

/**
 * Text of the JSX opening tag containing `index`. Scans back to the tag's `<`,
 * then forward to the `>` that closes it — tracking `{}` depth and quotes so a
 * `>` inside an arbitrary value (`[&>*]:size-4`) or an expression does not end
 * the tag early. Returns null when no plausible tag surrounds the offset.
 */
function openingTagAt(text, index) {
  const start = text.lastIndexOf('<', index)
  if (start === -1) return null
  let depth = 0
  let quote = null
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') depth -= 1
    else if (ch === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/** Balanced-brace body of `onClick={…}` starting at the offset of the `{`. */
function braceExpressionAt(text, open) {
  let depth = 0
  let quote = null
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}

/** Rule 1 — accent on the element that declares itself an alert. */
function findAlertViolations(text) {
  const found = []
  const re = /role\s*=\s*"alert"/g
  let m
  while ((m = re.exec(text))) {
    const tag = openingTagAt(text, m.index)
    if (!tag) continue
    if (ACCENT_STYLE_RE.test(tag) || ACCENT_PROP_RE.test(tag)) {
      found.push({
        rule: RULES.alert,
        line: lineAt(text, m.index),
        detail: 'role="alert" painted with the accent — an error is not a success (use --state-danger-*)',
      })
    }
  }
  return found
}

/**
 * Rule 2 — a component whose name promises Error/Danger/Warning wearing the
 * accent. Body runs from its declaration to the next top-level declaration,
 * which is where a component ends in this codebase (one declaration per column
 * 0, no nested top-level functions).
 */
function findNamedViolations(text) {
  const lines = text.split('\n')
  const starts = []
  lines.forEach((line, i) => {
    const m = DECLARATION_RE.exec(line)
    if (m) starts.push({ index: i, name: m[1] })
  })

  const found = []
  starts.forEach((decl, n) => {
    if (!DANGER_NAMED_RE.test(decl.name)) return
    const end = n + 1 < starts.length ? starts[n + 1].index : lines.length
    for (let i = decl.index; i < end; i += 1) {
      if (ACCENT_STYLE_RE.test(lines[i]) || ACCENT_PROP_RE.test(lines[i])) {
        found.push({
          rule: RULES.named,
          line: i + 1,
          detail: `<${decl.name}> says failure in its name and accent in its style (use --state-danger-*)`,
        })
      }
    }
  })
  return found
}

/** Rule 3 — the destructive act wearing the primary affordance. */
function findDestructiveViolations(text) {
  const found = []
  const re = /<Button\b/g
  let m
  while ((m = re.exec(text))) {
    const tag = openingTagAt(text, m.index)
    if (!tag || !ACCENT_PROP_RE.test(tag)) continue
    const onClick = tag.indexOf('onClick=')
    if (onClick === -1) continue
    const brace = tag.indexOf('{', onClick)
    if (brace === -1) continue
    if (DESTRUCTIVE_HANDLER_RE.test(braceExpressionAt(tag, brace))) {
      found.push({
        rule: RULES.destructive,
        line: lineAt(text, m.index),
        detail: 'destructive handler behind a solid accent Button — identical to the page\'s primary action',
      })
    }
  }
  return found
}

async function main() {
  const violations = []
  const suppressed = []
  const matchedAllowlist = new Set()

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    if (!isDashboardFile(rel) || isExcluded(rel)) continue
    const repoRel = relative(ROOT, file).split(sep).join('/')
    const text = await readFile(file, 'utf8')

    const hits = [...findAlertViolations(text), ...findNamedViolations(text), ...findDestructiveViolations(text)]
    for (const hit of hits) {
      const allowed = ALLOWLIST.find((a) => a.file === repoRel && a.rule === hit.rule)
      if (allowed) {
        matchedAllowlist.add(allowed)
        suppressed.push({ ...hit, file: repoRel, reason: allowed.reason })
      } else violations.push({ ...hit, file: repoRel })
    }
  }

  // Dormant permissions. Not a warning: an exemption whose violation is gone
  // still exempts the NEXT one written into the same file under the same rule.
  const deadAllowlist = ALLOWLIST.filter((entry) => !matchedAllowlist.has(entry))

  if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} surface(s) using the accent to report failure or destruction:\n`)
    for (const v of violations) console.error(`  ${v.file}:${v.line}  [${v.rule}] ${v.detail}`)
    console.error('\n  The accent means success. Failure and destruction consume --state-danger-* (src/theme.css),')
    console.error('  and the colour never carries the meaning alone — keep the label.')
  }
  if (deadAllowlist.length > 0) {
    console.error(`\n✗ ${deadAllowlist.length} dead ALLOWLIST entry(ies) — the violation is gone, the permission is not:\n`)
    for (const a of deadAllowlist) console.error(`  ${a.file}  [${a.rule}] ${a.reason}`)
    console.error('\n  Delete them from ALLOWLIST in this file. A permission nobody needs is a permission')
    console.error('  nobody notices being reused.')
  }
  if (violations.length > 0 || deadAllowlist.length > 0) {
    console.error('\nDanger-role guard FAILED.\n')
    process.exit(1)
  }

  console.log('✓ Danger-role guard passed — no alert, danger-named component or destructive action wears the accent.')
  if (suppressed.length > 0) {
    console.log(`  ${suppressed.length} known violation(s) still allowlisted (debt, to burn down):`)
    for (const s of suppressed) console.log(`    ${s.file}:${s.line}  [${s.rule}] ${s.reason}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
