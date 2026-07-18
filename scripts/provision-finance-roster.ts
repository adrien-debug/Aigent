/**
 * AIG-FIN-001 — provision the 7 materializable finance agents (P1 slice,
 * Accounts Payable vertical + independent verifier) as DRAFT copilots in the
 * live gpu1 perimeter, attached to `proj-accounting-agent`.
 *
 * This is PROVISIONING, not materialization: everything below is a
 * DETERMINISTIC assembly from the roster config (finance/agents/roster.ts) —
 * ZERO LLM/OpenAI call, zero network beyond PostgREST. The billed OpenAI
 * materialization stays §8-gated and does NOT happen here.
 *
 * IDEMPOTENT: identity is the stable slug `fin-<roster slug>` and every id is
 * deterministic (makeId, no randomness) — a re-run skips agents whose slug
 * already exists, so it converges without ever creating a duplicate.
 *
 * The write shape mirrors authoring-writes.ts / provision-agent-builder.ts
 * exactly (same FK-safe order copilots → manifests → tools → tool_ids PATCH →
 * copilot_versions, same columns) — but talks to PostgREST directly with
 * `fetch` so it stays free of the `server-only` guard protecting app modules.
 *
 * Requires the live env (loaded via `node --env-file=.env.local`):
 *   AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run: npm run provision:finance-roster
 */
import {
  FINANCE_TEAMS,
  getMaterializableAgents,
  renderBlockingPolicySection,
  type FinanceLlmRoleDef,
} from '../src/lib/agent-mission-control/finance/agents/roster'
import { FINANCE_TOOL_DESCRIPTIONS } from '../src/lib/agent-mission-control/finance/tool-descriptions'
import { makeId, slugify } from '../src/lib/agent-mission-control/slug'

type Row = Record<string, unknown>

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
  console.error(
    'live backend not configured (need AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)',
  )
  process.exit(1)
}

const PROJECT_ID = 'proj-accounting-agent'
const MODEL = 'gpt-5.4'
const OWNER = 'aig-fin-001'
const PROVENANCE = 'aig-fin-001-roster'
const SLUG_PREFIX = 'fin'

/** Display names for the P1 slice — deterministic config, keyed by roster slug. */
const NAME_BY_SLUG: Readonly<Record<string, string>> = {
  documents: 'Documents',
  fournisseurs: 'Fournisseurs',
  'controle-factures': 'Contrôle Factures',
  'securite-fournisseurs': 'Sécurité Fournisseurs',
  'ecritures-comptables': 'Écritures Comptables',
  'paiements-fournisseurs': 'Paiements Fournisseurs',
  'controleur-general': 'Contrôleur Général',
}

/**
 * Hard invariants of the Accounting Agent Factory, woven into every system
 * prompt (mirror of the trading roster's SHARED_SAFETY_INVARIANTS).
 */
const SHARED_INVARIANTS: readonly string[] = [
  'Tu es READ-ONLY : tu ne peux JAMAIS écrire directement dans un ERP — la seule porte d’écriture est l’Execution Gateway (stub read-only en P1).',
  'Tu ne peux JAMAIS exécuter, signer ou déclencher un paiement — au mieux tu PRÉPARES une proposition qui exige une approbation humaine.',
  'Ta sortie structurée est le contrat Zod nommé de ton manifest (contracts.ts, versionné) — un champ critique manquant = rapport REJETÉ, jamais coercé.',
  'Les montants sont des chaînes décimales lossless (DecimalString), JAMAIS des floats.',
  'Une donnée absente est UNAVAILABLE avec sa provenance (LIVE/SNAPSHOT/HISTORICAL/FIXTURE/FALLBACK/UNAVAILABLE) — tu n’inventes JAMAIS une valeur.',
  'Séparation des responsabilités (§47) : l’auto-approbation est impossible — qui a préparé ne peut pas approuver.',
  'Les gates bloquantes sont terminales : un BLOCKED de securite-fournisseurs ou un REJECTED du controleur-general ne peut être dégradé par personne.',
]

