import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

/** Shared builders for the V2 runs tests. Overrides are explicit so each test
 *  states exactly the field it is about. */

export function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-0000-1111',
    copilotId: 'copilot-market-intelligence',
    versionId: 'ver-1',
    projectId: 'proj-tradeagent',
    userLabel: 'nightly',
    startedAt: '2026-07-29T10:00:00.000Z',
    finishedAt: '2026-07-29T10:00:12.000Z',
    status: 'completed',
    stepIds: [],
    inputSummary: 'Full market synthesis for BTCUSDT',
    outputSummary: 'Regime: neutral',
    toolCallCount: 5,
    unsafeAttemptCount: 0,
    latencyMs: 12_000,
    costUsd: 0.0246,
    resolvedModel: 'gpt-5.4',
    resolvedProvider: 'openai',
    modelUnverified: false,
    traceUrl: null,
    ...overrides,
  }
}

export function makeCopilot(overrides: Partial<Copilot> = {}): Copilot {
  return {
    id: 'copilot-market-intelligence',
    projectId: 'proj-tradeagent',
    targetProjectIds: [],
    name: 'Market Intelligence',
    slug: 'market-intelligence',
    description: '',
    runtime: 'langgraph',
    status: 'active',
    productionVersionId: 'ver-1',
    latestVersionId: 'ver-1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'adrien',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    health: { testPassRate: 1, benchmarkScore: 1, runsLast24h: 1 } as Copilot['health'],
    ...overrides,
  }
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-tradeagent',
    name: 'TradeAgent',
    slug: 'tradeagent',
    description: '',
    platform: 'web',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export const AGENT_NAMES = new Map([['copilot-market-intelligence', 'Market Intelligence']])
export const PROJECT_NAMES = new Map([['proj-tradeagent', 'TradeAgent']])
export const NOW_MS = Date.parse('2026-07-29T12:00:00.000Z')
