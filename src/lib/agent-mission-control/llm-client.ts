/**
 * Agent Mission Control — OpenAI SDK client (server only).
 *
 * Single place the SDK is instantiated. Fail-closed like data.ts's
 * requireBackend(): if OPENAI_API_KEY is missing, every caller gets a
 * clear thrown error instead of a silently broken client.
 *
 * Never import this module from a client component.
 */
import 'server-only'

import OpenAI from 'openai'

export const ARCHITECT_MODEL = 'gpt-5.4'

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'Agent Mission Control needs OPENAI_API_KEY to call OpenAI. Set it in .env.local.'
    )
  }
  return new OpenAI({ apiKey })
}
