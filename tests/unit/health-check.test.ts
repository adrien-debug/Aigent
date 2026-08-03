/**
 * Unit tests for the pure logic of scripts/health.mjs.
 *
 * Scope is deliberately the side-effect-free core: the HTTP classifier, the
 * row formatter, and the verdict aggregator. The network probes themselves are
 * not mocked here — importing the module must not perform any I/O at all, which
 * is itself part of the contract (main() is guarded behind a direct-execution
 * check), and these tests would fail to even load if that regressed.
 */
import { describe, expect, it } from 'vitest'

import {
  aggregateVerdict,
  classifyAssistantsSearch,
  classifyHttpResult,
  classifyNextResult,
  classifyTransportError,
  formatStatusLine,
} from '../../scripts/health.mjs'

describe('classifyHttpResult', () => {
  it('classifies a 200 as healthy and reports the code', () => {
    expect(classifyHttpResult({ status: 200 })).toEqual({ healthy: true, reason: '200' })
  })

  it('treats a 3xx as a real answer (dev routes may redirect to login)', () => {
    expect(classifyHttpResult({ status: 307 }).healthy).toBe(true)
  })

  it('classifies a 500 as unhealthy', () => {
    const result = classifyHttpResult({ status: 500 })
    expect(result.healthy).toBe(false)
    expect(result.reason).toBe('500')
  })

  it('classifies a 4xx as unhealthy', () => {
    expect(classifyHttpResult({ status: 404 }).healthy).toBe(false)
  })

  it('classifies a network error as unhealthy, naming the kind but never the raw message', () => {
    // The reason is drawn from a fixed vocabulary rather than error.message:
    // probe targets are env-overridable and Node embeds the URL in some
    // transport errors, so echoing the message can print a configured host.
    const error = new Error('connect ECONNREFUSED 127.0.0.1:2024')
    error.cause = { code: 'ECONNREFUSED' }
    const result = classifyHttpResult({ error })
    expect(result.healthy).toBe(false)
    expect(result.reason).toBe('unreachable (connection refused)')
    expect(result.reason).not.toContain('127.0.0.1')
  })

  it('reports a timeout distinctly rather than as a generic failure', () => {
    const error = new Error('aborted')
    error.name = 'TimeoutError'
    expect(classifyHttpResult({ error })).toEqual({ healthy: false, reason: 'timed out' })
  })

  it('prefers the transport error over any status that came with it', () => {
    // A completed-looking status must never rescue a failed request.
    expect(classifyHttpResult({ status: 200, error: new Error('socket hang up') }).healthy).toBe(
      false
    )
  })

  it('is unhealthy when there is neither a status nor an error', () => {
    expect(classifyHttpResult({}).healthy).toBe(false)
    expect(classifyHttpResult().healthy).toBe(false)
  })
})

describe('classifyAssistantsSearch', () => {
  // The headline claim of the whole script: a LangGraph server that outlived
  // its graph answers 200 with an empty list, and that MUST read UNHEALTHY.
  it('is unhealthy on an empty registry — alive but graphless', () => {
    const result = classifyAssistantsSearch([], 'agent_builder')
    expect(result.healthy).toBe(false)
    expect(result.reason).toBe('alive but graph agent_builder absent')
  })

  it('is unhealthy when only a different graph is registered', () => {
    const result = classifyAssistantsSearch(
      [{ graph_id: 'some_other_graph' }, { graph_id: 'chat' }],
      'agent_builder'
    )
    expect(result.healthy).toBe(false)
    expect(result.reason).toContain('absent')
  })

  it('is healthy when the matching graph_id is present', () => {
    const result = classifyAssistantsSearch(
      [{ graph_id: 'chat' }, { assistant_id: 'a1', graph_id: 'agent_builder' }],
      'agent_builder'
    )
    expect(result).toEqual({ healthy: true, reason: 'graph agent_builder available' })
  })

  it('refuses to call a non-array body green — unproven is never a pass', () => {
    for (const body of [null, undefined, {}, 'agent_builder', 0, { graph_id: 'agent_builder' }]) {
      const result = classifyAssistantsSearch(body, 'agent_builder')
      expect(result.healthy).toBe(false)
    }
  })

  it('does not match a null or non-object row', () => {
    expect(classifyAssistantsSearch([null, undefined, 'agent_builder'], 'agent_builder').healthy).toBe(
      false
    )
  })
})

