import 'server-only'

import { createHash } from 'node:crypto'

import { pgrest } from './postgrest'

export const CORPUS_SCHEMA_VERSION = 'aigent-corpus/v1' as const

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type RawRow = Record<string, unknown>

export interface CanonicalCorpusEntry {
  suiteId: string
  suiteKind: string | null
  caseId: string
  input: unknown
  expectedBehavior: string | null
  expectedToolCalls: string[]
}

export interface CanonicalBenchmarkSuite {
  suiteId: string
  taskCount: number | null
  dimensions: string[]
}

export interface VersionedCorpus {
  schemaVersion: typeof CORPUS_SCHEMA_VERSION
  entries: CanonicalCorpusEntry[]
  benchmarkSuites: CanonicalBenchmarkSuite[]
  inputs: unknown[]
  contentHash: string
}

function canonicalJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('corpus contains a non-finite number')
    return value
  }
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {}
    for (const key of Object.keys(value as Record<string, unknown>).toSorted()) {
      const item = (value as Record<string, unknown>)[key]
      if (item !== undefined) out[key] = canonicalJson(item)
    }
    return out
  }
  throw new Error(`corpus contains unsupported value type: ${typeof value}`)
}

export function hashCanonicalCorpus(
  entries: readonly CanonicalCorpusEntry[],
  benchmarkSuites: readonly CanonicalBenchmarkSuite[] = [],
): string {
  const sorted = entries
    .map((entry) => ({
      ...entry,
      expectedToolCalls: entry.expectedToolCalls.toSorted((a, b) => a.localeCompare(b)),
    }))
    .toSorted((a, b) => a.suiteId.localeCompare(b.suiteId) || a.caseId.localeCompare(b.caseId))
  const sortedBenchmarks = benchmarkSuites
    .map((suite) => ({
      ...suite,
      dimensions: suite.dimensions.toSorted((a, b) => a.localeCompare(b)),
    }))
    .toSorted((a, b) => a.suiteId.localeCompare(b.suiteId))
  const payload = canonicalJson({
    schemaVersion: CORPUS_SCHEMA_VERSION,
    entries: sorted,
    benchmarkSuites: sortedBenchmarks,
  })
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export async function loadVersionedCorpus(copilotId: string): Promise<VersionedCorpus> {
  const [suites, benchmarkRows] = await Promise.all([
    pgrest<RawRow[]>(
      'GET',
      `test_suites?copilot_id=eq.${encodeURIComponent(copilotId)}&select=id,kind&order=id`,
    ),
    pgrest<RawRow[]>(
      'GET',
      `benchmark_suites?copilot_id=eq.${encodeURIComponent(copilotId)}&select=id,task_count,dimensions&order=id`,
    ),
  ])
  const suiteIds = suites.map((row) => row.id as string)
  const suiteKind = new Map(
    suites.map((row) => [row.id as string, typeof row.kind === 'string' ? row.kind : null]),
  )
  const cases =
    suiteIds.length === 0
      ? []
      : await pgrest<RawRow[]>(
          'GET',
          `test_cases?suite_id=in.(${suiteIds.map(encodeURIComponent).join(',')})&select=id,suite_id,input,expected_behavior,expected_tool_calls&order=id`,
        )
  const entries: CanonicalCorpusEntry[] = cases.map((row) => ({
    suiteId: row.suite_id as string,
    suiteKind: suiteKind.get(row.suite_id as string) ?? null,
    caseId: row.id as string,
    input: row.input ?? null,
    expectedBehavior: typeof row.expected_behavior === 'string' ? row.expected_behavior : null,
    expectedToolCalls: Array.isArray(row.expected_tool_calls)
      ? row.expected_tool_calls.filter((item): item is string => typeof item === 'string').toSorted()
      : [],
  }))
  const benchmarkSuites: CanonicalBenchmarkSuite[] = benchmarkRows.map((row) => ({
    suiteId: row.id as string,
    taskCount:
      typeof row.task_count === 'number' && Number.isFinite(row.task_count)
        ? row.task_count
        : null,
    dimensions: Array.isArray(row.dimensions)
      ? row.dimensions.filter((item): item is string => typeof item === 'string').toSorted()
      : [],
  }))
  return {
    schemaVersion: CORPUS_SCHEMA_VERSION,
    entries,
    benchmarkSuites,
    inputs: entries.map((entry) => entry.input),
    contentHash: hashCanonicalCorpus(entries, benchmarkSuites),
  }
}
