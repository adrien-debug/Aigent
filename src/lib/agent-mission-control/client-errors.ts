/**
 * Client-side error copy for agent-ops fetches. NOT 'server-only' — this is
 * imported by client components that need a human message for a failed
 * Response. A 503 means the live gpu1 backend isn't wired up, and every
 * surface must say so the same way (matching run-copilot-panel, architect-chat,
 * create-agent-form, new-project-workbench).
 */
export async function messageForResponse(response: Response, fallback: string): Promise<string> {
  if (response.status === 503) return 'Live backend not configured.'
  const body = (await response.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? fallback
}
