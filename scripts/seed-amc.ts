/**
 * Seed GPU1 (base `aigent`) depuis le dataset mock.
 * Génère du SQL idempotent (TRUNCATE + INSERT) sur stdout :
 *   npx -y tsx scripts/seed-amc.ts > /tmp/seed-amc.sql
 * Puis appliquer sur gpu1 :
 *   scp /tmp/seed-amc.sql gpu1:~/aigent-db/ && ssh gpu1 'docker exec -i nexus-postgres psql -U postgres -d aigent -v ON_ERROR_STOP=1 < ~/aigent-db/seed-amc.sql'
 */
import {
  projects,
  copilots,
  versions as copilotVersions,
  manifests,
  tools as toolDefinitions,
  testSuites,
  testCases,
  testRuns,
  testResults,
  agentRuns,
  agentRunSteps,
  toolCalls,
  benchmarkSuites,
  benchmarkRuns,
  benchmarkResults,
  replayComparisons,
  shadowExperiments,
  promotionGates,
  registryWarnings,
} from '../src/lib/agent-mission-control/mock-data'

type Row = Record<string, unknown>

function sqlLit(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === 'string')) {
      return `ARRAY[${v.map((x) => sqlLit(x)).join(',')}]::text[]`
    }
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

// camelCase → snake_case ; cas particulier : suffixe 7d → _7d (calls_last_7d),
// sans toucher p95LatencyMs → p95_latency_ms.
const snake = (s: string) =>
  s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`).replace(/7d$/, '_7d')

function insert(table: string, rows: Row[], mapRow?: (r: Row) => Row): string {
  if (rows.length === 0) return `-- ${table}: 0 rows\n`
  const mapped = rows.map((r) => (mapRow ? mapRow(r) : r))
  const cols = Object.keys(mapped[0]!)
  const lines = mapped.map(
    (r) => `(${cols.map((c) => sqlLit(r[c])).join(',')})`
  )
  return `INSERT INTO ${table} (${cols.map(snake).join(',')}) VALUES\n${lines.join(',\n')};\n`
}

const TABLES_IN_FK_ORDER = [
  'registry_warnings',
  'promotion_gates',
  'shadow_experiments',
  'replay_comparisons',
  'benchmark_results',
  'benchmark_runs',
  'benchmark_suites',
  'tool_calls',
  'agent_run_steps',
  'agent_runs',
  'test_results',
  'test_runs',
  'test_cases',
  'test_suites',
  'tools',
  'manifests',
  'copilot_versions',
  'copilots',
  'projects',
]

let out = 'BEGIN;\n'
out += TABLES_IN_FK_ORDER.map((t) => `TRUNCATE ${t} CASCADE;`).join('\n') + '\n'

out += insert('projects', projects as unknown as Row[])
out += insert('copilots', copilots as unknown as Row[])
out += insert('copilot_versions', copilotVersions as unknown as Row[])
out += insert('manifests', manifests as unknown as Row[])
// tools: copilot_id dérivé du manifest qui référence le tool (type sans copilotId)
const toolOwner = new Map<string, string>()
for (const m of manifests) for (const tid of m.toolIds) toolOwner.set(tid, m.copilotId)
out += insert('tools', toolDefinitions as unknown as Row[], (r) => ({
  id: r.id,
  copilotId: toolOwner.get(r.id as string) ?? 'cp-support-navigator',
  ...Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id')),
}))
// test_suites: drop caseIds (dérivable de test_cases.suite_id)
out += insert('test_suites', testSuites as unknown as Row[], ({ caseIds: _c, ...r }) => r)
out += insert('test_cases', testCases as unknown as Row[])
// test_runs: drop resultIds (dérivable)
out += insert('test_runs', testRuns as unknown as Row[], ({ resultIds: _r, ...r }) => r)
out += insert('test_results', testResults as unknown as Row[])
// agent_runs: drop stepIds (dérivable)
out += insert('agent_runs', agentRuns as unknown as Row[], ({ stepIds: _s, ...r }) => r)
out += insert('agent_run_steps', agentRunSteps as unknown as Row[])
out += insert('tool_calls', toolCalls as unknown as Row[])
out += insert('benchmark_suites', benchmarkSuites as unknown as Row[])
out += insert('benchmark_runs', benchmarkRuns as unknown as Row[])
out += insert('benchmark_results', benchmarkResults as unknown as Row[])
out += insert('replay_comparisons', replayComparisons as unknown as Row[])
out += insert('shadow_experiments', shadowExperiments as unknown as Row[])
out += insert('promotion_gates', promotionGates as unknown as Row[])
out += insert('registry_warnings', registryWarnings as unknown as Row[])
out += 'COMMIT;\n'

process.stdout.write(out)
