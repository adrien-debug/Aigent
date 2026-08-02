/**
 * Agent Mission Control — agent delivery event persistence (server only).
 *
 * Records each delivery of an agent to a target repo (direct_commit or
 * pull_request) into `agent_delivery_events` (migration 0015), and reads back
 * the latest one for a copilot so the UI can show "latest delivery: PR #123 ·
 * branch …". No sensitive data — only public GitHub URLs/shas. Never import from
 * a client component (reads the service-role key).
 */
import 'server-only'

import { pgrest } from './postgrest'
import type { PushAgentDeliveryMode } from './github'

type RawRow = Record<string, unknown>

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

export interface DeliveryEventInput {
  id: string
  copilotId: string
  versionId: string | null
  projectId: string | null
  mode: PushAgentDeliveryMode
  targetRepo: string
  targetBranch: string | null
  deliveryBranch: string | null
  commitSha: string | null
  commitUrl: string | null
  prUrl: string | null
  prNumber: number | null
  status: string
}

export interface DeliveryEvent {
  id: string
  copilotId?: string
  versionId?: string | null
  projectId?: string | null
  mode: PushAgentDeliveryMode
  targetRepo: string
  targetBranch: string | null
  deliveryBranch: string | null
  commitSha: string | null
  commitUrl: string | null
  prUrl: string | null
  prNumber: number | null
  status: string
  createdAt: string
}

/** Persist a delivery event. Throws on a hard PostgREST error (caller logs + degrades). */
export async function persistDeliveryEvent(input: DeliveryEventInput): Promise<void> {
  await pgrest('POST', 'agent_delivery_events', {
    id: input.id,
    copilot_id: input.copilotId,
    version_id: input.versionId,
    project_id: input.projectId,
    mode: input.mode,
    target_repo: input.targetRepo,
    target_branch: input.targetBranch,
    delivery_branch: input.deliveryBranch,
    commit_sha: input.commitSha,
    commit_url: input.commitUrl,
    pr_url: input.prUrl,
    pr_number: input.prNumber,
    status: input.status,
  })
}

/** Latest delivery event for a copilot (newest by created_at), or null. Pure DB read. */
export async function getLatestDeliveryEvent(copilotId: string): Promise<DeliveryEvent | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `agent_delivery_events?${eq('copilot_id', copilotId)}&select=*&order=created_at.desc&limit=1`
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id as string,
    copilotId: row.copilot_id as string,
    versionId: (row.version_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    mode: row.mode as PushAgentDeliveryMode,
    targetRepo: row.target_repo as string,
    targetBranch: (row.target_branch as string | null) ?? null,
    deliveryBranch: (row.delivery_branch as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    commitUrl: (row.commit_url as string | null) ?? null,
    prUrl: (row.pr_url as string | null) ?? null,
    prNumber: (row.pr_number as number | null) ?? null,
    status: row.status as string,
    createdAt: row.created_at as string,
  }
}

/** Delivery event by id (for installation provisioning/version verification). */
export async function getDeliveryEventById(eventId: string): Promise<DeliveryEvent | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `agent_delivery_events?${eq('id', eventId)}&select=*&limit=1`
  )
  const row = rows[0]
  if (!row) return null
  return {
    id: row.id as string,
    copilotId: row.copilot_id as string,
    versionId: (row.version_id as string | null) ?? null,
    projectId: (row.project_id as string | null) ?? null,
    mode: row.mode as PushAgentDeliveryMode,
    targetRepo: row.target_repo as string,
    targetBranch: (row.target_branch as string | null) ?? null,
    deliveryBranch: (row.delivery_branch as string | null) ?? null,
    commitSha: (row.commit_sha as string | null) ?? null,
    commitUrl: (row.commit_url as string | null) ?? null,
    prUrl: (row.pr_url as string | null) ?? null,
    prNumber: (row.pr_number as number | null) ?? null,
    status: row.status as string,
    createdAt: row.created_at as string,
  }
}
