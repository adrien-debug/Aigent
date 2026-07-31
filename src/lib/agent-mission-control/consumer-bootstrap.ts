/**
 * Consumer workspace bootstrap — one standard intake pack pushed into the
 * project's linked GitHub repo when an operator provisions the workspace.
 *
 * The pack is framework-neutral at the edges (registry, bindings, AGENTS-WANTED)
 * plus a minimal Next.js App Router intake surface the host restyles to match
 * its own design system. After provision, Aigent only pushes agents; the
 * workspace UI handles activate / rebind / deploy-version gestures.
 */
import 'server-only'

import type { Project } from './types'

export const CONSUMER_PACK_VERSION = '1.0.0'

export const CONSUMER_READY_PATH = 'aigent/consumer-ready.json'
export const BINDINGS_PATH = 'aigent/bindings.json'
export const AGENTS_WANTED_PATH = 'AGENTS-WANTED.md'
export const REGISTRY_JSON_PATH = 'agents/_registry.json'
export const REGISTRY_README_PATH = 'agents/README.md'

export interface ScaffoldedConsumerFile {
  path: string
  content: string
}

export interface ConsumerReadyMarker {
  version: string
  projectKey: string
  projectName: string
  provisionedAt: string
  aigentProjectId: string
}

/** Stable project key for runtime API / registry scoping (slug-based). */
export function consumerProjectKey(project: Project): string {
  return project.slug
}

function renderAgentsWanted(project: Project): string {
  return `# Agents wanted — ${project.name}

This file is the **demand channel** from this workspace to Aigent. Describe what
you need in plain language; the Agent Builder reads it when framing new agents.

## Open requests

<!-- Add one block per need. Example:

### Risk dashboard sentinel
- **Priority:** high
- **Why:** We need read-only pre-trade risk on ETH before orders reach the book.
- **Tools:** market snapshots, account risk (when available)
- **Success:** blocks or reduces when exposure exceeds policy

-->

_No open requests yet — describe the first agent you need above._

## Fulfilled

<!-- Moved here when Aigent pushes an agent that covers the request. -->

---

_Provisioned by Aigent (${CONSUMER_PACK_VERSION}). Do not delete — the factory reads this file._
`
}

function renderRegistryReadme(): string {
  return `# Hosted agents

Agents deployed from **Aigent** (Agent Mission Control). Re-push from the platform
to update — do not hand-edit manifests or handlers.

_No agents hosted yet._
`
}

function renderConsumerReady(project: Project, provisionedAt: string): string {
  const marker: ConsumerReadyMarker = {
    version: CONSUMER_PACK_VERSION,
    projectKey: consumerProjectKey(project),
    projectName: project.name,
    provisionedAt,
    aigentProjectId: project.id,
  }
  return `${JSON.stringify(marker, null, 2)}\n`
}

function renderBindings(): string {
  return `${JSON.stringify({ agents: [] }, null, 2)}\n`
}

function renderEnvExample(project: Project): string {
  return `# Aigent consumer runtime — copy to .env.local and fill in secrets.
# AIGENT_PROJECT_KEY is pre-filled from the Aigent project that provisioned
# this workspace. It is a convenience override only: each registry row already
# carries its own aigentProjectId, so telemetry identifies the correct project
# even if this var is left unset.
AIGENT_PROJECT_KEY=${consumerProjectKey(project)}

AIGENT_TELEMETRY_ENABLED=false
AIGENT_TELEMETRY_ENDPOINT=
AIGENT_TELEMETRY_TOKEN=
`
}

function renderPackReadme(project: Project): string {
  return `# Aigent consumer intake (${CONSUMER_PACK_VERSION})

Workspace **${project.name}** (\`${consumerProjectKey(project)}\`) is wired to receive
agents from Aigent.

## What was provisioned

| Path | Role |
|------|------|
| \`app/admin/aigent/\` | Intake UI — list, activate, rebind agents |
| \`app/api/aigent/intake/\` | HTTP API for the intake surface |
| \`lib/aigent/\` | Registry reader, bindings store, telemetry client |
| \`agents/_registry.json\` | Machine index of pushed agents (Aigent writes) |
| \`aigent/bindings.json\` | Where each agent is **branched** in this product |
| \`AGENTS-WANTED.md\` | Demand file — what agents this workspace needs |

## Operator flow

1. **Aigent** tests agents on final tools → promotes → **push** → registry updates.
2. **This workspace** opens \`/admin/aigent\` → activate → set **target route**.
3. Optional: enable \`AIGENT_TELEMETRY_*\` so execution runs flow back to Aigent.

Restyle the intake page to match **your** design system — the scaffold is deliberately neutral.

## Env (consumer runtime)

| Variable | Purpose |
|----------|---------|
| \`AIGENT_TELEMETRY_ENABLED\` | \`'true'\` to send execution events to Aigent |
| \`AIGENT_TELEMETRY_ENDPOINT\` | Aigent \`/api/runtime-telemetry\` URL |
| \`AIGENT_TELEMETRY_TOKEN\` | Bearer \`AIGENT_RUNTIME_TELEMETRY_TOKEN\` |

## Optional DB

\`aigent/migrations/001_bindings.sql\` — use when file-based bindings are not enough.
`
}

