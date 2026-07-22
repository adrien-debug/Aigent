/**
 * Agent Mission Control — runner error types (server only).
 *
 * Typed sentinels the runners / model router throw. API routes map them to
 * deterministic HTTP status instead of pattern-matching error prose:
 *
 *   NotFoundError            → 404  (missing/mismatched copilot, suite, version)
 *   ProviderUnavailableError → 503  (provider SDK/env not configured)
 *   ModelAccessError         → 502  (provider replied but denied model access)
 *   ModelRouterError         → 502  (generic upstream router failure)
 *
 * ProviderUnavailableError / ModelAccessError extend ModelRouterError so a
 * caller can catch the whole router family in one clause and still branch on
 * the specific subtype where it matters.
 */
import 'server-only'

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

/**
 * A copilot declares a runtime no execution engine can serve (neither
 * 'langgraph' nor 'openai-assistants'). Thrown instead of silently picking an
 * engine: running an agent on a runtime that is not its own is exactly the bug
 * this sentinel exists to make loud (an `openai-assistants` agent executed on
 * the LangGraph graph never mounts its manifest tools and answers "no data"
 * while looking healthy). Routes map it to 409 — a config conflict, not a
 * transient upstream failure.
 */
export class UnsupportedRuntimeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedRuntimeError'
  }
}

/** Base for every model-router failure. */
export class ModelRouterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelRouterError'
  }
}

/** The provider's SDK/env isn't configured (e.g. OPENAI_API_KEY missing). */
export class ProviderUnavailableError extends ModelRouterError {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}

/** The provider replied but denied access to the model (e.g. 403 no access). */
export class ModelAccessError extends ModelRouterError {
  constructor(message: string) {
    super(message)
    this.name = 'ModelAccessError'
  }
}
