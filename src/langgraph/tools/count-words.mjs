/**
 * `count_words` pure implementation (JS, single source).
 *
 * Lives in .mjs so BOTH the executable graph registry (tool-registry.mjs, which
 * cannot import .ts) and the TypeScript layer (via the count-words.ts re-export)
 * call the exact same function — the graph and the tests can never diverge on
 * behaviour. Pure, deterministic, no IO, no secret.
 */

/**
 * @param {string} text
 * @returns {{ ok: true, words: number, characters: number, longestWord: number }}
 */
export function countWords(text) {
  const normalized = typeof text === 'string' ? text : String(text ?? '')
  const tokens = normalized.split(/\s+/u).filter((t) => t.length > 0)
  const longestWord = tokens.reduce((max, t) => (t.length > max ? t.length : max), 0)
  return { ok: true, words: tokens.length, characters: normalized.length, longestWord }
}
