/**
 * Unit tests for the Tool Builder (AIGENT-CORE-FACTORY-035).
 *
 * Proves the ONE thing the builder exists to guarantee: a tool becomes
 * CERTIFIED because a test PROVED it, never because the literal was typed.
 * Covers the spec validation, the DRAFT→…→CERTIFIED state machine, the sandbox
 * that produces real evidence, the count_words proof tool's behaviour, and the
 * full pipeline end to end.
 */
import { describe, expect, it } from 'vitest'

import {
  beginImplementing,
  beginTesting,
  certifyMission,
  deprecateMission,
  isCertified,
  startToolBuild,
  validateToolSpec,
  type ToolBuildSpec,
} from '@/lib/agent-mission-control/tool-builder/mission'
import { runToolSandbox } from '@/lib/agent-mission-control/tool-builder/sandbox'
import { countWords } from '@/lib/agent-mission-control/tool-builder/tools/count-words'

const goodSpec: ToolBuildSpec = {
  id: 'count_words',
  version: '1.0.0',
  label: 'Count words',
  summary: 'Count words in a text.',
  kind: 'local-deterministic',
  mutates: false,
  risk: 'low',
  requiresConfirmation: false,
  secretRefs: [],
}

describe('validateToolSpec', () => {
  it('accepts a valid local-deterministic spec', () => {
    expect(validateToolSpec(goodSpec)).toEqual([])
  })

  it('rejects a non snake_case id, a non-semver version, empty label/summary', () => {
    const problems = validateToolSpec({ ...goodSpec, id: 'CountWords', version: 'v1', label: ' ', summary: '' })
    expect(problems.some((p) => p.includes('snake_case'))).toBe(true)
    expect(problems.some((p) => p.includes('semver'))).toBe(true)
    expect(problems.some((p) => p.includes('label'))).toBe(true)
    expect(problems.some((p) => p.includes('summary'))).toBe(true)
  })

  it('refuses a non-local kind (only local-deterministic is buildable today)', () => {
    expect(validateToolSpec({ ...goodSpec, kind: 'http-get' }).some((p) => p.includes('not buildable'))).toBe(true)
  })

  it('refuses a local tool that mutates or requires secrets', () => {
    expect(validateToolSpec({ ...goodSpec, mutates: true }).some((p) => p.includes('cannot mutate'))).toBe(true)
    expect(
      validateToolSpec({ ...goodSpec, secretRefs: ['SOME_KEY'] }).some((p) => p.includes('must not require secrets')),
    ).toBe(true)
  })
})

describe('state machine — certification is EARNED by proof', () => {
  it('an invalid spec is REJECTED at start, never enters DRAFT', () => {
    const m = startToolBuild({ ...goodSpec, id: 'BAD ID' })
    expect(m.state).toBe('REJECTED')
    expect(m.rejectionReason).toBeTruthy()
  })

  it('a valid spec walks DRAFT → IMPLEMENTING → TESTING', () => {
    let m = startToolBuild(goodSpec)
    expect(m.state).toBe('DRAFT')
    m = beginImplementing(m)
    expect(m.state).toBe('IMPLEMENTING')
    m = beginTesting(m)
    expect(m.state).toBe('TESTING')
  })

  it('CERTIFIED requires passing evidence — never certifies without a run', () => {
    let m = beginTesting(beginImplementing(startToolBuild(goodSpec)))
    m = certifyMission(m, { ran: false, passed: 0, failed: 0 })
    expect(m.state).toBe('REJECTED')
    expect(m.rejectionReason).toContain('never ran')
    expect(isCertified(m)).toBe(false)
  })

  it('CERTIFIED is refused when any test failed', () => {
    let m = beginTesting(beginImplementing(startToolBuild(goodSpec)))
    m = certifyMission(m, { ran: true, passed: 3, failed: 1 })
    expect(m.state).toBe('REJECTED')
    expect(m.rejectionReason).toContain('1 test(s) failed')
  })

  it('CERTIFIED is refused when zero tests passed', () => {
    let m = beginTesting(beginImplementing(startToolBuild(goodSpec)))
    m = certifyMission(m, { ran: true, passed: 0, failed: 0 })
    expect(m.state).toBe('REJECTED')
  })

  it('CERTIFIED only on real passing evidence, then deprecatable', () => {
    let m = beginTesting(beginImplementing(startToolBuild(goodSpec)))
    m = certifyMission(m, { ran: true, passed: 5, failed: 0 })
    expect(m.state).toBe('CERTIFIED')
    expect(isCertified(m)).toBe(true)
    m = deprecateMission(m)
    expect(m.state).toBe('DEPRECATED')
  })

  it('transitions are guarded — you cannot skip states', () => {
    const draft = startToolBuild(goodSpec)
    // certify straight from DRAFT does nothing (must be TESTING)
    expect(certifyMission(draft, { ran: true, passed: 1, failed: 0 }).state).toBe('DRAFT')
    // beginTesting from DRAFT does nothing (must be IMPLEMENTING)
    expect(beginTesting(draft).state).toBe('DRAFT')
  })
})

