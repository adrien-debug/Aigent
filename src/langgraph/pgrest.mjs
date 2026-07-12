/**
 * Minimal PostgREST client for the LangGraph Agent Server process.
 *
 * The `langgraphjs dev` server runs in its OWN Node process (not Next.js), so
 * it can't import the app's `server-only`-guarded data layer. This is a tiny,
 * self-contained fetch client against the same gpu1 PostgREST perimeter,
 * reading the same env the app uses (AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 */

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function pgrest(pathAndQuery) {
  if (!base || !key) {
    throw new Error('LangGraph tools: backend not configured (AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  }
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : []
}
