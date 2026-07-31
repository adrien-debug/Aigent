/**
 * Unit tests — every internal href the operator action queue emits must resolve
 * to a route that actually exists.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `buildActionItems` is the only place in the codebase that fabricates
 * navigation targets from data. When the frontend was reset, `/admin` was
 * deleted and `check:no-legacy-front` now forbids its return — but the builder
 * kept minting `/admin/...` hrefs, so 9 of the queue's 10 links were 404s that
 * no gate could see. Rewriting them to `/agents/:id`, `/projects/:id` and
 * `/projects/:id/builder` fixes the dead prefix; it does NOT by itself prove the
 * new targets exist. This file closes both halves:
 *
 *  1. no href may ever start with `/admin` again — a permanent regression lock;
 *  2. every internal href must match a real `src/app/**\/page.tsx` route — the
 *     debt marker, see `it.fails` below.
 *
 * The one href deliberately exempt from route-resolution is `pr_open`'s, which
 * carries `evt.prUrl` — an absolute GitHub URL, external and alive.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildActionItems, type ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

const APP_DIR = path.resolve(__dirname, '../../src/app')

/**
 * The routes Next.js can actually serve, derived from the filesystem rather
 * than from a hand-kept list — a hardcoded list would go stale exactly when it
 * matters (the day PR 3/4/5 land) and keep this file lying in the safe
 * direction. Dynamic segments become `:param`, route groups `(x)` and private
 * folders `_x` collapse away, and only directories holding a `page.tsx` count:
 * a `route.ts` answers fetches, never a browser navigation from a link.
 */
function discoverPageRoutes(dir: string = APP_DIR, prefix = ''): string[] {
  const routes: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })

  if (entries.some((e) => e.isFile() && /^page\.(tsx|ts|jsx|js)$/.test(e.name))) {
    routes.push(prefix === '' ? '/' : prefix)
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const name = entry.name
    if (name.startsWith('_') || name === 'api' || name === 'node_modules') continue

    // Route group `(marketing)` and parallel slot `@slot` add no URL segment.
    const segment = name.startsWith('(') || name.startsWith('@')
      ? ''
      : name.startsWith('[')
        ? `/:${name.replace(/^\[+\.*/, '').replace(/\]+$/, '')}`
        : `/${name}`

    routes.push(...discoverPageRoutes(path.join(dir, name), prefix + segment))
  }

  return routes
}

/** `/projects/proj-trade/builder` → `/projects/:projectId/builder`, so a
 *  concrete href can be compared against a dynamic route pattern. Ids in this
 *  fixture are deliberately unlike any literal segment name. */
function normalizeHref(href: string): string {
  return href
    .split('/')
    .map((seg) => (DYNAMIC_VALUES.has(seg) ? ':param' : seg))
    .join('/')
}

function normalizeRoute(route: string): string {
  return route
    .split('/')
    .map((seg) => (seg.startsWith(':') ? ':param' : seg))
    .join('/')
}

const DYNAMIC_VALUES = new Set(['proj-trade', 'c-btc', 'c-sandbox', 'c-gate'])

// ---------------------------------------------------------------------------
// Fixtures — one entry per ActionItemKind, so the extraction below is exhaustive
// ---------------------------------------------------------------------------

function copilot(id: string, name: string): Copilot {
  return {
    id,
    name,
    projectId: 'proj-trade',
    targetProjectIds: [],
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    description: '',
    runtime: 'langgraph',
    status: 'draft',
    productionVersionId: null,
    latestVersionId: 'v1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'adrien',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    health: {
      testPassRate: 1,
      benchmarkScore: 90,
      runsLast24h: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: 0,
    },
  }
}

const PROJECT: Project = {
  id: 'proj-trade',
  name: 'TradeAgent',
  slug: 'tradeagent',
  description: '',
  platform: 'web',
  repoFullName: 'adrien-debug/TradeAgent',
  createdAt: '2026-01-01T00:00:00Z',
}

function deliveryEvent(status: string): DeliveryEvent {
  return {
    id: `evt_${status}`,
    mode: 'pull_request',
    targetRepo: 'adrien-debug/TradeAgent',
    targetBranch: 'main',
    deliveryBranch: 'agent/btc',
    commitSha: 'abc',
    commitUrl: 'u',
    prUrl: 'https://github.com/adrien-debug/TradeAgent/pull/4',
    prNumber: 4,
    status,
    createdAt: '2026-07-16T00:00:00Z',
  }
}

/**
 * Two calls, because one cannot produce every kind at once: the three
 * `data_unavailable` items only exist when their source read returned `null`,
 * and a `null` read is precisely the state in which the items built FROM that
 * read cannot exist. `limit` is raised well past the default 6 so nothing is
 * truncated away before it can be inspected.
 */