describe('classifyTransportError', () => {
  // The PostgREST target is a secret-bearing remote URL; no failure path may
  // print it. This pins the leak the reviewer found.
  it('never echoes a URL carried by the error message', () => {
    const error = new TypeError(
      'Failed to parse URL from https://db.secret-host.example/rest/v1/projects?select=id'
    )
    const result = classifyTransportError(error)
    expect(result.healthy).toBe(false)
    expect(result.reason).toBe('transport error')
    expect(result.reason).not.toContain('secret-host')
    expect(result.reason).not.toContain('http')
    expect(result.reason).not.toContain('/rest/v1')
  })

  it('maps a refused connection, dns failure and timeout to fixed words', () => {
    const refused = new TypeError('fetch failed')
    ;(refused as unknown as { cause: unknown }).cause = { code: 'ECONNREFUSED' }
    expect(classifyTransportError(refused).reason).toBe('connection refused')

    const dns = new TypeError('fetch failed')
    ;(dns as unknown as { cause: unknown }).cause = { code: 'ENOTFOUND', hostname: 'secret-host' }
    expect(classifyTransportError(dns).reason).toBe('dns failure')

    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    expect(classifyTransportError(timeout).reason).toBe('timed out')
  })

  it('emits only vocabulary words, whatever it is handed', () => {
    const vocabulary = ['timed out', 'connection refused', 'dns failure', 'transport error']
    const inputs = [
      undefined,
      null,
      'https://leak.example/key=abc',
      new Error('Bearer eyJhbGciOi.secret.token'),
      { message: 'https://leak.example' },
    ]
    for (const input of inputs) {
      expect(vocabulary).toContain(classifyTransportError(input).reason)
    }
  })
})

describe('aggregateVerdict', () => {
  it('is HEALTHY only when every service is healthy', () => {
    expect(aggregateVerdict([{ healthy: true }, { healthy: true }, { healthy: true }])).toBe(
      'HEALTHY'
    )
  })

  it('is DEGRADED if ANY single service is unhealthy', () => {
    expect(aggregateVerdict([{ healthy: true }, { healthy: false }, { healthy: true }])).toBe(
      'DEGRADED'
    )
    expect(aggregateVerdict([{ healthy: false }, { healthy: true }, { healthy: true }])).toBe(
      'DEGRADED'
    )
    expect(aggregateVerdict([{ healthy: true }, { healthy: true }, { healthy: false }])).toBe(
      'DEGRADED'
    )
  })

  it('is DEGRADED when all services are unhealthy', () => {
    expect(aggregateVerdict([{ healthy: false }, { healthy: false }])).toBe('DEGRADED')
  })

  it('refuses to call an empty or malformed check green', () => {
    // Checking nothing must never read as a pass.
    expect(aggregateVerdict([])).toBe('DEGRADED')
    expect(aggregateVerdict(undefined as unknown as { healthy: boolean }[])).toBe('DEGRADED')
    expect(aggregateVerdict([null as unknown as { healthy: boolean }])).toBe('DEGRADED')
  })

  it('does not accept a truthy non-true healthy value', () => {
    expect(aggregateVerdict([{ healthy: 'yes' as unknown as boolean }])).toBe('DEGRADED')
  })
})

