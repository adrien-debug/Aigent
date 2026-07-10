#!/usr/bin/env node
/**
 * Design-system guard — fails CI if the monochrome contract is broken.
 *
 * 1) No chromatic hue other than `accent` / `zinc` anywhere in `src` (the
 *    Catalyst primitive keeps its full palette, so it is excluded).
 * 2) The solid accent surfaces keep WCAG AA (≥ 4.5:1) for their white text.
 *
 * Pure Node, no deps. Run via `npm run check:ds`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const EXCLUDE_DIR = join('components', 'catalyst') // the primitive owns the full palette

const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const PREFIX = 'bg|text|ring-offset|ring|border|fill|stroke|from|to|via|decoration|outline|divide|shadow|caret|placeholder'
const CLASS_RE = new RegExp(`\\b(${PREFIX})-(${HUES.join('|')})-[0-9]`, 'g')
const PROP_RE = new RegExp(`(?:color|badgeColor)\\s*[:=]\\s*['"](${HUES.join('|')})['"]`, 'g')
const VAR_RE = new RegExp(`--color-(${HUES.join('|')})-[0-9]`, 'g')

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full
    }
  }
}

// --- WCAG contrast -----------------------------------------------------------
const ACCENT = {
  600: '#e03a15',
  700: '#b82d14',
  800: '#972817',
}
function lin(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

async function main() {
  const violations = []
  for await (const file of walk(SRC)) {
    if (relative(SRC, file).includes(EXCLUDE_DIR)) continue
    const text = await readFile(file, 'utf8')
    text.split('\n').forEach((line, i) => {
      for (const re of [CLASS_RE, PROP_RE, VAR_RE]) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line))) {
          violations.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]}`)
        }
      }
    })
  }

  const AA = 4.5
  const contrastChecks = [
    ['white on accentSolid (bg-accent-700)', contrast('#ffffff', ACCENT[700])],
    ['white on accent button (bg-accent-700)', contrast('#ffffff', ACCENT[700])],
  ]
  const contrastFails = contrastChecks.filter(([, ratio]) => ratio < AA)

  let failed = false
  if (violations.length > 0) {
    failed = true
    console.error(`\n✗ ${violations.length} non-accent hue(s) in src (only accent/zinc allowed):\n`)
    for (const v of violations) console.error('  ' + v)
  }
  if (contrastFails.length > 0) {
    failed = true
    console.error('\n✗ WCAG AA contrast failures:\n')
    for (const [name, ratio] of contrastFails) console.error(`  ${name}: ${ratio.toFixed(2)}:1 (< ${AA})`)
  }

  if (failed) {
    console.error('\nDesign-system guard FAILED.\n')
    process.exit(1)
  }
  console.log('✓ Design-system guard passed — monochrome accent + zinc, contrasts AA.')
  for (const [name, ratio] of contrastChecks) console.log(`  ${name}: ${ratio.toFixed(2)}:1`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