function allActionItems() {
  const copilotsById = new Map([
    ['c-btc', copilot('c-btc', 'BTC Alert')],
    ['c-sandbox', copilot('c-sandbox', 'Sandbox Agent')],
    ['c-gate', copilot('c-gate', 'Gate Agent')],
  ])
  const projectsById = new Map([[PROJECT.id, PROJECT]])

  // Pass 1 — every item built from a SUCCESSFUL read.
  const populated = buildActionItems({
    copilotsById,
    projectsById,
    latestDeliveryByCopilot: new Map([
      ['c-btc', deliveryEvent('ready_for_manual_test')], // ready_manual + pr_open
      ['c-sandbox', deliveryEvent('execute_failed')],
      ['c-gate', deliveryEvent('fixing')],
    ]),
    latestSandboxByCopilot: new Map([
      [
        'c-sandbox',
        {
          copilotId: 'c-sandbox',
          status: 'failed' as const,
          sandboxFitScore: 0,
          repoFitScore: null,
          repo: 'r',
          createdAt: 't',
        },
      ],
    ]),
    scorecards: new Map([
      [
        'c-gate',
        { score: 40, level: 'not_ready', blockers: ['release_gate_red'], repoFitScore: 50, releaseGateRed: true },
      ],
    ]),
    missionRuns: [
      {
        id: 'mr-1',
        projectId: 'proj-trade',
        objective: 'ship',
        status: 'blocked',
        decision: 'blocked',
        repo: 'adrien-debug/TradeAgent',
        updatedAt: '2026-07-16T00:00:00Z',
        report: null,
      },
      // A blocked mission whose project is NOT in projectsById — the branch that
      // falls back to the bare root href instead of a project page.
      {
        id: 'mr-2',
        projectId: 'proj-unknown',
        objective: 'ship',
        status: 'blocked',
        decision: 'blocked',
        repo: null,
        updatedAt: '2026-07-16T00:00:00Z',
        report: null,
      },
    ],
    dataWarnings: [],
    pendingArchitectApprovals: [
      { conversationId: 'conv-1', projectId: 'proj-trade', threadId: 'thread-abc', updatedAt: '2026-01-01T00:00:00Z' },
    ],
    limit: 50,
  })

  // Pass 2 — the three failed-read items.
  const unavailable = buildActionItems({
    copilotsById,
    projectsById,
    latestDeliveryByCopilot: null,
    latestSandboxByCopilot: null,
    scorecards: new Map(),
    missionRuns: [],
    dataWarnings: [],
    pendingArchitectApprovals: null,
    limit: 50,
  })

  return [...populated, ...unavailable]
}

/** External (absolute) hrefs are out of scope — they are not app routes. */
function internalHrefs(items: ReturnType<typeof allActionItems>): string[] {
  return items.map((i) => i.href).filter((h) => h.startsWith('/'))
}

describe('action-queue hrefs', () => {
  it('the fixture exercises every ActionItemKind — otherwise the checks below prove less than they claim', () => {
    const kinds = new Set(allActionItems().map((i) => i.kind))
    const expected: ActionItemKind[] = [
      'architect_approval',
      'ready_manual',
      'sandbox_failed',
      'release_gate_red',
      'pr_open',
      'mission_blocked',
      'data_unavailable',
    ]
    expect([...kinds].toSorted()).toEqual([...expected].toSorted())
  })

  it('no href points at /admin — the console was deleted and check:no-legacy-front forbids its return', () => {
    const offenders = allActionItems()
      .filter((i) => i.href === '/admin' || i.href.startsWith('/admin/'))
      .map((i) => `${i.kind} → ${i.href}`)
    expect(offenders).toEqual([])
  })

  it("the pr_open item keeps its external GitHub URL — it is alive and must not be rewritten to a local route", () => {
    const pr = allActionItems().find((i) => i.kind === 'pr_open')
    expect(pr?.href).toBe('https://github.com/adrien-debug/TradeAgent/pull/4')
  })

  it('route discovery finds the cockpit root — a broken scanner would make the debt check below vacuously green', () => {
    expect(discoverPageRoutes()).toContain('/')
  })

  /**
   * ⚠️ CARRIES KNOWN DEBT — EXPECTED TO FAIL TODAY (2026-07-31).
   *
   * `it.fails` inverts the verdict, so this reads as "1 expected fail" and keeps
   * `npm test` / CI green while the debt is outstanding. It is NOT `it.skip`:
   * a skipped test proves nothing and dies quietly, whereas this one FLIPS TO
   * RED ("Expect test to fail") the moment the missing routes land — which is
   * the signal to delete the `.fails` marker and let it stand as a plain
   * assertion. In other words, the marker removes itself by breaking the build.
   *
   * Missing today: `/agents/:id`, `/projects/:id`, `/projects/:id/builder`,
   * arriving with PR 3, 4 and 5 of the product restoration.
   */
  it.fails(
    'DEBT: every internal action-queue href resolves to a real page route (needs /agents/:id, /projects/:id, /projects/:id/builder — PR 3/4/5)',
    () => {
      const known = new Set(discoverPageRoutes().map(normalizeRoute))
      const missing = [...new Set(internalHrefs(allActionItems()))]
        .filter((href) => !known.has(normalizeHref(href)))
        .toSorted()

      expect(
        missing,
        `Action-queue hrefs pointing at routes that do not exist:\n` +
          missing.map((m) => `  · ${m}  (normalized: ${normalizeHref(m)})`).join('\n') +
          `\n\nRoutes actually present under src/app:\n` +
          [...known].toSorted().map((r) => `  · ${r}`).join('\n') +
          `\n\nThese arrive with PR 3 (/agents/:id), PR 4 (/projects/:id) and ` +
          `PR 5 (/projects/:id/builder) of the product restoration. When they do, ` +
          `this test starts passing and vitest will report "Expect test to fail" — ` +
          `remove the \`.fails\` marker at that point.`
      ).toEqual([])
    }
  )
})
