import type { z } from 'zod'

export type ParsedToolArgs<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export function parseToolArgs<T>(schema: z.ZodType<T>, argsJson: string): ParsedToolArgs<T> {
  let raw: unknown
  try {
    raw = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return { ok: false, error: 'invalid JSON args' }
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues.map((issue) => issue.message).join('; '),
    }
  }
  return { ok: true, data: result.data }
}
