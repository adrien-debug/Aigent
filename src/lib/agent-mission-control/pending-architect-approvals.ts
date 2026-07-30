import 'server-only'

import { getAgentBuilderRunState } from './agent-builder-run'
import { pgrest } from './postgrest'

/** One project-builder conversation paused at the LangGraph human-approval interrupt. */
export type PendingArchitectApproval = {
  conversationId: string
  projectId: string
  threadId: string
  updatedAt: string
}

/** Bound Agent Server polls — conversations are ordered newest-first. */
const SCAN_LIMIT = 12

/**
 * Cross-project queue of architect runs waiting for operator approval.
 *
 * `null` only when the conversation table could not be read. An empty array
 * means the read succeeded and no live thread is paused at the interrupt.
 */
export async function listPendingArchitectApprovals(): Promise<PendingArchitectApproval[] | null> {
  let rows: Record<string, unknown>[]
  try {
    rows = await pgrest<Record<string, unknown>[]>(
      'GET',
      `project_builder_conversations?langgraph_thread_id=not.is.null&status=in.(active,draft_ready)&select=id,project_id,langgraph_thread_id,updated_at&order=updated_at.desc&limit=${SCAN_LIMIT}`
    )
  } catch (err) {
    console.error(
      '[pending-architect-approvals] conversation list failed:',
      err instanceof Error ? err.message : err
    )
    return null
  }

  const pending: PendingArchitectApproval[] = []
  for (const row of rows) {
    const threadId = row.langgraph_thread_id as string | null
    const projectId = row.project_id as string | null
    const conversationId = row.id as string | null
    const updatedAt = row.updated_at as string | null
    if (!threadId || !projectId || !conversationId || !updatedAt) continue

    try {
      const state = await getAgentBuilderRunState(threadId)
      if (state?.status !== 'awaiting_approval') continue
      pending.push({ conversationId, projectId, threadId, updatedAt })
    } catch (err) {
      console.warn(
        '[pending-architect-approvals] run state lookup failed for thread',
        threadId,
        err instanceof Error ? err.message : err
      )
    }
  }

  return pending
}