function renderTypes(): string {
  return `/** Aigent consumer types — generated scaffold, safe to extend locally. */

export type AgentBindingStatus = 'inactive' | 'active' | 'deployed'

export interface RegistryAgent {
  slug: string
  name: string
  version: string
  model: string
  runtime: string
  source: 'aigent'
  pushedAt: string
  manifestPath: string
  /** Identity chain back to Aigent — written on every push, used to bind an
   *  activation/run to a real project/copilot/version when telemetry flows
   *  back. OPTIONAL because a registry written before these fields existed
   *  must still load: dropping such a row would hide a really-installed agent
   *  from the consumer, and rewriting the file would delete it outright. */
  aigentProjectId?: string
  copilotId?: string
  versionId?: string | null
}

export interface AgentBinding {
  slug: string
  status: AgentBindingStatus
  /** Where this agent is wired in the product, e.g. /admin/trading */
  targetRoute: string
  activeVersion: string
  updatedAt: string
}

export interface BindingsFile {
  agents: AgentBinding[]
}
`
}

function renderRegistryLib(): string {
  return `import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { BindingsFile, RegistryAgent } from './types'

const REGISTRY_PATH = join(process.cwd(), 'agents/_registry.json')
const BINDINGS_PATH = join(process.cwd(), 'aigent/bindings.json')

export async function readRegistry(): Promise<RegistryAgent[]> {
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (row): row is RegistryAgent =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as RegistryAgent).slug === 'string' &&
        (row as RegistryAgent).source === 'aigent'
    )
  } catch {
    return []
  }
}

export async function readBindings(): Promise<BindingsFile> {
  try {
    const raw = await readFile(BINDINGS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as BindingsFile
    if (!parsed || !Array.isArray(parsed.agents)) return { agents: [] }
    return parsed
  } catch {
    return { agents: [] }
  }
}

export async function writeBindings(next: BindingsFile): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  await mkdir(dirname(BINDINGS_PATH), { recursive: true })
  await writeFile(BINDINGS_PATH, \`\${JSON.stringify(next, null, 2)}\\n\`, 'utf8')
}
`
}

function renderTelemetryClient(): string {
  return `/**
 * Opt-in execution telemetry → Aigent (best-effort, non-blocking).
 * Enables real run data to flow back to the factory after branch/activate.
 *
 * The wire payload MUST match Aigent's ingestion contract
 * (POST /api/runtime-telemetry, a strict Zod schema mirroring
 * runtime_telemetry_events): required { eventId, projectId, agentId, runId,
 * timestamp, status }, and NO unknown keys (the schema is .strict()). Keep this
 * interface in sync with that schema.
 */

export type TelemetryStatus = 'started' | 'completed' | 'failed'

export interface RuntimeTelemetryEvent {
  eventId: string
  runId: string
  /** The agent (copilot) id, as published in the Aigent registry. */
  agentId: string
  /** The Aigent project key this consumer belongs to. */
  projectId: string
  /** ISO-8601 event time. */
  timestamp: string
  status: TelemetryStatus
  latencyMs?: number
  model?: string
  provider?: 'openai' | 'gemini' | 'custom' | 'unknown'
  /** Hash of an error message (never the raw message). Maps to error.messageHash. */
  errorMessageHash?: string
}

function enabled(): boolean {
  return process.env.AIGENT_TELEMETRY_ENABLED === 'true'
}

export async function emitRuntimeTelemetry(event: RuntimeTelemetryEvent): Promise<void> {
  if (!enabled()) return
  const endpoint = process.env.AIGENT_TELEMETRY_ENDPOINT
  const token = process.env.AIGENT_TELEMETRY_TOKEN
  if (!endpoint || !token) return

  // Build ONLY the keys Aigent's strict schema accepts.
  const payload: Record<string, unknown> = {
    eventId: event.eventId,
    projectId: event.projectId,
    agentId: event.agentId,
    runId: event.runId,
    timestamp: event.timestamp,
    status: event.status,
  }
  if (typeof event.latencyMs === 'number') payload.latencyMs = event.latencyMs
  if (event.model) payload.model = event.model
  if (event.provider) payload.provider = event.provider
  if (event.errorMessageHash) payload.error = { messageHash: event.errorMessageHash }

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Bearer \${token}\`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3_000),
    })
  } catch {
    // Best-effort — never block the host app.
  }
}
`
}