/** Forbidden actions shared by the whole P1 slice (every agent is read-only). */
const SHARED_FORBIDDEN: readonly string[] = [
  'écrire directement dans un ERP (aucune écriture hors Execution Gateway, stub read-only en P1)',
  'exécuter, signer, approuver ou déclencher un paiement',
  'inventer, estimer-comme-fait ou masquer une donnée manquante (UNAVAILABLE + provenance obligatoires)',
  'représenter un montant en float (DecimalString lossless uniquement)',
  's’auto-approuver ou contourner une approbation (séparation des responsabilités §47)',
  'dégrader ou contourner un verdict BLOCKED/REJECTED d’une gate bloquante',
]

/** Compose the agent's system prompt deterministically from its roster config. */
function composePrompt(agent: FinanceLlmRoleDef): string {
  const team = FINANCE_TEAMS.find((t) => t.id === agent.team)
  const name = NAME_BY_SLUG[agent.slug] ?? agent.slug
  const lines: string[] = [
    `Tu es « ${name} », agent comptable de l’équipe ${team?.name ?? agent.team} (AIG-FIN-001).`,
    `Mission d’équipe : ${team?.mission ?? '—'}`,
    `Rôle : ${agent.definition}`,
    '',
    'Actions couvertes :',
    ...agent.actions.map((a) => `- ${a}`),
    '',
    `Contrat de sortie : ${agent.contractId ?? '(aucun contrat structuré)'} — JSON strict validé par Zod (finance/contracts.ts).`,
  ]
  if (agent.blocking) {
    lines.push(
      '',
      'GATE BLOQUANTE : ton verdict BLOCKED/REJECTED est TERMINAL — aucun autre agent ne peut le contourner (miroir de Sentinel dans le council trading).',
    )
    // Same rendered section as the bench harness (shared roster helper): the
    // mission alone never encodes WHEN the gate must fire.
    const policy = renderBlockingPolicySection(agent)
    if (policy.length > 0) lines.push('', ...policy)
  }
  lines.push('', 'Invariants non négociables :', ...SHARED_INVARIANTS.map((s) => `- ${s}`))
  return lines.join('\n')
}

/** Every finance tool is a read-only internal handler, low risk, no confirm. */
function toolPayloadsFor(agent: FinanceLlmRoleDef, copilotId: string): Row[] {
  return agent.toolNames.map((name) => ({
    id: makeId('tool', `${SLUG_PREFIX}-${agent.slug}-${slugify(name)}`),
    copilot_id: copilotId,
    name,
    description:
      FINANCE_TOOL_DESCRIPTIONS[name] ??
      `Read-only finance tool ${name} (AIG-FIN-001). Returns UNAVAILABLE rather than fabricating data.`,
    provider: 'internal',
    risk_level: 'low',
    enabled: true,
    requires_confirmation: false,
    scoped_routes: [],
  }))
}

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

