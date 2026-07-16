/**
 * Unit tests for the generated agent handler (github.ts handlerForRuntime).
 *
 * Prompt 49's sandbox found the delivered handler broke the target repo's
 * typecheck: `Cannot find name 'process'` without @types/node. These tests lock
 * in the hardening — the generated handler is standalone, dependency-free, reads
 * env via a local helper (never the bare global `process`), exports `handle`,
 * and embeds no secret.
 */
import { describe, expect, it } from 'vitest'

import { handlerForRuntime } from '@/lib/agent-mission-control/github'
import type { AgentManifest, AgentRuntime, Copilot } from '@/lib/agent-mission-control/types'

const manifest = { systemPromptSummary: 'Read-only test agent.', maxStepsPerRun: 12 } as unknown as AgentManifest

function copilot(runtime: AgentRuntime): Copilot {
  return { name: 'Test Agent', slug: `test-${runtime}`, runtime, model: 'gpt-5.4' } as unknown as Copilot
}

const RUNTIMES: AgentRuntime[] = ['langgraph', 'openai-assistants', 'gemini', 'custom']

describe('generated handler — hardening', () => {
  it('1 — contains no internal Aigent import', () => {
    for (const rt of RUNTIMES) {
      const src = handlerForRuntime(copilot(rt), manifest)
      expect(src).not.toMatch(/from ['"]@\/lib\/agent-mission-control/)
      expect(src).not.toMatch(/from ['"]\.\.?\//) // no relative import at all
      expect(src).not.toMatch(/\brequire\(/)
    }
  })

  it('2 — exports `handle`', () => {
    for (const rt of RUNTIMES) {
      expect(handlerForRuntime(copilot(rt), manifest)).toMatch(/export async function handle\(/)
    }
  })

  it('3 — reads env via the local readEnv helper, never the bare global `process`', () => {
    for (const rt of RUNTIMES) {
      const src = handlerForRuntime(copilot(rt), manifest)
      // The fix: no bare `process.env` in EXECUTABLE code (comments may mention it).
      const codeLines = src.split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//') && !l.trimStart().startsWith('/*'))
      expect(codeLines.join('\n')).not.toMatch(/\bprocess\.env\b/)
      expect(src).toContain('function readEnv(')
      expect(src).toMatch(/readEnv\(/)
    }
  })

  it('4 — embeds no hardcoded secret value', () => {
    for (const rt of RUNTIMES) {
      const src = handlerForRuntime(copilot(rt), manifest)
      expect(src).not.toMatch(/sk-[A-Za-z0-9]{20}/)
      expect(src).not.toMatch(/ghp_[A-Za-z0-9]{20}/)
      // No `KEY = "literal"` assignment (only readEnv reads at runtime).
      expect(src).not.toMatch(/API_KEY\s*[:=]\s*['"`][A-Za-z0-9]/)
    }
  })

  it('5 — every used type is defined in-file (AgentInput/AgentResult)', () => {
    for (const rt of RUNTIMES) {
      const src = handlerForRuntime(copilot(rt), manifest)
      expect(src).toContain('export interface AgentInput')
      expect(src).toContain('export interface AgentResult')
      // The handler signature only references in-file types.
      expect(src).toMatch(/handle\(\{ input \}: AgentInput\): Promise<AgentResult>/)
    }
  })

  it('6 — the package is stable across regeneration (deterministic)', () => {
    for (const rt of RUNTIMES) {
      const a = handlerForRuntime(copilot(rt), manifest)
      const b = handlerForRuntime(copilot(rt), manifest)
      expect(a).toBe(b)
    }
  })

  it('readEnv accesses globalThis, not a bare `process` identifier', () => {
    const src = handlerForRuntime(copilot('langgraph'), manifest)
    expect(src).toContain('globalThis as')
    // The only `process` occurrence in code is the typed globalThis access.
    expect(src).toMatch(/globalThis as \{ process\?:/)
  })
})
