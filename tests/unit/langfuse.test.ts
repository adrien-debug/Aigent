/**
 * Unit tests for the self-hosted Langfuse exporter
 * (src/lib/agent-mission-control/langfuse.ts).
 *
 * Proves the three doctrine properties without any network:
 *   1. unconfigured → strict no-op, fetch NEVER called, no fabricated URL,
 *   2. configured → one batch POST with Basic auth and a well-formed payload,
 *   3. network/HTTP failure → swallowed, never thrown (a run must not fail).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildLangfuseBatch,
  exportLangfuseTrace,
  getLangfuseTraceUrl,
  isLangfuseConfigured,
  type LangfuseTracePayload,
} from '@/lib/agent-mission-control/langfuse'

const HOST = 'http://192.168.1.74:3001'

function payload(): LangfuseTracePayload {
  return {
    traceId: 'trace-abc',
    name: 'copilot-fin-tva',
    input: { prompt: 'hello' },
    output: { text: 'world' },
    metadata: { copilotId: 'copilot-fin-tva', versionId: 'ver-1', runtime: 'run' },
    steps: [
      {
        name: 'LLM call',
        kind: 'llm-call',
        status: 'ok',
        detail: 'ok',
        startedAt: '2026-07-20T10:00:00.000Z',
        durationMs: 1500,
        model: 'gpt-5.4',
        provider: 'openai',
        usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
        costUsd: 0.0002,
      },
      {
        name: 'read_account_risk_snapshot',
        kind: 'tool-call',
        status: 'blocked',
        detail: 'capital never fabricated',
        startedAt: '2026-07-20T10:00:02.000Z',
        durationMs: 20,
      },
    ],
    startedAt: '2026-07-20T10:00:00.000Z',
    finishedAt: '2026-07-20T10:00:03.000Z',
  }
}

function configure(): void {
  process.env.LANGFUSE_HOST = HOST
  process.env.LANGFUSE_PUBLIC_KEY = 'pk-test'
  process.env.LANGFUSE_SECRET_KEY = 'sk-test'
}

function unconfigure(): void {
  delete process.env.LANGFUSE_HOST
  delete process.env.LANGFUSE_PUBLIC_KEY
  delete process.env.LANGFUSE_SECRET_KEY
}

describe('langfuse exporter', () => {
  beforeEach(() => {
    unconfigure()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    unconfigure()
  })

  describe('unconfigured', () => {
    it('is a strict no-op and never calls fetch', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const result = await exportLangfuseTrace(payload())
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.exported).toBe(false)
      expect(result.eventCount).toBe(0)
      expect(result.traceUrl).toBeNull()
      expect(isLangfuseConfigured()).toBe(false)
      expect(getLangfuseTraceUrl('trace-abc')).toBeNull()
    })

    it('stays a no-op when only part of the config is present', async () => {
      process.env.LANGFUSE_HOST = HOST
      process.env.LANGFUSE_PUBLIC_KEY = 'pk-test'
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      const result = await exportLangfuseTrace(payload())
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(result.exported).toBe(false)
    })
  })

  describe('configured', () => {
    beforeEach(configure)

    it('POSTs one well-formed batch with Basic auth', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 207 }))

      const result = await exportLangfuseTrace(payload())

      expect(result.exported).toBe(true)
      expect(result.eventCount).toBe(3) // 1 trace + 2 observations
      expect(result.traceUrl).toBe(`${HOST}/trace/trace-abc`)
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${HOST}/api/public/ingestion`)
      expect(init.method).toBe('POST')
      const headers = init.headers as Record<string, string>
      expect(headers.authorization).toBe(
        `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`
      )
      expect(headers['content-type']).toBe('application/json')

      const body = JSON.parse(String(init.body)) as { batch: Array<Record<string, unknown>> }
      expect(body.batch).toHaveLength(3)
      expect(body.batch.map((e) => e.type)).toEqual([
        'trace-create',
        'generation-create',
        'span-create',
      ])
    })

    it('maps llm steps to generations and tool steps to spans', () => {
      const batch = buildLangfuseBatch(payload())

      const trace = batch[0].body as Record<string, unknown>
      expect(trace.id).toBe('trace-abc')
      expect(trace.name).toBe('copilot-fin-tva')
      expect(trace.metadata).toMatchObject({ copilotId: 'copilot-fin-tva', versionId: 'ver-1' })

      const generation = batch[1].body as Record<string, unknown>
      expect(generation.traceId).toBe('trace-abc')
      expect(generation.model).toBe('gpt-5.4')
      expect(generation.usage).toEqual({ promptTokens: 10, completionTokens: 4, totalTokens: 14 })
      expect(generation.calculatedTotalCost).toBe(0.0002)
      expect(generation.endTime).toBe('2026-07-20T10:00:01.500Z')
      expect(generation.level).toBe('DEFAULT')

      const span = batch[2].body as Record<string, unknown>
      expect(span.name).toBe('read_account_risk_snapshot')
      expect(span.level).toBe('ERROR')
      expect(span.metadata).toMatchObject({ kind: 'tool-call', status: 'blocked', blocked: true })
      // A span is not a generation: no model/usage leaks onto it.
      expect(span.model).toBeUndefined()
      expect(span.usage).toBeUndefined()
    })

    it('swallows a network error instead of throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
      const result = await exportLangfuseTrace(payload())
      expect(result.exported).toBe(false)
      expect(result.reason).toBe('ECONNREFUSED')
      expect(result.traceUrl).toBe(`${HOST}/trace/trace-abc`)
    })

    it('swallows a non-ok HTTP status instead of throwing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 401 }))
      const result = await exportLangfuseTrace(payload())
      expect(result.exported).toBe(false)
      expect(result.reason).toBe('Langfuse 401')
    })
  })
})