async function main() {
  // 0. Fail-closed: the target project must exist — we never create it here.
  const project = await pgrest<{ id: string }[]>(
    'GET',
    `projects?select=id&id=eq.${encodeURIComponent(PROJECT_ID)}`,
  )
  if (!project[0]) {
    console.error(`target project not found in DB: ${PROJECT_ID}`)
    process.exit(1)
  }

  const agents = getMaterializableAgents()
  const existing = await pgrest<{ slug: string }[]>('GET', 'copilots?select=slug')
  const taken = new Set(existing.map((r) => r.slug))

  const now = new Date().toISOString()
  const created: Array<{ slug: string; copilotId: string; tools: number }> = []
  const skipped: string[] = []

  for (const agent of agents) {
    const slug = `${SLUG_PREFIX}-${agent.slug}`
    if (taken.has(slug)) {
      skipped.push(slug)
      continue
    }

    // Deterministic ids — stable key per slug, no randomness (idempotency).
    const copilotId = makeId('copilot', slug)
    const manifestId = makeId('manifest', slug)
    const versionId = makeId('version', slug)
    const name = NAME_BY_SLUG[agent.slug] ?? agent.slug
    const contractName = agent.contractId ? agent.contractId.split('@')[0] : 'none'
    const contractVersion = agent.contractId?.split('@')[1] ?? null

    // 1. copilots (parent first — every child FK resolves)
    await pgrest('POST', 'copilots', {
      id: copilotId,
      project_id: PROJECT_ID,
      target_project_ids: [PROJECT_ID],
      name,
      slug,
      description: agent.definition,
      runtime: 'openai-assistants', // direct model-router loop (trading precedent)
      status: 'draft',
      production_version_id: null,
      latest_version_id: versionId,
      model: MODEL,
      model_provider: 'openai',
      owner: OWNER,
      tags: [
        'finance',
        'aig-fin-001',
        agent.team,
        ...(agent.blocking ? ['blocking-gate'] : []),
      ],
      created_at: now,
      updated_at: now,
      health: {
        testPassRate: 0,
        benchmarkScore: 0,
        runsLast24h: 0,
        errorRateLast24h: 0,
        avgLatencyMs: 0,
        costLast24hUsd: 0,
        openWarnings: 0,
      },
      created_via: PROVENANCE,
    })

    // 2. manifest (tool_ids backfilled after tools are created)
    await pgrest('POST', 'manifests', {
      id: manifestId,
      copilot_id: copilotId,
      version: 'v0.1.0-draft',
      system_prompt_summary: composePrompt(agent),
      allowed_routes: [], // no HTTP surface: finance tools are internal read-only handlers
      forbidden_actions: SHARED_FORBIDDEN,
      confirmation_policy: 'risky-only',
      always_confirm_actions:
        agent.slug === 'paiements-fournisseurs'
          ? ['transmettre un lot de paiements au système autorisé']
          : [],
      memory_sources: [],
      output_contract: {
        format: 'json',
        schemaName: contractName,
        invariants: [
          ...(contractVersion ? [`contrat versionné ${contractVersion} (finance/contracts.ts)`] : []),
          'montants en DecimalString lossless, jamais de float',
          'provenance + fraîcheur attachées ; les blocs UNAVAILABLE sont listés, jamais cachés',
          ...(agent.blocking ? ['verdict BLOCKED/REJECTED terminal — non dégradable en aval'] : []),
        ],
      },
      skills: agent.actions.map((a) => ({ label: a })),
      tool_ids: [],
      max_steps_per_run: 12,
      max_cost_per_run_usd: 0.08,
      updated_at: now,
    })

    // 3. tools (bulk insert, ids computed client-side), backfill manifest.tool_ids
    const toolPayloads = toolPayloadsFor(agent, copilotId)
    const toolIds = toolPayloads.map((t) => t.id as string)
    if (toolPayloads.length > 0) {
      await pgrest('POST', 'tools', toolPayloads)
      await pgrest('PATCH', `manifests?id=eq.${encodeURIComponent(manifestId)}`, {
        tool_ids: toolIds,
      })
    }

    // 4. draft version (points at the manifest)
    await pgrest('POST', 'copilot_versions', {
      id: versionId,
      copilot_id: copilotId,
      label: 'v0.1.0-draft',
      stage: 'draft',
      manifest_id: manifestId,
      model: MODEL,
      model_provider: 'openai',
      changelog: 'AIG-FIN-001 roster — draft provisionné (assemblage déterministe, zéro appel LLM)',
      created_at: now,
      created_by: OWNER,
      scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: 0 },
    })

    created.push({ slug, copilotId, tools: toolIds.length })
    console.log(`provisioned ${slug} -> ${copilotId} (${toolIds.length} tools)`)
  }

  // 5. Proof — re-read the provisioned copilots + their project attachment.
  const proof = await pgrest<Row[]>(
    'GET',
    `copilots?slug=like.${SLUG_PREFIX}-*&select=id,slug,name,status,project_id,target_project_ids,created_via&order=slug.asc`,
  )
  console.log(JSON.stringify({ created, skipped, total: agents.length, proof }, null, 2))
}

main().catch((err) => {
  console.error('provisioning failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
