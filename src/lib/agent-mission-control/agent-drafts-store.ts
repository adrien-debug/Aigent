import 'server-only'

import { randomUUID } from 'node:crypto'

import type { ArchitectMessage, GeneratedManifest } from './authoring-types'
import { pgrest } from './postgrest'
import type { IsoTimestamp } from './types'

/** Live gpu1 CHECK constraint on agent_drafts.status */
export type AgentDraftStatus = 'drafting' | 'ready' | 'created'

export interface AgentDraftRow {
  id: string
  name: string
  status: AgentDraftStatus
  messages: ArchitectMessage[]
  manifest: GeneratedManifest | null
  materializedCopilotId: string | null
  createdAt: IsoTimestamp
  updatedAt: IsoTimestamp
}

interface RawAgentDraft {
  id: string
  name: string
  description: string
  runtime: string
  model: string
  model_provider: string
  owner: string
  status: AgentDraftStatus
  generated_manifest: GeneratedManifest | Record<string, unknown>
  conversation: ArchitectMessage[]
  created_copilot_id: string | null
  created_at: IsoTimestamp
  updated_at: IsoTimestamp
}

function mapRow(raw: RawAgentDraft): AgentDraftRow {
  const manifest =
    raw.generated_manifest && typeof raw.generated_manifest === 'object' &&
    Object.keys(raw.generated_manifest).length > 0
      ? (raw.generated_manifest as GeneratedManifest)
      : null
  return {
    id: raw.id,
    name: raw.name || raw.description || 'Untitled draft',
    status: raw.status,
    messages: Array.isArray(raw.conversation) ? raw.conversation : [],
    manifest,
    materializedCopilotId: raw.created_copilot_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function draftNameFromManifest(manifest: GeneratedManifest | null): string {
  if (!manifest?.systemPromptSummary) return 'Untitled draft'
  const line = manifest.systemPromptSummary.trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

export async function upsertAgentDraft(input: {
  draftId?: string
  messages: ArchitectMessage[]
  manifest: GeneratedManifest | null
}): Promise<AgentDraftRow> {
  const id = input.draftId ?? randomUUID()
  const status: AgentDraftStatus = input.manifest ? 'ready' : 'drafting'
  const summary = draftNameFromManifest(input.manifest)
  const now = new Date().toISOString()
  const payload = {
    name: summary,
    description: summary,
    runtime: 'langgraph',
    model: process.env.AGENT_BUILDER_MODEL ?? 'gpt-5.4',
    model_provider: 'openai',
    owner: 'architect',
    status,
    generated_manifest: input.manifest ?? {},
    conversation: input.messages,
    updated_at: now,
  }

  if (input.draftId) {
    const rows = await pgrest<RawAgentDraft[]>(
      'PATCH',
      `agent_drafts?id=eq.${encodeURIComponent(id)}`,
      payload,
    )
    if (rows[0]) return mapRow(rows[0])
  } else {
    const rows = await pgrest<RawAgentDraft[]>('POST', 'agent_drafts', {
      id,
      ...payload,
      created_at: now,
    })
    if (rows[0]) return mapRow(rows[0])
  }

  const fetched = await pgrest<RawAgentDraft[]>(
    'GET',
    `agent_drafts?id=eq.${encodeURIComponent(id)}&limit=1`,
  )
  if (!fetched[0]) throw new Error('agent draft upsert returned no row')
  return mapRow(fetched[0])
}

export async function listAgentDrafts(limit = 20): Promise<AgentDraftRow[]> {
  const rows = await pgrest<RawAgentDraft[]>(
    'GET',
    `agent_drafts?status=in.(drafting,ready)&order=updated_at.desc&limit=${limit}`,
  )
  return rows.map(mapRow)
}

export async function markAgentDraftMaterialized(draftId: string, copilotId: string): Promise<void> {
  await pgrest(
    'PATCH',
    `agent_drafts?id=eq.${encodeURIComponent(draftId)}`,
    {
      status: 'created',
      created_copilot_id: copilotId,
      updated_at: new Date().toISOString(),
    },
  )
}