function renderIntakePage(): string {
  return `import { IntakeWorkbench } from './intake-workbench'
import { readBindings, readRegistry } from '@/lib/aigent/registry'

export const metadata = {
  title: 'Aigent — Agents',
  description: 'Receive, activate and branch agents pushed from Aigent.',
}

/** Neutral intake shell — restyle to match your design system. */
export default async function AigentIntakePage() {
  const [registry, bindings] = await Promise.all([readRegistry(), readBindings()])
  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Aigent intake</p>
        <h1 className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Hosted agents</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Agents are built and tested in Aigent, then pushed here. Activate and wire each agent to any
          route in your product — execution telemetry can flow back when enabled.
        </p>
      </header>
      <IntakeWorkbench initialRegistry={registry} initialBindings={bindings} />
    </div>
  )
}
`
}

function renderIntakeWorkbench(): string {
  return `'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { AgentBinding, BindingsFile, RegistryAgent } from '@/lib/aigent/types'

type Row = RegistryAgent & { binding?: AgentBinding }

function mergeRows(registry: RegistryAgent[], bindings: BindingsFile): Row[] {
  const bySlug = new Map(bindings.agents.map((b) => [b.slug, b]))
  return registry.map((agent) => ({ ...agent, binding: bySlug.get(agent.slug) }))
}

export function IntakeWorkbench({
  initialRegistry,
  initialBindings,
}: {
  initialRegistry: RegistryAgent[]
  initialBindings: BindingsFile
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rows = mergeRows(initialRegistry, initialBindings)

  async function post(slug: string, action: 'activate' | 'bind', targetRoute?: string) {
    setBusy(slug)
    setError(null)
    try {
      const res = await fetch(
        action === 'activate'
          ? \`/api/aigent/intake/\${encodeURIComponent(slug)}/activate\`
          : \`/api/aigent/intake/\${encodeURIComponent(slug)}/bind\`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: action === 'bind' ? JSON.stringify({ targetRoute: targetRoute ?? '/' }) : undefined,
        }
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? \`Request failed (\${res.status})\`)
        return
      }
      router.refresh()
    } catch {
      setError('Network error — could not reach the intake API.')
    } finally {
      setBusy(null)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">No agents yet</p>
        <p className="mt-2 text-sm text-zinc-500">
          Push a promoted agent from Aigent — it will appear here automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((row) => (
          <li key={row.slug} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-zinc-900 dark:text-zinc-50">{row.name}</p>
              <p className="text-xs text-zinc-500">
                {row.slug} · {row.version} · {row.runtime}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Branch:{' '}
                <span className="font-mono text-zinc-700 dark:text-zinc-300">
                  {row.binding?.targetRoute ?? '—'}
                </span>
                {' · '}
                Status: {row.binding?.status ?? 'inactive'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === row.slug}
                onClick={() => post(row.slug, 'activate')}
                className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {busy === row.slug ? '…' : 'Activate'}
              </button>
              <button
                type="button"
                disabled={busy === row.slug}
                onClick={() => {
                  const route = window.prompt('Target route in this product', row.binding?.targetRoute ?? '/')
                  if (route) void post(row.slug, 'bind', route)
                }}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-200"
              >
                Rebind
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
`
}

function renderIntakeGetRoute(): string {
  return `import { NextResponse } from 'next/server'

import { readBindings, readRegistry } from '@/lib/aigent/registry'

export async function GET() {
  const [registry, bindings] = await Promise.all([readRegistry(), readBindings()])
  return NextResponse.json({ registry, bindings })
}
`
}

