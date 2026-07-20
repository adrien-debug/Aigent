import { describe, expect, it } from 'vitest'

import {
  graphIsRegistered,
  formatExitReason,
  formatLogChunk,
  formatLogLine,
  isDevServerCommand,
  isKillableListener,
  isReclaimableProcess,
  summarizeCommand,
  parseLsofCwd,
  parsePids,
  parsePsRecords,
} from '../../scripts/dev-stack.mjs'

/**
 * Pure helpers only — no spawning, no ports, no lsof.
 *
 * The load-bearing test is the foreign-cwd one: this machine runs Next dev
 * servers for Netpool, TradeAgent, Kyc and others. Killing one of those is a
 * critical defect, so `isKillableListener` must refuse anything outside the
 * repo — including a sibling directory whose path shares a textual prefix.
 */
const REPO = '/Users/adrien/Aigent'

describe('isKillableListener', () => {
  it('kills a listener whose cwd is the repo root itself', () => {
    expect(isKillableListener(REPO, REPO)).toBe(true)
  })

  it('kills a listener running from a nested subdirectory of the repo', () => {
    expect(isKillableListener(`${REPO}/src/langgraph`, REPO)).toBe(true)
  })

  it('REFUSES a listener owned by another project', () => {
    expect(isKillableListener('/Users/adrien/Netpool', REPO)).toBe(false)
    expect(isKillableListener('/Users/adrien/TradeAgent/src', REPO)).toBe(false)
  })

  it('REFUSES a sibling directory that merely shares a path prefix', () => {
    expect(isKillableListener(`${REPO}-old`, REPO)).toBe(false)
    expect(isKillableListener(`${REPO}-backup/src`, REPO)).toBe(false)
  })

  it('REFUSES when the cwd could not be resolved', () => {
    expect(isKillableListener(null, REPO)).toBe(false)
    expect(isKillableListener(undefined, REPO)).toBe(false)
    expect(isKillableListener('', REPO)).toBe(false)
  })

  it('REFUSES when the repo root is missing, rather than defaulting to kill', () => {
    expect(isKillableListener(REPO, '')).toBe(false)
  })

  it('normalises traversal instead of trusting the raw string', () => {
    expect(isKillableListener(`${REPO}/../Netpool`, REPO)).toBe(false)
    expect(isKillableListener(`${REPO}/src/../scripts`, REPO)).toBe(true)
  })
})

/**
 * Identity, the second half of the kill authorisation. cwd says "this process
 * lives in my repo"; only the command says "this process is mine to kill". An
 * editor, an LSP server and a Claude Code session all run from inside the repo.
 */
describe('isDevServerCommand', () => {
  it('recognises the booted Next server — the real orphan this mission killed', () => {
    // Observed: PPID 1, cwd the repo root, holding :3003.
    expect(isDevServerCommand('next-server (v16.2.10)')).toBe(true)
  })

  it('recognises Next and LangGraph in their spawned forms', () => {
    expect(isDevServerCommand('/Users/adrien/Aigent/node_modules/.bin/next dev')).toBe(true)
    expect(isDevServerCommand('langgraphjs dev --port 2024')).toBe(true)
    expect(isDevServerCommand('node node_modules/.bin/langgraphjs dev --no-browser')).toBe(true)
    expect(isDevServerCommand('langgraph dev --host 127.0.0.1')).toBe(true)
  })

  it('REFUSES an editor / LSP server running inside the repo', () => {
    expect(
      isDevServerCommand('node /Users/adrien/.vscode/extensions/typescript-language-server --stdio'),
    ).toBe(false)
    expect(isDevServerCommand('/Applications/Cursor.app/Contents/MacOS/Cursor')).toBe(false)
  })

  it('REFUSES a Claude Code session working in this repo', () => {
    expect(isDevServerCommand('node /Users/adrien/.claude/local/node_modules/.bin/claude')).toBe(false)
    expect(isDevServerCommand('claude --resume')).toBe(false)
  })

  it('REFUSES an unidentifiable command rather than assuming', () => {
    expect(isDevServerCommand('')).toBe(false)
    expect(isDevServerCommand('   ')).toBe(false)
    expect(isDevServerCommand(undefined)).toBe(false)
    expect(isDevServerCommand(null)).toBe(false)
  })
})

describe('isReclaimableProcess', () => {
  const NEXT_CMD = 'next-server (v16.2.10)'

  it('authorises only a dev server that is ALSO inside the repo', () => {
    expect(isReclaimableProcess(REPO, NEXT_CMD, REPO)).toBe(true)
  })

  it('REFUSES on cwd alone — being in the repo is not being a dev server', () => {
    // The load-bearing case: an editor/LSP/Claude Code session in this repo.
    expect(isReclaimableProcess(REPO, 'node typescript-language-server --stdio', REPO)).toBe(false)
    expect(isReclaimableProcess(`${REPO}/src`, 'claude --resume', REPO)).toBe(false)
  })

  it("REFUSES on command alone — another project's Next server is not ours", () => {
    expect(isReclaimableProcess('/Users/adrien/Netpool', NEXT_CMD, REPO)).toBe(false)
    expect(isReclaimableProcess(`${REPO}-old`, NEXT_CMD, REPO)).toBe(false)
  })
})

