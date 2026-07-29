/**
 * AIG-AGENT-QUALITY-005 — Lot F1: an unmeasured cost is null, never a fake 0,
 * and the UI renders it as the word `Indisponible`, never "$0.00".
 *
 * The false zero this guards: a LangGraph run whose messages carry no provider
 * usage_metadata (e.g. a tool-call AI message with empty content, or an
 * interrupted run) used to be priced by estimating tokens from content → 0,
 * indistinguishable from a genuinely-free run. Now it is null (unavailable).
 *
 * VOCABULARY. This file used to pin an em dash here while every console screen
 * rendered the word `Indisponible` — one absence, two spellings, so a caller
 * that forgot to narrow its null printed punctuation the reader could not tell
 * from a layout artefact. `formatUsd` now returns the same word the screens do.
 */
import { describe, expect, it } from 'vitest'

import { formatUsd, UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import { costFromMessages } from '@/lib/agent-mission-control/langgraph-server'

describe('costFromMessages — unmeasured usage is null, never a fabricated 0', () => {
  it('returns null when no AI message carries provider usage_metadata', () => {
    // A tool-call AI message (empty content, no usage) + a tool result. This is
    // exactly the interrupted-run shape that used to price to 0.
    const messages = [
      { type: 'ai', content: '', tool_calls: [{ name: 'draft_copilot_spec', id: 'c1' }] },
      { type: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
    ]
    expect(costFromMessages(messages as never)).toBeNull()
  })

  it('returns a real measured cost when usage_metadata is present', () => {
    const messages = [
      {
        type: 'ai',
        content: 'done',
        usage_metadata: { input_tokens: 1000, output_tokens: 200 },
        response_metadata: { model_name: 'gpt-5.4' },
      },
    ]
    const cost = costFromMessages(messages as never)
    expect(cost).not.toBeNull()
    expect(cost).toBeGreaterThan(0)
  })
})

describe('formatUsd — unknown cost renders as `Indisponible`, never "$0.00"', () => {
  it('null / undefined → the console\'s one absence word, not punctuation', () => {
    expect(formatUsd(null)).toBe(UNAVAILABLE_LABEL)
    expect(formatUsd(undefined)).toBe(UNAVAILABLE_LABEL)
    // Pinned as a literal too: the constant could be changed to anything and
    // the assertion above would follow it. This is the word that shipped.
    expect(UNAVAILABLE_LABEL).toBe('Indisponible')
    expect(formatUsd(null)).not.toBe('—')
  })
  it('a real 0 is a real $0.00 (measured zero, not unknown)', () => {
    expect(formatUsd(0)).toBe('$0.00')
    // …and the `digits` argument still applies to it. A measured zero is a
    // FIGURE and keeps the precision of the column it sits in; only the absence
    // leaves the currency shape entirely.
    expect(formatUsd(0, 4)).toBe('$0.0000')
    expect(formatUsd(-0)).toBe('$0.00')
  })
  it('a real amount formats normally', () => {
    expect(formatUsd(0.0032, 4)).toBe('$0.0032')
    expect(formatUsd(12.5)).toBe('$12.50')
    expect(formatUsd(1234.567)).toBe('$1234.57')
  })

  it('a POSITIVE amount never prints as $0.00 — `digits` is a floor, not a width', () => {
    // This expectation was inverted on purpose. It previously asserted
    // `formatUsd(0.004) === '$0.00'`, i.e. it PINNED the defect: a measured,
    // positive cost rendered as the same string a free run would produce.
    // That is the fabricated `$0.00` this module already refuses, arriving by
    // rounding instead of by coalescing.
    //
    // Not theoretical — measured against live `agent_runs`: 5 of the 21 most
    // recently priced runs are positive yet round away at two decimals, and
    // 0.003135 read "$0.00" on /admin/runs while the SAME field read "$0.0031"
    // on /admin/agents/[id]. One field, two screens, two different claims.
    expect(formatUsd(0.004)).toBe('$0.004')
    expect(formatUsd(0.003135)).toBe('$0.003')
    // Escalation is bounded, and it only ever fires when the value would
    // otherwise read as zero — ordinary amounts keep their intended width.
    expect(formatUsd(0.0000004)).toBe('$0.0000004')
    expect(formatUsd(18.42)).toBe('$18.42')
  })
  it('a non-finite number is an ABSENCE, not a figure — NaN and both infinities', () => {
    // `NaN` is what a partially-written `health` jsonb summed to before the
    // gate existed; the infinities are what a division by a zero denominator
    // produces. Neither is a measurement, and neither may print as currency.
    expect(formatUsd(Number.NaN)).toBe(UNAVAILABLE_LABEL)
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe(UNAVAILABLE_LABEL)
    expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe(UNAVAILABLE_LABEL)
  })
})

/**
 * THE SECOND MEANING, and why no caller has it.
 *
 * A dash can legitimately mean "this cell is STRUCTURALLY NOT APPLICABLE" —
 * a different statement from "this measurement was never taken", and collapsing
 * the two would be its own lie. So before `formatUsd` stopped returning "—",
 * all ten of its call sites were audited for that second meaning. NINE narrow
 * their null before calling and render `<Unavailable />` themselves; the tenth
 * (`agent-detail-screen.tsx`, the manifest's max-cost-per-run ceiling) does not
 * narrow — and is not a "not applicable" case either, because the column it
 * reads is `not null`. The absent branch there is unreachable, and if it ever
 * fired it would mean an unreadable row, for which the word is the honest
 * reading.
 *
 * Conclusion, pinned below rather than asserted in prose: this layer has ONE
 * meaning of absence, so `formatUsd` needs ONE branch and no parameter. If a
 * genuine not-applicable cell ever appears, these tests are what must be
 * revisited — the fix is a second formatter or an explicit argument, never
 * reusing this word for it.
 */
describe('the absence vocabulary stays ONE word', () => {
  async function readSource(relativePath: string): Promise<string> {
    const fs = await import('node:fs/promises')
    return fs.readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8')
  }

  it('the word is spelled ONCE in src/ — every other layer takes the constant', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const root = new URL('../../', import.meta.url).pathname

    // `grep -rn` over the shipped sources, exit code 1 (no match) tolerated.
    const out = await promisify(execFile)('grep', ['-rn', "'Indisponible'", `${root}src`]).then(
      (r) => r.stdout,
      (e: { code?: number; stdout?: string }) => {
        if (e.code === 1) return ''
        throw e
      }
    )
    const hits = out.split('\n').filter((line) => line.trim() !== '')

    // Exactly one CODE occurrence: the constant's own declaration. Anything else
    // is a second literal — the way the two spellings ("—" in the formatter,
    // the word on the screens) diverged in the first place.
    expect(hits).toHaveLength(1)
    expect(hits[0]).toContain('src/lib/agent-mission-control/format.ts')
    expect(hits[0]).toContain('export const UNAVAILABLE_LABEL')
  })

  it('formatUsd has exactly ONE absence branch, and it returns the shared constant', async () => {
    const source = await readSource('src/lib/agent-mission-control/format.ts')
    const body = source.slice(source.indexOf('export function formatUsd'))

    // One guard, one word. A second `return '…'` in that guard would be a
    // second vocabulary; a `?? 0` there would be the fabricated zero.
    expect(body).toMatch(/if \(amount == null \|\| !Number\.isFinite\(amount\)\) return UNAVAILABLE_LABEL/)
    expect(body.slice(0, body.indexOf('\n}'))).not.toMatch(/return '—'|return "—"|\?\?\s*0/)
  })

  it('the unnarrowed caller reads a NOT NULL column — its absence is unreachable, not "not applicable"', async () => {
    // The evidence the audit rests on, checked instead of quoted: if a later
    // migration ever makes this column nullable, "absent" becomes a REAL state
    // there and the site needs a decision (a ceiling that is genuinely not
    // configured is not the same statement as one that could not be read).
    const migration = await readSource('supabase/migrations/0001_agent_mission_control.sql')
    expect(migration).toMatch(/max_cost_per_run_usd\s+numeric\s+not null/)
  })
})
