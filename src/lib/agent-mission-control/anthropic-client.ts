/**
 * Agent Mission Control — Anthropic SDK client (server only).
 *
 * Single place the SDK is instantiated. Fail-closed like data.ts's
 * requireBackend(): if ANTHROPIC_API_KEY is missing, every caller gets a
 * clear thrown error instead of a silently broken client.
 *
 * Never import this module from a client component.
 */
import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

export const ARCHITECT_MODEL = 'claude-sonnet-4-5'
export const RUNNER_MODEL = 'claude-sonnet-4-5'

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'Agent Mission Control needs ANTHROPIC_API_KEY to call Claude. Set it in .env.local.'
    )
  }
  return new Anthropic({ apiKey })
}
