import { describe, expect, it } from 'vitest'

import {
  localAgentServerUrl,
  resolveAgentServerUrl,
} from '@/langgraph/agent-server-endpoint.mjs'

describe('LangGraph Agent Server endpoint resolution', () => {
  it('pins local development to the supervised loopback server', () => {
    expect(resolveAgentServerUrl({ NODE_ENV: 'development' })).toBe(
      'http://127.0.0.1:2024'
    )
  })

  it('uses the explicit production endpoint', () => {
    expect(
      resolveAgentServerUrl({
        NODE_ENV: 'production',
        LANGGRAPH_API_URL: 'https://langgraph.example.com/',
      })
    ).toBe('https://langgraph.example.com')
  })

  it('refuses a remote endpoint in local development', () => {
    expect(() =>
      resolveAgentServerUrl({
        NODE_ENV: 'development',
        LANGGRAPH_API_URL: 'https://langgraph.example.com',
      })
    ).toThrow('Refusing remote LangGraph endpoint in local development')
  })

  it('requires an explicit endpoint in production', () => {
    expect(() => resolveAgentServerUrl({ NODE_ENV: 'production' })).toThrow(
      'LANGGRAPH_API_URL is required in production'
    )
  })

  it('keeps the local port source shared with the supervisor', () => {
    expect(localAgentServerUrl({ AIGENT_LANGGRAPH_PORT: '2124' })).toBe(
      'http://127.0.0.1:2124'
    )
  })
})
