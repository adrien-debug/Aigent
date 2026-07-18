/**
 * AIG-STABILIZATION-003 (C4) — rebrand the 7 finance copilots to the LOCAL
 * provider so the DB tells the truth about the model actually executed.
 *
 * THE DRIFT this fixes: the 7 `copilot-fin-*` agents are provisioned with
 * `model_provider='openai'`, `model='gpt-5.4'` and a non-null `assistant_id`
 * (a LangGraph assistant that DOES exist server-side but is INERT on the
 * direct model-router path they actually run on). The architecture decision
 * (Adrien §3) is that the 7 AP agents execute via the DIRECT model-router,
 * already wired to the local vLLM park (`local-llama-70b`, model-local.ts).
 * The DB metadata therefore lies twice: wrong provider/model, and a phantom
 * assistant_id pointing at a path these agents never take. This script makes
 * the DB match reality:
 *   - copilots  copilot-fin-* → model_provider='local', model='local-llama-70b',
 *     assistant_id=null (kill the inert, misleading metadata)
 *   - copilot_versions of those copilots → model_provider='local',
 *     model='local-llama-70b'
 * The `runtime` column is deliberately LEFT AS-IS ('openai-assistants'): it is
 * the historical loop-shape marker; execution is routed by model_provider on
 * the direct path, documented in AGENTS.md (§ Finance runtime).
 *
 * SCOPE: this is a DB metadata patch only — DETERMINISTIC, zero LLM/OpenAI
 * call, zero network beyond PostgREST, no secret written anywhere. Read-only
 * with respect to any ERP/prod system; it only touches the two Aigent tables.
 *
 * IDEMPOTENT: the target set is the 7 rows whose id/slug matches the finance
 * prefix; a re-run skips any copilot/version already at
 * model_provider='local' + model='local-llama-70b' (+ null assistant_id for
 * copilots), so it converges without ever double-patching.
 *
 * The write shape mirrors provision-finance-roster.ts exactly (direct `fetch`
 * to PostgREST with the service-role key, so it stays free of the
 * `server-only` guard protecting app modules).
 *
 * Requires the live env (loaded via `node --env-file=.env.local`):
 *   AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * FALLBACK NOTE (verified, not changed here): model-local.ts / model-router.ts
 * already fail NON-silently when the local endpoint is down — `runLocal` throws
 * a typed `ProviderUnavailableError`, the router applies model-fallbacks.ts and
 * always marks `fallbackUsed: true` + reason, or propagates the typed error. A
 * local outage never degrades to a silent "completed" run.
 *
 * Run: npm run rebrand:finance-local
 */
type Row = Record<string, unknown>

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
  console.error(
    'live backend not configured (need AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
  )
  process.exit(1)
}

/** Stable finance identity: copilots have id `copilot-fin-*` / slug `fin-*`. */
const SLUG_PREFIX = 'fin-'
/** Target metadata — the model actually executed on the direct model-router path. */
const TARGET_PROVIDER = 'local'
const TARGET_MODEL = 'local-llama-70b'

async function pgrest<T = Row[]>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key as string,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok)
    throw new Error(
      `PostgREST ${res.status} on ${method} ${pathAndQuery}: ${(await res.text()).slice(0, 300)}`,
    )
  if (res.status === 204) return [] as unknown as T
  const text = await res.text()
  return (text ? JSON.parse(text) : []) as T
}

interface CopilotRow {
  id: string
  slug: string
  model_provider: string | null
  model: string | null
  assistant_id: string | null
}

interface VersionRow {
  id: string
  copilot_id: string
  model_provider: string | null
  model: string | null
}

async function main() {
  // 1. Read the 7 finance copilots (by slug prefix — the stable identity).
  const copilots = await pgrest<CopilotRow[]>(
    'GET',
    `copilots?slug=like.${SLUG_PREFIX}*&select=id,slug,model_provider,model,assistant_id&order=slug.asc`,
  )
  if (copilots.length === 0) {
    console.error(`no finance copilots found (slug like ${SLUG_PREFIX}*) — nothing to rebrand`)
    process.exit(1)
  }

  const copilotsPatched: string[] = []
  const copilotsSkipped: string[] = []

  for (const c of copilots) {
    const alreadyLocal =
      c.model_provider === TARGET_PROVIDER && c.model === TARGET_MODEL && c.assistant_id === null
    if (alreadyLocal) {
      copilotsSkipped.push(c.slug)
      continue
    }
    await pgrest('PATCH', `copilots?id=eq.${encodeURIComponent(c.id)}`, {
      model_provider: TARGET_PROVIDER,
      model: TARGET_MODEL,
      assistant_id: null,
      updated_at: new Date().toISOString(),
    })
    copilotsPatched.push(c.slug)
    console.log(
      `[copilot] ${c.slug} → provider=${TARGET_PROVIDER} model=${TARGET_MODEL} assistant_id=null` +
        (c.assistant_id ? ` (dropped inert assistant ${c.assistant_id})` : ''),
    )
  }

  // 2. Read + patch the corresponding copilot_versions.
  const ids = copilots.map((c) => c.id)
  const inList = ids.map((i) => `"${i}"`).join(',')
  const versions = await pgrest<VersionRow[]>(
    'GET',
    `copilot_versions?copilot_id=in.(${inList})&select=id,copilot_id,model_provider,model&order=copilot_id.asc`,
  )

  const versionsPatched: string[] = []
  const versionsSkipped: string[] = []

  for (const v of versions) {
    const alreadyLocal = v.model_provider === TARGET_PROVIDER && v.model === TARGET_MODEL
    if (alreadyLocal) {
      versionsSkipped.push(v.id)
      continue
    }
    await pgrest('PATCH', `copilot_versions?id=eq.${encodeURIComponent(v.id)}`, {
      model_provider: TARGET_PROVIDER,
      model: TARGET_MODEL,
    })
    versionsPatched.push(v.id)
    console.log(`[version] ${v.id} → provider=${TARGET_PROVIDER} model=${TARGET_MODEL}`)
  }

  // 3. Proof — re-read both tables and assert the target metadata.
  const proofCopilots = await pgrest<CopilotRow[]>(
    'GET',
    `copilots?slug=like.${SLUG_PREFIX}*&select=id,slug,model_provider,model,assistant_id&order=slug.asc`,
  )
  const proofVersions = await pgrest<VersionRow[]>(
    'GET',
    `copilot_versions?copilot_id=in.(${inList})&select=id,copilot_id,model_provider,model&order=copilot_id.asc`,
  )

  const copilotsOk = proofCopilots.every(
    (c) =>
      c.model_provider === TARGET_PROVIDER && c.model === TARGET_MODEL && c.assistant_id === null,
  )
  const versionsOk = proofVersions.every(
    (v) => v.model_provider === TARGET_PROVIDER && v.model === TARGET_MODEL,
  )

  console.log(
    JSON.stringify(
      {
        copilotsPatched,
        copilotsSkipped,
        versionsPatched,
        versionsSkipped,
        proofCopilots,
        proofVersions,
        copilotsOk,
        versionsOk,
      },
      null,
      2,
    ),
  )

  if (!copilotsOk || !versionsOk) {
    console.error('POST-CONDITION FAILED — some finance rows are not local after rebrand')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('rebrand failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
