#!/usr/bin/env node
/**
 * RSC boundary guard — fails when a Server Component passes a FUNCTION prop to
 * a Client Component.
 *
 * Why this exists: React cannot serialize a function across the server/client
 * boundary. The component throws at render time and disappears into its error
 * boundary — while `tsc`, `next build` and the DOM unit tests all stay GREEN.
 * `tsc` sees a valid prop type; the tests render both sides in one process with
 * no boundary at all. Only loading the page surfaces it.
 *
 * That happened for real on 26/07/2026: the Recharts migration handed
 * `formatUsd` to <HourlyCostChart> and the cost card silently died in prod-like
 * rendering. This gate is the tool that makes the rule stick.
 *
 * How it works: find every module marked `'use client'`, collect the components
 * it exports, then scan the SERVER modules that render them for a prop whose
 * value is a bare function identifier or an arrow/function expression.
 *
 * Known limits (documented, not hidden): identifier props are resolved only
 * within the calling file, and a function reached through an object prop is not
 * detected. It catches the direct, common shape — which is the one that bit us.
 *
 * Pure Node, no deps. Run via `npm run check:rsc-boundary`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

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
    else if (/\.(tsx|jsx)$/.test(entry.name)) yield full
  }
}

const files = []
for await (const file of walk(SRC)) {
  files.push({ path: file, source: await readFile(file, 'utf8') })
}

const isClient = (source) => /^\s*['"]use client['"]/m.test(source.slice(0, 400))

// Components exported from a 'use client' module → they run on the client.
const clientComponents = new Set()
for (const { source } of files) {
  if (!isClient(source)) continue
  for (const m of source.matchAll(/export\s+(?:default\s+)?function\s+([A-Z]\w*)/g)) {
    clientComponents.add(m[1])
  }
  for (const m of source.matchAll(/export\s+(?:const|let)\s+([A-Z]\w*)/g)) {
    clientComponents.add(m[1])
  }
}

const violations = []

for (const { path, source } of files) {
  if (isClient(source)) continue // client → client is fine, nothing is serialized
  const rel = relative(SRC, path).split('\\').join('/')

  // Locally declared function names — a prop passing one of these is a function.
  const localFns = new Set()
  for (const m of source.matchAll(/^\s*(?:async\s+)?function\s+([a-z]\w*)/gm)) localFns.add(m[1])
  for (const m of source.matchAll(/^\s*const\s+([a-z]\w*)\s*=\s*(?:async\s*)?\(/gm)) localFns.add(m[1])

  for (const tag of source.matchAll(/<([A-Z]\w*)\b([^>]*?)\/?>/g)) {
    const [, name, rawProps] = tag
    if (!clientComponents.has(name)) continue

    for (const prop of rawProps.matchAll(/(\w+)=\{([^}]*)\}/g)) {
      const [, propName, rawValue] = prop
      const value = rawValue.trim()

      const isArrow = /^(?:async\s*)?\([^)]*\)\s*=>/.test(value) || /^\w+\s*=>/.test(value)
      const isFunctionExpr = /^(?:async\s+)?function\b/.test(value)
      const isLocalFnRef = localFns.has(value)

      if (isArrow || isFunctionExpr || isLocalFnRef) {
        violations.push({ rel, name, propName, value: value.slice(0, 40) })
      }
    }
  }
}

if (violations.length > 0) {
  console.error('✗ RSC boundary guard FAILED — prop fonction passée à un Client Component.\n')
  for (const v of violations) {
    console.error(`  src/${v.rel}`)
    console.error(`    <${v.name} ${v.propName}={${v.value}}>`)
  }
  console.error('\n  React ne sérialise pas une fonction : le composant part dans son error')
  console.error('  boundary au runtime, alors que typecheck, build et tests DOM restent VERTS.')
  console.error('  → passe des DONNÉES, pas du comportement : déplace la fonction dans le')
  console.error("     module 'use client', ou pré-calcule le résultat côté serveur.")
  process.exit(1)
}

console.log(`✓ RSC boundary guard passed — aucune prop fonction ne traverse la frontière (${clientComponents.size} composants client).`)
