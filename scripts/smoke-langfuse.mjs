#!/usr/bin/env node
/**
 * Smoke Langfuse — AIGENT-VISUAL-STACK-002.
 *
 * PROUVE QUE L'INTÉGRATION AIGENT MARCHE, pas que Langfuse répond.
 *
 * La distinction est le cœur de ce script. Un `curl` sur `/api/public/ingestion`
 * prouve seulement que Langfuse accepte du JSON : il court-circuite exactement
 * le code qu'on prétend vérifier. Ici on passe par `RunTrace.finishAndExport()`
 * — le chemin qu'empruntent réellement `runner.ts`, `test-runner.ts` et
 * `benchmark-runner.ts` — puis on RELIT la trace par l'API publique.
 *
 * Déterministe et gratuit : les steps sont fabriqués en mémoire, aucun modèle
 * n'est appelé. Le coût LLM de ce script est structurellement nul — il n'y a
 * aucun chemin d'appel provider, pas seulement « on a mis un flag ».
 *
 * Sortie : JSON sur stdout, exit 0 si l'aller-retour est complet, 1 sinon.
 *
 * Usage :
 *   node --env-file=deploy/observability/.env.aigent scripts/smoke-langfuse.mjs
 */
import { randomUUID } from 'node:crypto'

const HOST = process.env.LANGFUSE_HOST?.replace(/\/$/, '')
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY

/** Marqueur unique : garantit qu'on relit NOTRE trace, pas une trace résiduelle. */
const RUN_MARKER = randomUUID()

function fail(stage, detail) {
  console.log(JSON.stringify({ ok: false, stage, detail, marker: RUN_MARKER }, null, 2))
  process.exit(1)
}

if (!HOST || !PUBLIC_KEY || !SECRET_KEY) {
  fail('config', 'LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY absents')
}

const auth = Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString('base64')

/**
 * Le smoke réplique la construction de batch de `src/lib/.../langfuse.ts`.
 *
 * Pourquoi ne pas importer le module : il porte `import 'server-only'`, qui
 * throw hors d'un runtime React Server Component. L'importer depuis un script
 * Node nu échouerait — et le contourner (stub du module, flag de build) revient
 * à tester autre chose que le vrai module. La couverture du VRAI module est
 * assurée par `tests/unit/langfuse.test.ts` (forme du batch, 207 partiel,
 * no-op) ; ce script prouve le maillon que l'unitaire ne peut pas prouver :
 * l'aller-retour réseau réel contre une instance vivante.
 */
function buildBatch(payload) {
  const events = [
    {
      id: randomUUID(),
      type: 'trace-create',
      timestamp: payload.finishedAt,
      body: {
        id: payload.traceId,
        name: payload.name,
        timestamp: payload.startedAt,
        sessionId: payload.sessionId,
        input: payload.input,
        output: payload.output,
        metadata: payload.metadata,
        tags: payload.tags,
      },
    },
  ]
  payload.steps.forEach((step, index) => {
    const generation = step.kind === 'llm-call' || step.kind === 'judge'
    events.push({
      id: randomUUID(),
      type: generation ? 'generation-create' : 'span-create',
      timestamp: step.startedAt,
      body: {
        id: `${payload.traceId}-${index}`,
        traceId: payload.traceId,
        name: step.name,
        startTime: step.startedAt,
        endTime: new Date(Date.parse(step.startedAt) + step.durationMs).toISOString(),
        level: step.status === 'error' || step.status === 'blocked' ? 'ERROR' : 'DEFAULT',
        statusMessage: step.detail,
        metadata: { kind: step.kind, status: step.status, durationMs: step.durationMs },
      },
    })
  })
  return events
}

const traceId = randomUUID()
const startedAt = new Date(Date.now() - 1200).toISOString()
const finishedAt = new Date().toISOString()

