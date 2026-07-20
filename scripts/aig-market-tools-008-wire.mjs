import { createHash } from 'node:crypto'
import path from 'node:path'

import { Client } from '@langchain/langgraph-sdk'

import {
  MARKET_TOOL_DEFINITIONS,
  PROMOTED_MARKET_AGENTS,
} from '../src/lib/agent-mission-control/market/promoted-tool-mapping.mjs'

process.loadEnvFile(path.resolve(process.cwd(), '.env.local'))

const PG = process.env.AMC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const AMC_KEY = process.env.AMC_API_KEY
const APP_BASE = `http://127.0.0.1:${Number(process.env.AIGENT_DEV_PORT) || 3210}`
const AGENT_URL = process.env.LANGGRAPH_API_URL || 'http://127.0.0.1:2024'
const AGENT_KEY = process.env.LANGGRAPH_SERVER_SECRET?.trim()

if (!PG || !SERVICE_KEY || !AMC_KEY || !AGENT_KEY) {
  throw new Error('required live wiring environment is not configured')
}

const pgHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  'content-type': 'application/json',
}

async function pg(method, pathAndQuery, body, prefer) {
  const response = await fetch(`${PG}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { ...pgHeaders, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`PostgREST ${response.status} during market capability wiring`)
  }
  const text = await response.text()
  return text ? JSON.parse(text) : []
}

function toolId(copilotId, toolName) {
  const digest = createHash('sha256').update(`${copilotId}:${toolName}`).digest('hex').slice(0, 8)
  return `tool-${toolName.replaceAll('_', '-')}-${digest}`
}

async function reprovision(copilotId, projectId) {
  const response = await fetch(`${APP_BASE}/api/agent-ops/copilots/${copilotId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-amc-key': AMC_KEY },
    body: JSON.stringify({ projectId }),
    signal: AbortSignal.timeout(30_000),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || result.reprovisioned !== true) {
    throw new Error(`assistant reprovision failed for ${copilotId}`)
  }
}

const client = new Client({
  apiUrl: AGENT_URL,
  defaultHeaders: { 'x-agent-key': AGENT_KEY },
})

for (const agent of PROMOTED_MARKET_AGENTS) {
  const copilots = await pg(
    'GET',
    `copilots?id=eq.${encodeURIComponent(agent.id)}&select=id,project_id,assistant_id,production_version_id,latest_version_id`
  )
  const copilot = copilots[0]
  if (!copilot?.project_id) throw new Error(`copilot or project assignment missing for ${agent.id}`)

  const activeVersionId = copilot.production_version_id ?? copilot.latest_version_id
  if (!activeVersionId) throw new Error(`active version missing for ${agent.id}`)
  const versions = await pg(
    'GET',
    `copilot_versions?id=eq.${encodeURIComponent(activeVersionId)}&select=id,manifest_id`
  )
  const manifestId = versions[0]?.manifest_id
  if (!manifestId) throw new Error(`active manifest missing for ${agent.id}`)

  const toolRows = agent.toolNames.map((name) => {
    const definition = MARKET_TOOL_DEFINITIONS[name]
    if (!definition || definition.mutates !== false) {
      throw new Error(`invalid read-only market tool definition: ${name}`)
    }
    return {
      id: toolId(agent.id, name),
      copilot_id: agent.id,
      name,
      description: definition.description,
      provider: 'internal',
      risk_level: 'low',
      enabled: true,
      requires_confirmation: false,
      mutates: false,
      scoped_routes: [],
    }
  })
  await pg(
    'POST',
    'tools?on_conflict=id',
    toolRows,
    'resolution=merge-duplicates,return=representation'
  )
  await pg(
    'PATCH',
    `tools?copilot_id=eq.${encodeURIComponent(agent.id)}&name=not.in.(${agent.toolNames.join(',')})`,
    { enabled: false },
    'return=minimal'
  )

  const manifests = await pg(
    'GET',
    `manifests?id=eq.${encodeURIComponent(manifestId)}&select=id,tool_ids`
  )
  const manifest = manifests[0]
  if (!manifest) throw new Error(`manifest not found for ${agent.id}`)
  const nextToolIds = toolRows.map((row) => row.id)
  await pg(
    'PATCH',
    `manifests?id=eq.${encodeURIComponent(manifestId)}`,
    {
      tool_ids: nextToolIds,
      system_prompt_summary: agent.systemPromptSummary,
      updated_at: new Date().toISOString(),
    },
    'return=representation'
  )

  await reprovision(agent.id, copilot.project_id)
  const refreshed = await pg(
    'GET',
    `copilots?id=eq.${encodeURIComponent(agent.id)}&select=assistant_id`
  )
  const assistantId = refreshed[0]?.assistant_id
  if (!assistantId) throw new Error(`assistant id missing after reprovision for ${agent.id}`)
  const assistant = await client.assistants.get(assistantId)
  const config = assistant.config?.configurable ?? {}
  const mounted = Array.isArray(config.tools) ? config.tools.map((entry) => entry.id) : []
  const unmapped = Array.isArray(config.unmappedToolNames) ? config.unmappedToolNames : []
  const missing = agent.toolNames.filter((name) => !mounted.includes(name))
  const dropped = agent.toolNames.filter((name) => unmapped.includes(name))
  if (missing.length > 0 || dropped.length > 0) {
    throw new Error(`market tools not mounted for ${agent.id}`)
  }

  console.log(
    `WIRED ${JSON.stringify({
      agent: agent.name,
      manifestId,
      tools: agent.toolNames,
      unmappedToolNames: [],
      assistantId,
    })}`
  )
}