describe('formatStatusLine', () => {
  it('emits the exact documented shape', () => {
    expect(formatStatusLine('NEXT', 'HEALTHY', '200  1234ms')).toBe(
      'NEXT        HEALTHY    200  1234ms'
    )
    expect(formatStatusLine('LANGGRAPH', 'HEALTHY', 'graph agent_builder available')).toBe(
      'LANGGRAPH   HEALTHY    graph agent_builder available'
    )
    expect(formatStatusLine('POSTGREST', 'HEALTHY', '412ms')).toBe('POSTGREST   HEALTHY    412ms')
    expect(formatStatusLine('STACK', 'HEALTHY')).toBe('STACK       HEALTHY')
  })

  it('aligns the detail column across every service name and status', () => {
    const lines = [
      formatStatusLine('NEXT', 'HEALTHY', 'a'),
      formatStatusLine('LANGGRAPH', 'UNHEALTHY', 'b'),
      formatStatusLine('POSTGREST', 'HEALTHY', 'c'),
    ]
    const detailColumns = lines.map((line) => line.search(/[abc]$/))
    expect(new Set(detailColumns).size).toBe(1)
    expect(detailColumns[0]).toBe(23)
  })

  it('leaves no trailing whitespace on a detail-less verdict line', () => {
    const line = formatStatusLine('STACK', 'DEGRADED')
    expect(line).toBe('STACK       DEGRADED')
    expect(line).not.toMatch(/\s$/)
  })

  it('does not truncate a name or status longer than its column', () => {
    expect(formatStatusLine('POSTGREST', 'UNHEALTHY', 'x')).toContain('POSTGREST')
    expect(formatStatusLine('POSTGREST', 'UNHEALTHY', 'x')).toContain('UNHEALTHY')
  })
})

/**
 * The NEXT probe targets a GUARDED route, so its semantics are inverted versus
 * the generic HTTP classifier: a 401 is the PROOF the identity gate works, and a
 * 200 would mean the gate stopped guarding. These tests pin both directions —
 * the regression being fixed here was a permanently false-red probe pointed at
 * a route deleted during the frontend reset.
 */
describe('classifyNextResult', () => {
  it('treats the expected 401 from the guard as HEALTHY, not as a failure', () => {
    const result = classifyNextResult({ status: 401 })
    expect(result.healthy).toBe(true)
    expect(result.down).toBe(false)
    expect(result.reason).toContain('401')
  })

  it('treats a redirect as HEALTHY — a live app sending an anonymous caller to a login screen', () => {
    expect(classifyNextResult({ status: 302 }).healthy).toBe(true)
    expect(classifyNextResult({ status: 307 }).healthy).toBe(true)
  })

  it('treats a 200 on the guarded route as UNHEALTHY — the guard answered without a credential', () => {
    const result = classifyNextResult({ status: 200 })
    expect(result.healthy).toBe(false)
    expect(result.reason).toMatch(/WITHOUT credential/)
  })

  it('treats a 404 as UNHEALTHY and names the missing target — the exact bug being fixed', () => {
    const result = classifyNextResult({ status: 404 })
    expect(result.healthy).toBe(false)
    expect(result.reason).toContain('404')
  })

  it('classifies a 5xx as UNHEALTHY', () => {
    expect(classifyNextResult({ status: 503 }).healthy).toBe(false)
  })

  it('reports a refused connection as "stack not running" rather than an indistinct red', () => {
    const error = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    })
    const result = classifyNextResult({ error })
    expect(result.healthy).toBe(false)
    expect(result.down).toBe(true)
    expect(result.reason).toContain('stack not running')
  })

  it('does NOT mark a timeout as "not running" — a hung server is running but broken', () => {
    const error = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    const result = classifyNextResult({ error })
    expect(result.healthy).toBe(false)
    expect(result.down).toBe(false)
  })

  it('never leaks the probe target from a transport error message', () => {
    const error = Object.assign(new TypeError('Failed to parse URL from https://secret-host/x'), {
      cause: { code: 'ENOTFOUND' },
    })
    expect(classifyNextResult({ error }).reason).not.toContain('secret-host')
  })

  it('treats a missing status as UNHEALTHY — unproven is never a pass', () => {
    expect(classifyNextResult({}).healthy).toBe(false)
  })

  it('honours an explicit expected status', () => {
    expect(classifyNextResult({ status: 403 }, 403).healthy).toBe(true)
    expect(classifyNextResult({ status: 401 }, 403).healthy).toBe(false)
  })
})