/**
 * Agents-wanted context loader — reads AGENTS-WANTED.md from the linked consumer
 * repo (read-only, fail-soft) and returns a formatted block for Agent Builder /
 * project architect context. Only the **open requests** section is injected —
 * never the full file verbatim if it is still the provision scaffold placeholder.
 */
import 'server-only'

import { AGENTS_WANTED_PATH } from './consumer-bootstrap'
import { getRepoFile } from './github'

export const MAX_AGENTS_WANTED_CHARS = 8_000

const PLACEHOLDER_RE = /^_No open requests yet\b/i

/** Strip HTML comments from a markdown fragment. */
function stripHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim()
}

/**
 * Extract content under `## Open requests` until the next H2 or EOF.
 * Returns null when the section is absent, empty, or still the scaffold placeholder.
 */
export function parseAgentsWantedOpenSection(markdown: string): string | null {
  const openMatch = markdown.match(/^## Open requests\s*$/im)
  if (!openMatch || openMatch.index === undefined) return null

  const afterOpen = markdown.slice(openMatch.index + openMatch[0].length).replace(/^\s*\n?/, '')
  const fulfilledMatch = afterOpen.match(/^## Fulfilled\s*$/im)
  const rawSection = fulfilledMatch?.index !== undefined ? afterOpen.slice(0, fulfilledMatch.index) : afterOpen

  const body = stripHtmlComments(rawSection)
  if (!body) return null
  if (PLACEHOLDER_RE.test(body)) return null

  return body
}

/** Format an open-requests section for LLM context. */
export function formatAgentsWantedContext(section: string | null): string {
  if (!section?.trim()) return ''
  const body = section.length > MAX_AGENTS_WANTED_CHARS ? section.slice(0, MAX_AGENTS_WANTED_CHARS) : section
  return `## Workspace agent demand (AGENTS-WANTED.md)\n\n${body}`
}

/**
 * Fetch raw AGENTS-WANTED.md from GitHub. Fail-soft: 404 → null; other errors log + null.
 * Never logs file content.
 */
export async function fetchAgentsWantedRaw(repoFullName: string): Promise<string | null> {
  try {
    const file = await getRepoFile(repoFullName, AGENTS_WANTED_PATH)
    const text = file.text.trim()
    return text.length > 0 ? text : null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/GitHub 404 /.test(msg)) {
      console.error(`[agents-wanted] failed to read ${AGENTS_WANTED_PATH} from ${repoFullName}`)
    }
    return null
  }
}

/**
 * Load and format open agent demand for architect / builder context.
 * Returns null when unavailable, unconfigured, or no real open requests.
 */
export async function loadAgentsWantedContext(
  repoFullName: string | undefined | null
): Promise<string | null> {
  if (!repoFullName || !process.env.GITHUB_TOKEN) return null

  const raw = await fetchAgentsWantedRaw(repoFullName)
  if (!raw) return null

  const section = parseAgentsWantedOpenSection(raw)
  const formatted = formatAgentsWantedContext(section)
  return formatted.length > 0 ? formatted : null
}

/**
 * Append AGENTS-WANTED open requests to an existing repo context block (fail-soft).
 */
export async function appendAgentsWantedToContext(
  base: string | undefined,
  repoFullName: string | undefined | null
): Promise<string | undefined> {
  try {
    const wantedBlock = await loadAgentsWantedContext(repoFullName)
    if (!wantedBlock) return base
    return base ? `${base}\n\n${wantedBlock}` : wantedBlock
  } catch {
    return base
  }
}
