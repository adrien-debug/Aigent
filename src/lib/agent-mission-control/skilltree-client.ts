import 'server-only'

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { z } from 'zod'

import type { SkillTreeTrackPayload } from './agent-skills-export'

const connectionSchema = z.object({
  treeName: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(200),
  endpoint: z.url(),
  token: z.string().trim().min(1),
})

const responseSchema = z
  .object({
    ok: z.literal(true),
    slug: z.string().optional(),
    treeSlug: z.string().optional(),
    added: z.number().int().min(0).optional(),
    updated: z.number().int().min(0).optional(),
    deleted: z.number().int().min(0).optional(),
    counts: z
      .object({
        added: z.number().int().min(0).optional(),
        updated: z.number().int().min(0).optional(),
        deleted: z.number().int().min(0).optional(),
      })
      .optional(),
  })
  .passthrough()

export type SkillTreeConnection = z.infer<typeof connectionSchema>

export interface SkillTreePublishResult {
  treeName: string
  slug: string
  added: number | null
  updated: number | null
  deleted: number | null
}

export class SkillTreeClientError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'SkillTreeClientError'
  }
}

function defaultConnectionPath(): string {
  return join(homedir(), '.config', 'skilltree', 'connections', 'hearst.json')
}

export async function loadSkillTreeConnection(): Promise<SkillTreeConnection> {
  const path = process.env.SKILLTREE_CONNECTION_PATH?.trim() || defaultConnectionPath()

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    throw new SkillTreeClientError('SkillTree connection is not configured', 503)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SkillTreeClientError('SkillTree connection profile is invalid', 503)
  }

  const connection = connectionSchema.safeParse(parsed)
  if (!connection.success) {
    throw new SkillTreeClientError('SkillTree connection profile is invalid', 503)
  }

  return connection.data
}

export async function publishSkillTreeTrack(
  connection: SkillTreeConnection,
  track: SkillTreeTrackPayload
): Promise<SkillTreePublishResult> {
  let response: Response
  try {
    response = await fetch(connection.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'merge', tracks: [track] }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new SkillTreeClientError('SkillTree request failed', 502)
  }

  if (response.status === 401) {
    throw new SkillTreeClientError('Reconnect this Tree from SkillTree settings', 401)
  }
  if (!response.ok) {
    throw new SkillTreeClientError('SkillTree rejected the publish request', response.status === 422 ? 422 : 502)
  }

  const json: unknown = await response.json().catch(() => null)
  const result = responseSchema.safeParse(json)
  if (!result.success) {
    throw new SkillTreeClientError('SkillTree returned an invalid response', 502)
  }

  return {
    treeName: connection.treeName,
    slug: result.data.slug ?? result.data.treeSlug ?? connection.slug,
    added: result.data.added ?? result.data.counts?.added ?? null,
    updated: result.data.updated ?? result.data.counts?.updated ?? null,
    deleted: result.data.deleted ?? result.data.counts?.deleted ?? null,
  }
}