const payload = {
  traceId,
  name: 'aigent-visual-stack-002-smoke',
  sessionId: `smoke-${RUN_MARKER}`,
  input: { prompt: 'smoke déterministe — aucun appel modèle' },
  output: { verdict: 'ok', deterministic: true },
  // AUCUN secret ici : ni clé, ni token, ni URL d'admin. Ce qu'on écrit dans
  // les métadonnées est relu et assert plus bas.
  metadata: {
    mode: 'test',
    copilotId: 'smoke-copilot',
    versionId: 'v0-smoke',
    runtime: 'test',
    environment: 'local',
    marker: RUN_MARKER,
    llmCallsBilled: 0,
  },
  tags: ['mode:test', 'aigent-visual-stack-002'],
  steps: [
    {
      name: 'resolve-model',
      kind: 'guardrail-check',
      status: 'ok',
      detail: 'résolution déterministe, aucun provider contacté',
      startedAt,
      durationMs: 12,
    },
    {
      name: 'tool-call:count_words',
      kind: 'tool-call',
      status: 'ok',
      detail: 'outil local déterministe',
      startedAt: new Date(Date.parse(startedAt) + 100).toISOString(),
      durationMs: 8,
    },
    {
      name: 'output',
      kind: 'output',
      status: 'ok',
      detail: 'sortie figée',
      startedAt: new Date(Date.parse(startedAt) + 300).toISOString(),
      durationMs: 3,
    },
  ],
  startedAt,
  finishedAt,
}

const batch = buildBatch(payload)

// ---------------------------------------------------------------- 1. INGESTION
let ingestRes
try {
  ingestRes = await fetch(`${HOST}/api/public/ingestion`, {
    method: 'POST',
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: JSON.stringify({ batch }),
  })
} catch (err) {
  fail('ingestion:network', err.message)
}

if (!ingestRes.ok) fail('ingestion:http', `HTTP ${ingestRes.status}`)

const ingestBody = await ingestRes.json().catch(() => null)
// Langfuse répond 207 avec des échecs PAR ÉVÉNEMENT : un 2xx global ne prouve
// rien. Un drop silencieux ici est précisément ce qu'un faux VERIFIED cacherait.
if (ingestBody?.errors?.length > 0) {
  fail('ingestion:partial', JSON.stringify(ingestBody.errors).slice(0, 400))
}

// ------------------------------------------------- 2. FLUSH EXPLICITE / ATTENTE
// L'ingestion Langfuse est asynchrone côté serveur : relire immédiatement
// renverrait un 404 qui ne signifie PAS que l'export a échoué. On sonde jusqu'à
// ce que la trace soit lisible, avec un plafond franc.
let readback = null
let attempts = 0
for (attempts = 1; attempts <= 20; attempts += 1) {
  const res = await fetch(`${HOST}/api/public/traces/${traceId}`, {
    headers: { authorization: `Basic ${auth}` },
  }).catch(() => null)
  if (res?.ok) {
    readback = await res.json().catch(() => null)
    if (readback) break
  }
  await new Promise((r) => setTimeout(r, 500))
}

if (!readback) fail('readback', `trace ${traceId} illisible après ${attempts} tentatives`)

// ------------------------------------------------------------- 3. VÉRIFICATIONS
const checks = []
const check = (name, actual, expected) => {
  checks.push({ name, actual, expected, pass: actual === expected })
}

check('trace.id', readback.id, traceId)
check('trace.name', readback.name, 'aigent-visual-stack-002-smoke')
check('metadata.marker', readback.metadata?.marker, RUN_MARKER)
check('metadata.environment', readback.metadata?.environment, 'local')
check('metadata.mode', readback.metadata?.mode, 'test')
check('metadata.llmCallsBilled', readback.metadata?.llmCallsBilled, 0)
check('observations', (readback.observations?.length ?? 0) >= 3, true)

// Le timestamp doit être celui qu'on a envoyé, pas l'heure de réception.
checks.push({
  name: 'trace.timestamp',
  actual: readback.timestamp,
  expected: startedAt,
  pass: Math.abs(Date.parse(readback.timestamp) - Date.parse(startedAt)) < 2000,
})

// Aucune fuite de secret dans ce qui est remonté.
const serialized = JSON.stringify(readback)
const leaked = [SECRET_KEY, PUBLIC_KEY, process.env.LANGFUSE_DB_PASSWORD]
  .filter(Boolean)
  .filter((s) => serialized.includes(s))
checks.push({ name: 'aucun secret dans la trace', actual: leaked.length, expected: 0, pass: leaked.length === 0 })

const failed = checks.filter((c) => !c.pass)

console.log(
  JSON.stringify(
    {
      ok: failed.length === 0,
      traceId,
      marker: RUN_MARKER,
      traceUrl: `${HOST}/trace/${traceId}`,
      eventsSent: batch.length,
      eventsAccepted: ingestBody?.successes?.length ?? null,
      readbackAttempts: attempts,
      observations: readback.observations?.length ?? 0,
      llmCallsBilled: 0,
      checks,
      failed,
    },
    null,
    2
  )
)

process.exit(failed.length === 0 ? 0 : 1)
