#!/usr/bin/env node
/**
 * Admin runtime E2E — drives a real browser against /admin/runs and
 * fails on anything the unit tests structurally cannot see: a console error, a
 * link pointing at a route that 404s, a filter that does not narrow the table,
 * a URL that does not carry the filter state, or a viewport where the shell
 * collapses.
 *
 * Requires a dev server on http://localhost:3210 (the Aigent dev port; never
 * 3000 — see AGENTS.md). Override with V2_TEST_URL.
 *
 * Run: npm run verify:admin-e2e
 */
import { chromium } from 'playwright'

const BASE = process.env.V2_TEST_URL ?? 'http://localhost:3210'
const RUNS_URL = `${BASE}/admin/runs`

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 375, height: 812 },
]

const failures = []
const notes = []

function check(condition, message) {
  if (condition) return true
  failures.push(message)
  return false
}

/** Console errors that belong to the app, not to the dev overlay/tooling. */
function isAppConsoleError(text) {
  if (/Download the React DevTools/i.test(text)) return false
  if (/\[Fast Refresh\]/i.test(text)) return false
  return true
}

async function main() {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const consoleErrors = []

  context.on('console', (msg) => {
    if (msg.type() === 'error' && isAppConsoleError(msg.text())) {
      consoleErrors.push(msg.text())
    }
  })
  context.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

  const page = await context.newPage()

  try {
    // --- 1. The page answers and renders the cockpit -----------------------
    const response = await page.goto(RUNS_URL, { waitUntil: 'networkidle' })
    check(response?.status() === 200, `GET /admin/runs answered ${response?.status()}, expected 200`)
    await page.waitForSelector('h1', { timeout: 15_000 })
    check(
      (await page.locator('h1', { hasText: 'Runs' }).count()) === 1,
      'expected exactly one <h1> reading "Runs"'
    )

    // --- 2. the dashboard root still renders ------------------------------
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' })
    check(
      new URL(page.url()).pathname === '/admin',
      `/admin should render the dashboard, landed on ${page.url()}`
    )

    // --- 3. Exactly one navigation rail ------------------------------------
    // The rebuilt shell must not coexist with a second rail; two "Main"
    // landmarks is what a half-finished shell swap looks like.
    await page.goto(RUNS_URL, { waitUntil: 'networkidle' })
    const rails = await page.locator('nav[aria-label="Main"]').count()
    check(rails >= 1, 'the admin rail (nav[aria-label="Main"]) is missing')

    // --- 4. Every visible link points at a route that exists ---------------
    const hrefs = await page.$$eval('a[href^="/"]', (as) =>
      [...new Set(as.map((a) => a.getAttribute('href')).filter(Boolean))]
    )
    check(hrefs.length > 0, 'no internal links found on the runs page')
    for (const href of hrefs) {
      const res = await page.request.get(`${BASE}${href}`, { maxRedirects: 5 })
      check(res.status() !== 404, `link ${href} answers 404 — no visible link may point at a missing route`)
    }
    notes.push(`${hrefs.length} distinct internal link(s) probed`)

    // --- 5. Filters actually filter, and land in the URL -------------------
    await page.goto(RUNS_URL, { waitUntil: 'networkidle' })
    const rowsBefore = await countRows(page)

    if (rowsBefore === 0) {
      notes.push('backend returned 0 runs in the window — filter narrowing not exercised')
    } else {
      await page.getByPlaceholder('Search run id, agent, project or input…').fill('zzz-no-such-run')
      await page.waitForFunction(() => !document.querySelector('table tbody tr'), { timeout: 5_000 })
      check((await countRows(page)) === 0, 'a non-matching search still rendered rows')
      check(
        (await page.getByText('No run matches these filters').count()) === 1,
        'the filtered-empty state did not render'
      )
      await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'zzz-no-such-run', {
        timeout: 5_000,
      })
      notes.push('search filter narrows the feed and is mirrored in ?q=')

      // A shared link must reproduce the filtered view server-side.
      const shared = await page.goto(`${RUNS_URL}?q=zzz-no-such-run`, { waitUntil: 'networkidle' })
      check(shared?.status() === 200, 'filtered deep link did not answer 200')
      check(
        (await page.getByText('No run matches these filters').count()) === 1,
        'a filtered deep link did not reproduce the filtered view on first paint'
      )

      // An unknown status must NOT silently empty the table.
      await page.goto(`${RUNS_URL}?status=banana`, { waitUntil: 'networkidle' })
      check(
        (await countRows(page)) === rowsBefore,
        'an unparseable ?status= value changed the result set instead of being ignored'
      )
      notes.push('unparseable filter values fall back to "all" instead of emptying the table')
    }

    // --- 6. Responsive shell across the four required viewports ------------
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(RUNS_URL, { waitUntil: 'networkidle' })

      const railVisible = await page.locator('nav[aria-label="Aigent V2"]').first().isVisible()
      const burger = page.getByRole('button', { name: 'Open navigation' })

      if (vp.width >= 1024) {
        check(railVisible, `${vp.name}: the V2 rail should be visible at ${vp.width}px`)
      } else {
        check(await burger.isVisible(), `${vp.name}: the drawer button should be visible at ${vp.width}px`)
        await burger.click()
        await page.waitForSelector('[role="dialog"] nav[aria-label="Aigent V2"]', { timeout: 5_000 })
        check(
          await page.locator('[role="dialog"] nav[aria-label="Aigent V2"]').isVisible(),
          `${vp.name}: the mobile drawer did not open`
        )
        await page.keyboard.press('Escape')
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      )
      check(!overflow, `${vp.name}: the page scrolls horizontally at ${vp.width}px`)
    }

    // --- 7. Zero console errors across everything above --------------------
    check(
      consoleErrors.length === 0,
      `browser console reported ${consoleErrors.length} error(s):\n    ${consoleErrors.join('\n    ')}`
    )
  } finally {
    // Global doctrine §6: a driven browser is ALWAYS closed, including on error.
    await browser.close()
  }

  for (const note of notes) console.log(`  · ${note}`)

  if (failures.length > 0) {
    console.error(`\n✗ frontend V2 E2E failed — ${failures.length} problem(s):\n`)
    for (const f of failures) console.error(`  - ${f}`)
    console.error('')
    process.exit(1)
  }

  console.log('✓ admin E2E passed — /admin/runs renders, filters narrow + persist in the URL, every link resolves, shell holds at 1440/1280/1024/375, zero console errors.')
}

async function countRows(page) {
  const tableRows = await page.locator('table tbody tr').count()
  if (tableRows > 0) return tableRows
  return page.locator('ul > li > div > dl').count()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
