/**
 * `count_words` — typed re-export of the single-source pure implementation
 * (src/langgraph/tools/count-words.mjs), for TypeScript consumers + tests.
 *
 * The pure logic lives in the .mjs so the executable graph registry (which
 * cannot import .ts) and the TS layer share ONE implementation — the graph and
 * the tests can never diverge on behaviour. This file only adds the types.
 *
 * A local-deterministic tool built through the Tool Builder as the proof the
 * pipeline yields a real, mountable, certified tool (AIGENT-CORE-FACTORY-035).
 */
import { countWords as countWordsImpl } from '@/../src/langgraph/tools/count-words.mjs'

export interface CountWordsResult {
  ok: true
  words: number
  characters: number
  /** Longest single whitespace-delimited token length (0 for empty input). */
  longestWord: number
}

/**
 * Count words + characters in `text`. Words are maximal runs of non-whitespace.
 * Empty/whitespace-only input yields zeroes — a MEASURED zero, never fabricated.
 */
export function countWords(text: string): CountWordsResult {
  return countWordsImpl(text) as CountWordsResult
}
