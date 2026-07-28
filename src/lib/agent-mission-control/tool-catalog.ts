/**
 * Shared tool catalogue — DB mirror of registry/tools.ts + copilot mount builders.
 *
 * `tool_definitions` is the reusable catalogue; `tools` rows are per-copilot mounts
 * referencing `tool_definition_id`. Registry code remains the authority; this module
 * upserts definitions before mounts are written.
 */
import 'server-only'

import type { ProposedTool } from './authoring-types'
import { getTool, TOOL_REGISTRY, type ToolDefinition } from './registry/tools'
import { pgrest, pgrestUpsert } from './postgrest'
import { makeId, slugify } from './slug'

type RawRow = Record<string, unknown>

const PROVIDERS = new Set(['internal', 'composio', 'mcp', 'http'])

/** Fail-closed mutates default when architect omitted the field (registry wins). */
function resolveMutates(proposed: Pick<ProposedTool, 'name' | 'description' | 'mutates'>): boolean {
  if (proposed.mutates !== undefined) return proposed.mutates
  const def = getTool(proposed.name)
  if (def) return def.mutates
  return true
}

function registryToDbRow(def: ToolDefinition, descriptionOverride?: string): RawRow {
  return {
    id: def.id,
    name: def.id,
    description: descriptionOverride?.trim() || def.summary,
    provider: 'internal',
    risk_level: def.risk,
    mutates: def.mutates,
    version: def.version,
    certification: def.certification,
    provenance: def.provenance,
    kind: def.kind,
    updated_at: new Date().toISOString(),
  }
}

function proposedToDbRow(proposed: ProposedTool): RawRow {
  const def = getTool(proposed.name)
  if (def) {
    const row = registryToDbRow(def, proposed.description)
    if (proposed.provider && PROVIDERS.has(proposed.provider)) row.provider = proposed.provider
    if (proposed.riskLevel) row.risk_level = proposed.riskLevel
    row.mutates = proposed.mutates ?? resolveMutates(proposed)
    return row
  }
  return {
    id: proposed.name,
    name: proposed.name,
    description: proposed.description,
    provider: proposed.provider,
    risk_level: proposed.riskLevel,
    mutates: proposed.mutates ?? resolveMutates(proposed),
    version: '1.0.0',
    certification: 'draft',
    provenance: 'platform',
    kind: 'http-get',
    updated_at: new Date().toISOString(),
  }
}

/** Upsert one catalogue row from the registry (or proposed fallback). */
export async function ensureToolDefinition(
  toolName: string,
  overrides?: Partial<ProposedTool>
): Promise<string> {
  const proposed: ProposedTool = {
    name: toolName,
    description: overrides?.description ?? '',
    provider: overrides?.provider ?? 'internal',
    riskLevel: overrides?.riskLevel ?? 'low',
    requiresConfirmation: overrides?.requiresConfirmation ?? false,
    mutates: overrides?.mutates,
  }
  if (overrides) Object.assign(proposed, overrides)
  const row = proposedToDbRow(proposed)
  await pgrestUpsert('tool_definitions', row)
  return row.id as string
}

/** Upsert all registry tools into tool_definitions (sync job). */
export async function syncAllRegistryDefinitions(): Promise<number> {
  const rows = Object.values(TOOL_REGISTRY).map((def) => registryToDbRow(def))
  if (rows.length === 0) return 0
  await pgrestUpsert('tool_definitions', rows)
  return rows.length
}

/** Ensure catalogue rows exist for every proposed tool before mounting. */
export async function ensureToolDefinitionsForProposed(proposedTools: ProposedTool[]): Promise<void> {
  for (const proposed of proposedTools) {
    await ensureToolDefinition(proposed.name, proposed)
  }
}

/** Build per-copilot mount rows with tool_definition_id set. */
export function buildToolMountRows(
  copilotId: string,
  copilotSlug: string,
  proposedTools: ProposedTool[]
): RawRow[] {
  return proposedTools.map((proposed) => {
    const definitionId = getTool(proposed.name)?.id ?? proposed.name
    return {
      id: makeId('tool', `${slugify(copilotSlug)}-${slugify(proposed.name)}-${crypto.randomUUID().slice(0, 8)}`),
      copilot_id: copilotId,
      tool_definition_id: definitionId,
      name: proposed.name,
      description: proposed.description,
      provider: proposed.provider,
      risk_level: proposed.riskLevel,
      enabled: true,
      requires_confirmation: proposed.requiresConfirmation,
      scoped_routes: [],
      mutates: proposed.mutates ?? resolveMutates(proposed),
    }
  })
}

/** Backfill tool_definition_id on mounts missing the FK (idempotent). */
export async function backfillToolDefinitionIds(): Promise<number> {
  const rows = await pgrest<RawRow[]>('GET', 'tools?tool_definition_id=is.null&select=id,name')
  let fixed = 0
  for (const row of rows) {
    const name = row.name as string
    await ensureToolDefinition(name)
    await pgrest('PATCH', `tools?id=eq.${encodeURIComponent(row.id as string)}`, {
      tool_definition_id: name,
    })
    fixed += 1
  }
  return fixed
}
