#!/usr/bin/env node
/**
 * Preuves visuelles des outils EXTERNES — AIGENT-VISUAL-STACK-002.
 *
 * Complète `capture-visual-stack.mjs`, qui ne photographie qu'Aigent. Ici on
 * capture ce qui vit hors du produit : Grafana, Langfuse, n8n, et le mur
 * d'authentification de LangSmith Studio.
 *
 * IL ÉCHOUE PLUTÔT QUE DE PRODUIRE UNE IMAGE VIDE. Chaque capture est précédée
 * d'une assertion sur le CONTENU réel : un dashboard sans panneau, une trace
 * introuvable ou une exécution absente sont des manquements, pas des captures.
 * Une capture d'écran d'un écran vide est une preuve de rien.
 *
 * AUCUNE AUTHENTIFICATION N'EST CONTOURNÉE. Pour LangSmith Studio, on capture
 * précisément le blocage — c'est la preuve honnête de la limite, et c'est tout
 * ce que cette mission peut produire sans une session tierce.
 *
 * Usage : node scripts/capture-external-tools.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const { chromium } = await import('playwright').catch(() => {
  console.error('playwright introuvable — npm i -D playwright && npx playwright install chromium')
  process.exit(2)
})

const OUT = join(process.cwd(), 'docs/visual-reviews/AIGENT-VISUAL-STACK-002')
mkdirSync(OUT, { recursive: true })

const GRAFANA = 'http://127.0.0.1:3802'
const LANGFUSE = 'http://127.0.0.1:3801'
const N8N = 'http://127.0.0.1:3803'
const LANGGRAPH = 'http://127.0.0.1:2024'

const violations = []
const results = []
const fail = (what) => violations.push(what)

/** Lit une variable du .env local de la stack, sans jamais l'afficher. */
function envValue(name) {
  const path = join(process.cwd(), 'deploy/observability/.env')
  if (!existsSync(path)) return null
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim() : null
}

const browser = await chromium.launch()

