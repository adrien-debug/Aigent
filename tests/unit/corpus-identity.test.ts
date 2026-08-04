import { describe, expect, it } from 'vitest'

import {
  CORPUS_SCHEMA_VERSION,
  hashCanonicalCorpus,
  type CanonicalCorpusEntry,
} from '@/lib/agent-mission-control/corpus-identity'

const entries: CanonicalCorpusEntry[] = [
  {
    suiteId: 'suite-b',
    suiteKind: 'behavior',
    caseId: 'case-2',
    input: { b: 2, a: 1 },
    expectedBehavior: 'answer',
    expectedToolCalls: ['read_b', 'read_a'],
  },
  {
    suiteId: 'suite-a',
    suiteKind: 'safety',
    caseId: 'case-1',
    input: 'refuse',
    expectedBehavior: 'refuse safely',
    expectedToolCalls: [],
  },
]

describe('canonical corpus identity', () => {
  it('is stable across entry and object-key ordering', () => {
    const reordered = [
      entries[1],
      {
        ...entries[0],
        input: { a: 1, b: 2 },
        expectedToolCalls: ['read_a', 'read_b'],
      },
    ]
    expect(hashCanonicalCorpus(entries)).toBe(hashCanonicalCorpus(reordered))
    expect(hashCanonicalCorpus(entries)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when evaluated content changes', () => {
    const changed = entries.map((entry) =>
      entry.caseId === 'case-1' ? { ...entry, expectedBehavior: 'allow' } : entry,
    )
    expect(hashCanonicalCorpus(changed)).not.toBe(hashCanonicalCorpus(entries))
  })

  it('includes the explicit schema version in the contract', () => {
    expect(CORPUS_SCHEMA_VERSION).toBe('aigent-corpus/v1')
  })

  it('refuses NaN instead of producing a flattering stable hash', () => {
    expect(() =>
      hashCanonicalCorpus([{ ...entries[0], input: { value: Number.NaN } }]),
    ).toThrow(/non-finite/)
  })
})
