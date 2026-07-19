import { describe, expect, it } from 'vitest'

import {
  MAX_AGENTS_WANTED_CHARS,
  formatAgentsWantedContext,
  parseAgentsWantedOpenSection,
} from '@/lib/agent-mission-control/agents-wanted'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full AGENTS-WANTED.md as provisioned by consumer-bootstrap (scaffold default). */
const SCAFFOLD_DEFAULT = `# Agents wanted — MyProject

This file is the **demand channel** from this workspace to Aigent.

## Open requests

<!-- Add one block per need. Example:

### Risk dashboard sentinel
- **Priority:** high
- **Why:** …

-->

_No open requests yet — describe the first agent you need above._

## Fulfilled

<!-- Moved here when Aigent pushes an agent that covers the request. -->
`

/** File with one real open request. */
const WITH_REQUEST = `# Agents wanted — MyProject

## Open requests

### Slack notifier
- **Priority:** medium
- **Why:** Alert the team when ETH exposure exceeds policy.
- **Tools:** market snapshots, Slack webhook

## Fulfilled

### Old agent
- Done.
`

/** File where "## Open requests" is missing entirely. */
const NO_SECTION = `# Agents wanted — MyProject

## Fulfilled

### Something
- Done.
`

/** File with requests + HTML comment mixed in. */
const WITH_COMMENT = `## Open requests

<!-- This is an example, ignore it.

Multi-line comment block.
-->

### Real request
- **Priority:** high
- **Why:** Needed for compliance.

## Fulfilled
`

/** File where open section has only an HTML comment and nothing else. */
const COMMENT_ONLY = `## Open requests

<!-- placeholder left from template -->

## Fulfilled
`

// ---------------------------------------------------------------------------
// parseAgentsWantedOpenSection
// ---------------------------------------------------------------------------

describe('parseAgentsWantedOpenSection', () => {
  it('returns null for the scaffold placeholder', () => {
    expect(parseAgentsWantedOpenSection(SCAFFOLD_DEFAULT)).toBeNull()
  })

  it('returns null when "## Open requests" heading is absent', () => {
    expect(parseAgentsWantedOpenSection(NO_SECTION)).toBeNull()
  })

  it('returns null for a section that is empty after stripping HTML comments', () => {
    expect(parseAgentsWantedOpenSection(COMMENT_ONLY)).toBeNull()
  })

  it('extracts the open section and stops at "## Fulfilled"', () => {
    const result = parseAgentsWantedOpenSection(WITH_REQUEST)
    expect(result).not.toBeNull()
    expect(result).toContain('Slack notifier')
    // Must NOT include content from "## Fulfilled"
    expect(result).not.toContain('## Fulfilled')
    expect(result).not.toContain('Old agent')
  })

  it('strips HTML comments from the section', () => {
    const result = parseAgentsWantedOpenSection(WITH_COMMENT)
    expect(result).not.toBeNull()
    // Comment block removed
    expect(result).not.toContain('placeholder left from template')
    expect(result).not.toContain('<!--')
    expect(result).not.toContain('-->')
    // Real content preserved
    expect(result).toContain('Real request')
    expect(result).toContain('Needed for compliance')
  })

  it('trims leading/trailing whitespace from the extracted section', () => {
    const result = parseAgentsWantedOpenSection(WITH_REQUEST)
    expect(result).toBe(result?.trim())
  })

  it('returns null for an empty string', () => {
    expect(parseAgentsWantedOpenSection('')).toBeNull()
  })

  it('extracts section when there is no subsequent H2', () => {
    const markdown = `## Open requests\n\n### My request\n- **Why:** just because\n`
    const result = parseAgentsWantedOpenSection(markdown)
    expect(result).toContain('My request')
  })
})

// ---------------------------------------------------------------------------
// formatAgentsWantedContext
// ---------------------------------------------------------------------------

describe('formatAgentsWantedContext', () => {
  it('returns empty string for null', () => {
    expect(formatAgentsWantedContext(null)).toBe('')
  })

  it('returns empty string for an empty string', () => {
    expect(formatAgentsWantedContext('')).toBe('')
  })

  it('prepends the standard header block', () => {
    const result = formatAgentsWantedContext('### My request\n- **Why:** critical')
    expect(result).toMatch(/^## Workspace agent demand \(AGENTS-WANTED\.md\)\n\n/)
  })

  it('includes the section body after the header', () => {
    const section = '### My request\n- **Why:** very important'
    const result = formatAgentsWantedContext(section)
    expect(result).toContain(section)
  })

  it('passes through sections shorter than MAX_AGENTS_WANTED_CHARS intact', () => {
    const section = 'short content'
    const result = formatAgentsWantedContext(section)
    expect(result.endsWith(section)).toBe(true)
  })

  it('truncates sections over MAX_AGENTS_WANTED_CHARS', () => {
    const longSection = 'x'.repeat(MAX_AGENTS_WANTED_CHARS + 500)
    const result = formatAgentsWantedContext(longSection)
    // The body portion must be exactly MAX chars
    const header = '## Workspace agent demand (AGENTS-WANTED.md)\n\n'
    const body = result.slice(header.length)
    expect(body.length).toBe(MAX_AGENTS_WANTED_CHARS)
  })

  it('does not truncate sections exactly at MAX_AGENTS_WANTED_CHARS', () => {
    const section = 'y'.repeat(MAX_AGENTS_WANTED_CHARS)
    const result = formatAgentsWantedContext(section)
    const header = '## Workspace agent demand (AGENTS-WANTED.md)\n\n'
    const body = result.slice(header.length)
    expect(body.length).toBe(MAX_AGENTS_WANTED_CHARS)
  })
})
