/**
 * Project Builder — pure preview helpers (no I/O).
 */
import type { AgentPreview, AgentPreviewOption } from './project-builder-types'

export function mergePreview(base: AgentPreview | null, patch: Partial<AgentPreview> | null): AgentPreview | null {
  if (!patch || Object.keys(patch).length === 0) return base
  const merged: AgentPreview = { ...base, ...patch }
  if (patch.options && base?.options) {
    const byId = new Map(base.options.map((o) => [o.id, o]))
    for (const o of patch.options) byId.set(o.id, o)
    merged.options = [...byId.values()]
  }
  return merged
}

/**
 * Returns the preview with `optionId` applied, or `null` when the option does
 * not exist (unknown id, or no preview/options at all). Returning the preview
 * unchanged on an unknown id used to mask the failure — callers persisted a
 * "selection" that never happened. `null` is the distinguishable signal.
 */
export function selectPreviewOption(preview: AgentPreview | null, optionId: string): AgentPreview | null {
  if (!preview?.options?.length) return null
  const option = preview.options.find((o) => o.id === optionId)
  if (!option) return null
  return applyOptionToPreview(preview, option, optionId)
}

function applyOptionToPreview(preview: AgentPreview, option: AgentPreviewOption, optionId: string): AgentPreview {
  return {
    ...preview,
    selectedOptionId: optionId,
    name: preview.name ?? option.title,
    role: preview.role ?? option.summary,
    description: preview.description ?? option.summary,
    riskPolicy: preview.riskPolicy ?? option.tradeoffs.join(' · '),
  }
}

/** Fail-closed guard before starting LangGraph materialization. */
export function canStartDraftMaterialization(preview: AgentPreview | null): { ok: true } | { ok: false; reason: string } {
  if (!preview) return { ok: false, reason: 'no preview — discuss a spec with the architect first' }
  if (!preview.readyForApproval) {
    return { ok: false, reason: 'preview is not marked ready for approval — ask the architect to prepare the draft first' }
  }
  if (!preview.name?.trim()) return { ok: false, reason: 'preview missing agent name' }
  return { ok: true }
}

const SECRET_RE =
  /(?:GITHUB_TOKEN|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|LANGSMITH_API_KEY|AMC_SESSION_SECRET|AMC_ADMIN_PASSWORD|x-agent-key)\s*[:=]\s*\S+/gi

/** Strip obvious secret patterns before persisting message text. */
export function redactMessageContent(content: string): string {
  return content.replace(SECRET_RE, '[redacted-secret]')
}

export function defaultAgentFlow(): string[] {
  return ['start', 'agent', 'approval?', 'tools?', 'final']
}