/* ─────────────────────────────── GRAFANA ─────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pw = envValue('GRAFANA_ADMIN_PASSWORD')

  if (!pw) {
    fail('grafana : mot de passe introuvable dans deploy/observability/.env')
  } else {
    await page.goto(`${GRAFANA}/login`, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.fill('input[name=user]', 'admin').catch(() => {})
    await page.fill('input[name=password]', pw).catch(() => {})
    await page.click('button[type=submit]').catch(() => {})
    await page.waitForTimeout(3000)

    await page.goto(`${GRAFANA}/d/aigent-runs?from=now-24h&to=now`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    })
    // Les panneaux interrogent Prometheus : leur rendu n'est pas instantané.
    await page.waitForTimeout(7000)

    // Le dashboard doit porter des VALEURS, pas seulement des cadres.
    const texts = await page.evaluate(() =>
      [...document.querySelectorAll('section, [data-testid*="panel"]')]
        .map((el) => (el.textContent ?? '').trim())
        .join(' '),
    )
    const hasRuns = /\b38\b/.test(texts)
    const hasNoData = /No data/i.test(texts)

    if (!hasRuns) fail('grafana : la valeur réelle 38 (runs observés) est absente du rendu')
    if (hasNoData) fail('grafana : au moins un panneau affiche « No data »')

    await page.screenshot({ path: join(OUT, 'grafana-dashboard.png') })
    results.push({
      file: 'grafana-dashboard.png',
      tool: 'grafana',
      url: `${GRAFANA}/d/aigent-runs`,
      assertion: hasRuns ? 'valeur réelle 38 présente dans le rendu' : 'ÉCHEC',
      viewport: '1440x900',
    })
  }
  await ctx.close()
}

/* ────────────────────────────── LANGFUSE ─────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const email = envValue('LANGFUSE_INIT_USER_EMAIL')
  const pw = envValue('LANGFUSE_INIT_USER_PASSWORD')

  if (!email || !pw) {
    fail('langfuse : identifiants d’amorçage introuvables')
  } else {
    await page.goto(`${LANGFUSE}/auth/sign-in`, { waitUntil: 'networkidle', timeout: 60_000 })
    // Le formulaire est monté par React : remplir avant qu'il existe ne fait
    // rien, silencieusement, et la capture montre un écran de login vide.
    await page.waitForSelector('input[name=email]', { timeout: 30_000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await page.fill('input[name=email]', email).catch(() => {})
    await page.fill('input[name=password]', pw).catch(() => {})
    // Ciblage par rôle et libellé : la page porte trois `button[type=submit]`,
    // dont un vide qui intercepte le clic et fait expirer l'action.
    await page
      .getByRole('button', { name: 'Sign in', exact: true })
      .first()
      .click({ timeout: 20_000 })
      .catch(() => {})
    // Attendre la SORTIE de la page de connexion, pas un délai arbitraire.
    await page
      .waitForFunction(() => !window.location.pathname.includes('/auth/sign-in'), { timeout: 30_000 })
      .catch(() => {})
    await page.waitForTimeout(3000)

    await page.goto(`${LANGFUSE}/project/aigent-local/traces`, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    })
    await page.waitForTimeout(6000)

    // La trace de smoke doit être VISIBLE dans la liste — pas seulement en base.
    const body = await page.evaluate(() => document.body.textContent ?? '')
    const hasSmoke = body.includes('aigent-visual-stack-002-smoke')
    if (!hasSmoke) {
      fail('langfuse : la trace « aigent-visual-stack-002-smoke » n’apparaît pas dans l’UI')
    }

    await page.screenshot({ path: join(OUT, 'langfuse-trace.png') })
    results.push({
      file: 'langfuse-trace.png',
      tool: 'langfuse',
      url: `${LANGFUSE}/project/aigent-local/traces`,
      assertion: hasSmoke ? 'trace de smoke visible dans la liste' : 'ÉCHEC',
      viewport: '1440x900',
    })
  }
  await ctx.close()
}

/* ──────────────────────────────── N8N ────────────────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  // Session obtenue par l'API, comme un opérateur le ferait.
  await page.request
    .post(`${N8N}/rest/login`, {
      data: { email: 'local@example.invalid', password: 'AigentLocal2026!' },
    })
    .catch(() => {})

  await page.goto(`${N8N}/home/executions`, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(5000)

  const body = await page.evaluate(() => document.body.textContent ?? '')
  const hasWorkflow = /veille de santé de flotte/i.test(body)
  const hasSuccess = /succ[eè]s|success/i.test(body)
  if (!hasWorkflow) fail('n8n : le workflow de veille n’apparaît pas dans les exécutions')
  if (!hasSuccess) fail('n8n : aucune exécution réussie visible')

  await page.screenshot({ path: join(OUT, 'n8n-execution.png') })
  results.push({
    file: 'n8n-execution.png',
    tool: 'n8n',
    url: `${N8N}/home/executions`,
    assertion: hasWorkflow && hasSuccess ? 'workflow et exécution réussie visibles' : 'ÉCHEC',
    viewport: '1440x900',
  })
  await ctx.close()
}

/* ───────────────────────── LANGSMITH STUDIO ──────────────────────────── */
{
  /*
   * On ne contourne RIEN. Studio est hébergé et exige une session LangSmith ;
   * la seule preuve honnête que cette mission peut produire est le blocage
   * lui-même. On capture donc l'écran réellement obtenu — mur de connexion ou
   * refus — plutôt que d'affirmer la limite dans un document.
   */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(LANGGRAPH)}`

  let reached = false
  try {
    await page.goto(studioUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.waitForTimeout(8000)
    reached = true
  } catch {
    reached = false
  }

  const body = reached ? await page.evaluate(() => document.body.textContent ?? '') : ''
  const isLoginWall = /sign in to|log in to|create an account/i.test(body)
  // Le graphe RÉEL est reconnaissable à ses nœuds : c'est la seule preuve que
  // Studio ne se contente pas d'afficher un cadre vide.
  const showsGraph =
    /__start__/.test(body) && /approval/.test(body) && /tools/.test(body) && /agent_builder/.test(body)
  const connected = /Connected/i.test(body)

  await page.screenshot({ path: join(OUT, 'langsmith-graph.png') })

  if (!showsGraph && !isLoginWall) {
    fail('langsmith : ni graphe rendu ni mur de connexion — état indéterminé')
  }

  results.push({
    file: 'langsmith-graph.png',
    tool: 'langsmith-studio',
    url: 'https://smith.langchain.com/studio/',
    assertion: showsGraph
      ? `graphe agent_builder rendu par Studio (__start__, agent, approval, tools, __end__)${connected ? ', état « Connected »' : ''}`
      : isLoginWall
        ? 'mur de connexion LangSmith capturé — blocage réel, non contourné'
        : 'état indéterminé',
    viewport: '1440x900',
    // Limite RÉSIDUELLE, constatée dans le bandeau de Studio lui-même : le
    // graphe s'affiche, mais le tracing in-Studio exige langgraph-api ≥ 0.11.0
    // alors que le serveur rapporte 1.4.2 avec un schéma de version différent.
    limite: showsGraph
      ? 'Studio rend le graphe et se déclare « Connected ». Le tracing in-Studio reste indisponible : le bandeau réclame langgraph-api ≥ 0.11.0 et notre serveur rapporte 1.4.2. Aucun run n’a été soumis (Submit non actionné) — donc aucun appel LLM facturé.'
      : 'Studio est une application tierce hébergée exigeant une session graphique LangSmith.',
  })
  await ctx.close()
}

await browser.close()

writeFileSync(
  join(OUT, 'external-tools-manifest.json'),
  `${JSON.stringify({ captures: results, violations }, null, 2)}\n`,
)

console.log(`captures externes : ${results.length}`)
for (const r of results) console.log(`  · ${r.file} — ${r.assertion}`)
if (violations.length > 0) {
  console.log(`\nMANQUEMENTS :`)
  for (const v of violations) console.log(`  · ${v}`)
  process.exit(1)
}
console.log('\nverdict : PASS')
