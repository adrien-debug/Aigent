#!/usr/bin/env node
/**
 * `npm run check:a11y` — the accessibility step that CANNOT live in the static
 * `npm run check` chain, isolated on purpose so that fact stays visible.
 *
 * ── Why a separate step and not one more line of `check` ────────────────────
 * Every gate in `npm run check` reads FILES. This one reads PIXELS: it drives a
 * real browser, loads six routes, and measures the composited contrast of every
 * rendered text node (see scripts/check-contrast.mjs for the measurement math).
 * That buys the only honest AA verdict available — `oklch()`, `color-mix()`,
 * stacked alphas and ancestor `opacity` are invisible to any grep — and it costs
 * a running dev server. Wiring a server-dependent gate into `check` would make
 * `check` fail for a reason that has nothing to do with the code under review,
 * which is how a chain gets a `|| true` bolted onto it.
 *
 * ── STATUS AS OF 2026-07-26: RED, AND WIRED NOWHERE ─────────────────────────
 * Measured against http://localhost:3210: exit 1, **51 glyphs under AA on 6
 * routes out of 6**, mostly `text-zinc-500` at 10–12px measured between 3.59:1
 * and 4.02:1 for a 4.5 threshold. It is therefore NOT in `npm run check`, NOT in
 * `.github/workflows/ci.yml`, and the honest sentence to say is: **the AA
 * contrast of this dashboard is not guarded today.** Wiring it into CI needs a
 * dev server in CI *and* the 51 glyphs repaired first. Until both are true,
 * nobody may describe this gate as câblée.
 *
 * ── How to run it ───────────────────────────────────────────────────────────
 *   1. Start a dev server. The main tree uses 3210 (`npm run dev`); an agent in
 *      a worktree must take a free port between 3220 and 3260 — NEVER 3000,
 *      NEVER somebody else's 3210 (AGENTS.md §Port de dev).
 *   2. npm run check:a11y                       # against the default base
 *      npm run check:a11y -- --base http://localhost:3230
 *      AIGENT_CONTRAST_BASE=http://localhost:3230 npm run check:a11y
 *   3. Every flag of check-contrast.mjs is forwarded verbatim:
 *      `--route`, `--viewport`, `--settle`, `--json`, `--emit`, `--input`.
 *
 * ── What this wrapper adds over calling check-contrast.mjs directly ─────────
 * A preflight. Without it, "no server" surfaces as a Playwright
 * `net::ERR_CONNECTION_REFUSED` stack trace that reads like a broken gate, and
 * the reflex is to distrust the gate instead of starting a server. The
 * preflight names the cause, the URL it tried, and the fix — and exits 2
 * (SETUP), never 1 (VIOLATION), so "I could not measure" is never filed as
 * "I measured and it was fine".
 *
 * Exit codes: 0 = every measured glyph clears AA · 1 = at least one is under
 * (a real violation) · 2 = could not measure (no server, bad argument).
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRAST = join(HERE, 'check-contrast.mjs')

const argv = process.argv.slice(2)

// `--input <file>` re-scores a previous capture with no browser and no server,
// so the preflight must not run in that mode — it would refuse a check that
// needs nothing.
const offline = argv.includes('--input')

/** Same resolution order as check-contrast.mjs, so the two never disagree. */
function resolveBase() {
  const at = argv.indexOf('--base')
  if (at !== -1 && argv[at + 1]) return argv[at + 1]
  return process.env.AIGENT_CONTRAST_BASE ?? 'http://localhost:3210'
}

async function preflight(base) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    // A 4xx/5xx still proves a server is listening; only a transport failure
    // means "nothing there". The gate must not refuse to start because /admin
    // happens to redirect to a login.
    await fetch(base, { signal: controller.signal, redirect: 'manual' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    clearTimeout(timer)
  }
}

const base = resolveBase()

if (!offline) {
  const failure = await preflight(base)
  if (failure) {
    console.error(`✗ check:a11y — aucun serveur ne répond sur ${base} (${failure}).`)
    console.error('')
    console.error('  Cette gate MESURE des pixels rendus : sans serveur elle ne peut rien dire,')
    console.error('  et « je n’ai pas pu mesurer » ne doit jamais se lire comme « c’est bon ».')
    console.error('')
    console.error('  Démarrer un serveur, puis relancer :')
    console.error('    npm run dev                        # arbre principal, port 3210')
    console.error('    npm run check:a11y')
    console.error('')
    console.error('  Depuis un worktree d’agent (port libre 3220–3260, jamais 3000, jamais 3210) :')
    console.error('    AIGENT_DEV_PORT=3230 npm run dev')
    console.error('    npm run check:a11y -- --base http://localhost:3230')
    console.error('')
    console.error('  Sans navigateur, à partir d’une capture existante :')
    console.error('    npm run check:a11y -- --input /tmp/contrast.json')
    process.exit(2)
  }
}

const child = spawn(process.execPath, [CONTRAST, ...argv], { stdio: 'inherit' })
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`✗ check:a11y — check-contrast.mjs tué par ${signal} : mesure incomplète, pas un succès.`)
    process.exit(2)
  }
  process.exit(code ?? 2)
})