describe('parsePsRecords', () => {
  it('keeps the command intact despite its spaces', () => {
    expect(parsePsRecords('  501     1 next-server (v16.2.10)\n')).toEqual([
      { pid: 501, ppid: 1, command: 'next-server (v16.2.10)' },
    ])
  })

  it('skips blank and malformed lines', () => {
    expect(parsePsRecords('\nnot a row\n123 456 node x\n')).toEqual([
      { pid: 123, ppid: 456, command: 'node x' },
    ])
  })
})

/** Readiness must prove the graph exists, not merely that a server answered. */
describe('graphIsRegistered', () => {
  it('accepts a registry that lists the graph', () => {
    expect(graphIsRegistered([{ graph_id: 'agent_builder' }], 'agent_builder')).toBe(true)
  })

  it('REFUSES a live but graphless server — the false green this targets', () => {
    expect(graphIsRegistered([], 'agent_builder')).toBe(false)
    expect(graphIsRegistered([{ graph_id: 'something_else' }], 'agent_builder')).toBe(false)
  })

  it('REFUSES a body that is not a registry array', () => {
    expect(graphIsRegistered(null, 'agent_builder')).toBe(false)
    expect(graphIsRegistered({ detail: 'Not Found' }, 'agent_builder')).toBe(false)
  })
})

describe('formatLogLine', () => {
  const at = new Date('2026-07-20T10:30:00.000Z')

  it('prefixes an ISO timestamp and the service name', () => {
    expect(formatLogLine('next', 'ready on 3000', at)).toBe('2026-07-20T10:30:00.000Z [next] ready on 3000')
  })

  it('labels langgraph lines distinctly', () => {
    expect(formatLogLine('langgraph', 'server started', at)).toBe('2026-07-20T10:30:00.000Z [langgraph] server started')
  })
})

describe('formatLogChunk', () => {
  const at = new Date('2026-07-20T10:30:00.000Z')

  it('formats every line of a multi-line chunk', () => {
    expect(formatLogChunk('next', 'one\ntwo\n', at)).toEqual([
      '2026-07-20T10:30:00.000Z [next] one',
      '2026-07-20T10:30:00.000Z [next] two',
    ])
  })

  it('does not emit a blank line for a trailing newline', () => {
    expect(formatLogChunk('next', 'only\n', at)).toHaveLength(1)
  })

  it('strips carriage returns so CRLF output does not corrupt the log', () => {
    expect(formatLogChunk('langgraph', 'boot\r\n', at)).toEqual(['2026-07-20T10:30:00.000Z [langgraph] boot'])
  })
})

describe('formatExitReason', () => {
  it('reports a numeric exit code', () => {
    expect(formatExitReason('next', 1, null)).toBe('next exited with code 1')
    expect(formatExitReason('next', 0, null)).toBe('next exited with code 0')
  })

  it('reports the signal, which a SIGTERM death leaves as code null', () => {
    expect(formatExitReason('langgraph', null, 'SIGTERM')).toBe('langgraph exited on signal SIGTERM')
  })

  it('prefers the signal over the code when both are present', () => {
    expect(formatExitReason('langgraph', 143, 'SIGTERM')).toBe('langgraph exited on signal SIGTERM')
  })

  it('never claims to know a cause it does not have', () => {
    expect(formatExitReason('next', null, null)).toBe('next exited for an unknown reason (no code, no signal)')
  })
})

describe('parseLsofCwd', () => {
  it('extracts the path from the n-field of lsof -Fn output', () => {
    expect(parseLsofCwd('p52341\nfcwd\nn/Users/adrien/Aigent\n')).toBe('/Users/adrien/Aigent')
  })

  it('returns null when lsof produced no name field', () => {
    expect(parseLsofCwd('p52341\nfcwd\n')).toBeNull()
    expect(parseLsofCwd('')).toBeNull()
  })
})

describe('parsePids', () => {
  it('parses and de-duplicates pids', () => {
    expect(parsePids('123\n456\n123\n')).toEqual([123, 456])
  })

  it('returns an empty list when the port is free', () => {
    expect(parsePids('')).toEqual([])
    expect(parsePids('\n\n')).toEqual([])
  })
})

describe('summarizeCommand', () => {
  it('keeps only the program, so a foreign argv cannot leak a credential', () => {
    // The pre-flight abort prints this AND persists it to .runtime/.
    const argv = '/usr/bin/node server.js --token=SUPER_SECRET --api-key=abc123'
    const shown = summarizeCommand(argv)
    expect(shown).toBe('/usr/bin/node …')
    expect(shown).not.toMatch(/SUPER_SECRET|abc123/)
  })

  it('returns a bare program unchanged, with no ellipsis', () => {
    expect(summarizeCommand('next-server')).toBe('next-server')
  })

  it('degrades to "unresolved" rather than throwing', () => {
    expect(summarizeCommand(undefined)).toBe('unresolved')
    expect(summarizeCommand(null)).toBe('unresolved')
    expect(summarizeCommand('   ')).toBe('unresolved')
  })
})