describe('sandbox — produces real evidence', () => {
  it('all-pass cases yield ran:true, failed:0', () => {
    const ev = runToolSandbox((x: number) => x * 2, [
      { name: 'two', input: 2, expected: 4 },
      { name: 'zero', input: 0, expected: 0 },
    ])
    expect(ev).toMatchObject({ ran: true, passed: 2, failed: 0 })
  })

  it('a wrong output is a FAIL with a detail line', () => {
    const ev = runToolSandbox((x: number) => x * 2, [{ name: 'bad', input: 2, expected: 5 }])
    expect(ev.failed).toBe(1)
    expect(ev.detail).toContain('bad')
  })

  it('a throwing tool counts as failed, never crashes the builder', () => {
    const ev = runToolSandbox(() => {
      throw new Error('boom')
    }, [{ name: 'explodes', input: 1, expected: 1 }])
    expect(ev.failed).toBe(1)
    expect(ev.detail).toContain('boom')
  })

  it('no cases → ran:false (nothing proven)', () => {
    expect(runToolSandbox((x: number) => x, [])).toMatchObject({ ran: false })
  })
})

describe('count_words — the proof tool behaviour', () => {
  it('counts words, characters and the longest token', () => {
    expect(countWords('the quick brown fox')).toEqual({ ok: true, words: 4, characters: 19, longestWord: 5 })
  })

  it('empty/whitespace-only text is a measured zero, never fabricated', () => {
    expect(countWords('   ')).toEqual({ ok: true, words: 0, characters: 3, longestWord: 0 })
    expect(countWords('')).toEqual({ ok: true, words: 0, characters: 0, longestWord: 0 })
  })

  it('collapses arbitrary unicode whitespace runs', () => {
    expect(countWords('a\t\n  b').words).toBe(2)
  })

  it('is deterministic — same input, same output', () => {
    expect(countWords('repeat me')).toEqual(countWords('repeat me'))
  })
})

describe('FULL PIPELINE end to end — spec → build → sandbox → certify', () => {
  it('count_words is certified because its sandbox tests PASS', () => {
    // 1) spec → 2) walk states → 3) run the REAL sandbox over count_words →
    // 4) certify only on that real evidence.
    let m = beginTesting(beginImplementing(startToolBuild(goodSpec)))
    const evidence = runToolSandbox(countWords, [
      { name: 'sentence', input: 'the quick brown fox', expected: { ok: true, words: 4, characters: 19, longestWord: 5 } },
      { name: 'empty', input: '', expected: { ok: true, words: 0, characters: 0, longestWord: 0 } },
    ])
    expect(evidence).toMatchObject({ ran: true, failed: 0 })
    m = certifyMission(m, evidence)
    expect(m.state).toBe('CERTIFIED')
    expect(m.evidence?.passed).toBe(2)
  })

  it('a tool whose sandbox FAILS is rejected end to end (no false certification)', () => {
    let m = beginTesting(beginImplementing(startToolBuild(goodSpec)))
    // Feed count_words a WRONG expectation → sandbox reports a failure → reject.
    const evidence = runToolSandbox(countWords, [
      { name: 'wrong', input: 'one two', expected: { ok: true, words: 99, characters: 7, longestWord: 3 } },
    ])
    expect(evidence.failed).toBe(1)
    m = certifyMission(m, evidence)
    expect(m.state).toBe('REJECTED')
  })
})