function renderActivateRoute(): string {
  return `import { NextResponse } from 'next/server'

import { readBindings, readRegistry, writeBindings } from '@/lib/aigent/registry'
import { emitRuntimeTelemetry } from '@/lib/aigent/telemetry-client'

export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const registry = await readRegistry()
  const agent = registry.find((a) => a.slug === slug)
  if (!agent) {
    return NextResponse.json({ error: 'agent not in registry — push from Aigent first' }, { status: 404 })
  }

  const bindings = await readBindings()
  const now = new Date().toISOString()
  const existing = bindings.agents.find((b) => b.slug === slug)
  const next = {
    slug,
    status: 'active' as const,
    targetRoute: existing?.targetRoute ?? '/',
    activeVersion: agent.version,
    updatedAt: now,
  }
  const others = bindings.agents.filter((b) => b.slug !== slug)
  await writeBindings({ agents: [...others, next] })

  // The registry row carries the Aigent project id that pushed this agent —
  // that is the reliable identity, independent of whether the operator has
  // set AIGENT_PROJECT_KEY locally. Env var wins only if explicitly set.
  void emitRuntimeTelemetry({
    eventId: crypto.randomUUID(),
    runId: \`activate-\${slug}-\${Date.now()}\`,
    agentId: agent.copilotId,
    projectId: process.env.AIGENT_PROJECT_KEY ?? agent.aigentProjectId,
    timestamp: now,
    status: 'completed',
  })

  return NextResponse.json({ ok: true, binding: next })
}
`
}

function renderBindRoute(): string {
  return `import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readBindings, readRegistry, writeBindings } from '@/lib/aigent/registry'

const bodySchema = z.object({ targetRoute: z.string().min(1).max(500) })

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const registry = await readRegistry()
  if (!registry.some((a) => a.slug === slug)) {
    return NextResponse.json({ error: 'agent not in registry' }, { status: 404 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid targetRoute' }, { status: 400 })
  }

  const bindings = await readBindings()
  const now = new Date().toISOString()
  const existing = bindings.agents.find((b) => b.slug === slug)
  const next = {
    slug,
    status: existing?.status ?? ('inactive' as const),
    targetRoute: parsed.data.targetRoute,
    activeVersion: existing?.activeVersion ?? registry.find((a) => a.slug === slug)!.version,
    updatedAt: now,
  }
  const others = bindings.agents.filter((b) => b.slug !== slug)
  await writeBindings({ agents: [...others, next] })

  return NextResponse.json({ ok: true, binding: next })
}
`
}

function renderBindingsMigration(): string {
  return `-- Optional: file-based bindings (aigent/bindings.json) are enough for V1.
-- Apply this when the consumer workspace already uses Postgres/Supabase.

create table if not exists aigent_agent_bindings (
  slug text primary key,
  status text not null check (status in ('inactive', 'active', 'deployed')),
  target_route text not null default '/',
  active_version text not null,
  updated_at timestamptz not null default now()
);

alter table aigent_agent_bindings enable row level security;
-- Deny-by-default: wire service-role writes in your API routes.
`
}

/**
 * Build the full consumer intake pack for a project. Pure — no I/O.
 */
export function buildConsumerIntakePack(project: Project, provisionedAt: string): ScaffoldedConsumerFile[] {
  return [
    { path: CONSUMER_READY_PATH, content: renderConsumerReady(project, provisionedAt) },
    { path: AGENTS_WANTED_PATH, content: renderAgentsWanted(project) },
    { path: REGISTRY_JSON_PATH, content: '[]\n' },
    { path: REGISTRY_README_PATH, content: renderRegistryReadme() },
    { path: BINDINGS_PATH, content: renderBindings() },
    { path: 'aigent/README.md', content: renderPackReadme(project) },
    { path: 'aigent/.env.example', content: renderEnvExample(project) },
    { path: 'lib/aigent/types.ts', content: renderTypes() },
    { path: 'lib/aigent/registry.ts', content: renderRegistryLib() },
    { path: 'lib/aigent/telemetry-client.ts', content: renderTelemetryClient() },
    { path: 'app/admin/aigent/page.tsx', content: renderIntakePage() },
    { path: 'app/admin/aigent/intake-workbench.tsx', content: renderIntakeWorkbench() },
    { path: 'app/api/aigent/intake/route.ts', content: renderIntakeGetRoute() },
    { path: 'app/api/aigent/intake/[slug]/activate/route.ts', content: renderActivateRoute() },
    { path: 'app/api/aigent/intake/[slug]/bind/route.ts', content: renderBindRoute() },
    { path: 'aigent/migrations/001_bindings.sql', content: renderBindingsMigration() },
  ]
}

/** Branch name for the provision PR. */
export function consumerProvisionBranchName(projectSlug: string): string {
  const clean = projectSlug
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 48)
  return `aigent/provision-${clean || 'workspace'}`
}
