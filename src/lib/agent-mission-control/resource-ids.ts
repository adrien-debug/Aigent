/**
 * Shape guards for persisted resource ids (`makeId('copilot'|'proj', slug)`).
 * Shared by API routes so PATCH/POST reject garbage before PostgREST.
 */
export const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/
export const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

export function isValidCopilotId(id: string): boolean {
  return typeof id === 'string' && COPILOT_ID_RE.test(id)
}

export function isValidProjectId(id: string): boolean {
  return typeof id === 'string' && PROJECT_ID_RE.test(id)
}

/** Providers operators may assign when creating a copilot. */
export const CREATABLE_MODEL_PROVIDERS = ['openai', 'google', 'local'] as const
