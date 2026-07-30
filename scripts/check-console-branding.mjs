#!/usr/bin/env node
/**
 * Branding leak guard — the console frame and the admin routes must say
 * "Aigent", never a foreign product name copied in from another design
 * system (a vendored shell component, a stray docblock, a placeholder that
 * never got renamed).
 *
 * `console-shell.tsx:223` shipped the string "Nexus" — Nexus is a different
 * product's name, not this one's. This gate makes that class of leak fail
 * the build instead of shipping quietly.
 *
 * Scan root: `src/components/console/**` and `src/app/admin/**`. Pure Node,
 * no deps. Run via `npm run check:console-branding`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = [join(ROOT, 'src', 'components', 'console'), join(ROOT, 'src', 'app', 'admin')]

/** Foreign product names that must never appear in the console's own copy. */
const FORBIDDEN_NAMES = ['Nexus']

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

async function walk(dir, files = []) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, files)
    } else if (entry.isFile()) {
      files.push(full)
    }
  }
  return files
}

async function main() {
  // ANTI-BLINDNESS: verify the scan root exists before trusting a green
  // verdict — a guard scanning nothing would pass by default.
  for (const root of SCAN_ROOTS) {
    try {
      await stat(root)
    } catch {
      console.error(`check:console-branding — scan root missing: ${relative(ROOT, root)}`)
      process.exit(1)
    }
  }

  const violations = []
  for (const root of SCAN_ROOTS) {
    const files = (await walk(root)).filter((f) => CODE_EXTENSIONS.has(f.slice(f.lastIndexOf('.'))))
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      const lines = content.split('\n')
      for (const name of FORBIDDEN_NAMES) {
        const pattern = new RegExp(`\\b${name}\\b`)
        lines.forEach((line, index) => {
          if (pattern.test(line)) {
            violations.push(`${relative(ROOT, file)}:${index + 1} — forbidden name "${name}": ${line.trim()}`)
          }
        })
      }
    }
  }

  if (violations.length > 0) {
    console.error('check:console-branding — foreign product name(s) found in console/admin copy:\n')
    for (const v of violations) console.error(`  ${v}`)
    console.error(
      '\nThe console frame speaks for Aigent only. Rename the string, or if this is a legitimate ' +
        'third-party reference, add it to an explicit allowlist with a reason.'
    )
    process.exit(1)
  }

  console.log('check:console-branding — clean: no foreign product name in src/components/console/** or src/app/admin/**.')
}

main()
