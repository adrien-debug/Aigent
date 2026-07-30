#!/usr/bin/env node
/**
 * Design-system layering guard.
 *
 * THE ARCHITECTURE THIS ENFORCES
 *   layer 1  foundation  — the `graphite-*` ramp (and Catalyst's own `zinc`)
 *   layer 2  semantic    — `surface-*`, `content-*`, `line*`, `--ds-*`
 *   layer 3  product     — the accent (`accent-*` here, `copper-*` for Hearst)
 *
 * WHY. Catalyst is designed and tested against `zinc`, so its PRIMITIVES keep
 * that grammar — rewriting them would fork the kit. But a page reaching for
 * `text-zinc-500` hard-codes Tailwind's cold grey into the product's identity,
 * and re-theming then means editing hundreds of class names instead of one
 * file. Before this gate the console carried 237 raw `zinc-*` classes, 175 of
 * them text, because surfaces had semantic tokens and text had none.
 *
 * WHAT FAILS. A raw `zinc-*` utility in a page or composition
 * (`src/components/console/**`, `src/app/**`). The message names the semantic
 * token to use instead.
 *
 * WHAT IS ALLOWED, DELIBERATELY.
 *   · `src/components/ui/**` — the Catalyst primitives ARE the zinc layer.
 *   · `src/components/marketing/**` — Tailwind Plus blocks taken as-is
 *     (`AGENTS.md`), a separate perimeter from the console.
 *   · Comments. These files document their own contrast measurements against
 *     named zinc steps; flagging that prose would push an author to delete the
 *     reasoning to appease the gate.
 *
 * Pure Node, no deps. Run via `npm run check:ds-tokens`.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN = ['src/components/console', 'src/app']
const EXEMPT = [
  // The Catalyst primitives ARE the zinc layer.
  'src/components/ui/',
  // Marketing: Tailwind Plus blocks taken as-is, restyled on project tokens
  // (`AGENTS.md`). A separate perimeter from the console, and the one place a
  // vendor block's own grammar is allowed to survive.
  'src/components/marketing/',
  'src/app/(site)/',
]

/** Raw zinc step → the semantic token that carries that role. */
const SUGGESTION = {
  200: 'text-content',
  300: 'text-content-muted',
  400: 'text-content-muted',
  500: 'text-content-subtle',
  600: 'text-content-faint',
  700: 'graphite-700 (foundation) or a surface-* token',
  800: 'a surface-* token',
  900: 'a surface-* token',
  950: 'content-on-accent (text on an accent fill) or surface-app',
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length))
}

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
    else if (/\.(tsx|ts)$/.test(entry.name)) yield full
  }
}

const failures = []

for (const dir of SCAN) {
  for await (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file)
    if (EXEMPT.some((p) => rel.startsWith(p))) continue

    const lines = stripComments(await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      for (const match of line.matchAll(
        /(dark:)?\b(?:text|bg|border|stroke|fill|ring|divide|decoration|outline|accent)-zinc-(\d{2,3})(\/\d+)?\b/g
      )) {
        const [raw, darkVariant, stepText, opacity] = match
        const step = Number(stepText)

        // The semantic layer is DARK-ONLY today: every `--color-surface-*` /
        // `--color-content-*` value is a dark-theme colour. The few dual-theme
        // pages (login, 404, the root body) therefore keep raw zinc for their
        // LIGHT side — there is no semantic token that means "the light-mode
        // equivalent", and inventing one that nothing renders would be a token
        // nobody can verify. Only the `dark:` side is held to the DS here.
        // When a light theme is actually built, drop this exemption.
        const isLightSideOfDualTheme = !darkVariant && /\bdark:/.test(line)
        if (isLightSideOfDualTheme) continue

        // `zinc-950/5`-style hairlines are opacity overlays, not surfaces: the
        // semantic equivalent is `line`/`line-strong`, already used elsewhere.
        const suggestion = opacity
          ? 'border-line / border-line-strong (an opacity overlay is a hairline, not a surface)'
          : (SUGGESTION[step] ?? 'a semantic token')

        failures.push(`${rel}:${index + 1} — raw \`${raw}\`, use ${suggestion}`)
      }
    })
  }
}

if (failures.length > 0) {
  console.error(`✗ check:ds-tokens — ${failures.length} raw zinc utility(ies) outside the primitive layer.\n`)
  for (const failure of failures.slice(0, 40)) console.error(`  ${failure}`)
  if (failures.length > 40) console.error(`  … and ${failures.length - 40} more`)
  console.error('\n  Pages consume the SEMANTIC layer (src/theme.css), never the zinc ramp:')
  console.error('  Catalyst keeps zinc inside its primitives; the product does not inherit its grey.')
  process.exit(1)
}

console.log('✓ check:ds-tokens — no raw zinc outside the Catalyst primitives; pages consume semantic tokens only.')
