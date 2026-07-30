/**
 * Agent Mission Control — the `forbiddenActions` → tool matching rule.
 *
 * ONE rule, ONE implementation for the whole TypeScript side. It used to exist
 * twice (`runner.ts` pre-execution, `benchmark-runner.ts` after the fact); if
 * the two ever drifted, a call would be blocked live and passed at benchmark —
 * or, worse, the reverse: a benchmark green-lighting a tool the runtime would
 * have refused.
 *
 * MIRRORED IN `src/langgraph/agent-builder-graph.mjs`. The LangGraph Agent
 * Server is a separate Node process that cannot import this `server-only` lib
 * tree, so a third copy lives there by necessity (same precedent as
 * `pgrest.mjs` / `temporal-context.mjs`). CHANGE ONE, CHANGE THE OTHER —
 * `tests/unit/runner-forbidden-actions.test.ts` pins the shared semantics.
 *
 * PURE: no imports, no I/O, no `server-only` marker, so every path — server
 * lib, route handler, test — can reach it.
 */

/** Trim + lowercase, the single normalization both sides of the match share. */
export function normalizeToolName(value: string): string {
  return value.trim().toLowerCase()
}

function isToolBoundaryChar(char: string): boolean {
  return char === '' || !/[a-z0-9_.-]/.test(char)
}

/**
 * Does a `forbiddenActions` entry designate this tool?
 *
 * Entries are free text authored by the Architect ("never call
 * delete_customer", or just "delete_customer"), so a tool counts as forbidden
 * when its name appears as a WHOLE TOKEN inside the entry. A word boundary is
 * required on BOTH sides — anything outside `[a-z0-9_.-]` — so a ban on
 * `delete_customer` does not also catch `delete_customer_note`, nor the
 * reverse. Matching is deliberately substring-based rather than regex-built
 * from the tool name: tool names are user data and would otherwise need
 * escaping before ever reaching a `RegExp`.
 */
export function forbiddenEntryTargetsTool(entry: string, toolName: string): boolean {
  const name = normalizeToolName(toolName)
  if (name.length === 0) return false
  const haystack = normalizeToolName(entry)
  if (haystack === name) return true
  let from = 0
  for (;;) {
    const at = haystack.indexOf(name, from)
    if (at < 0) return false
    const before = at === 0 ? '' : haystack[at - 1]
    const after = haystack[at + name.length] ?? ''
    if (isToolBoundaryChar(before) && isToolBoundaryChar(after)) return true
    from = at + 1
  }
}
