import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { Button } from '@/components/catalyst/button'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'

export const metadata: Metadata = {
  title: 'Settings — Agent Mission Control',
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium text-zinc-950 dark:text-white">{children}</dd>
    </div>
  )
}

export default async function SettingsPage() {
  // Server component. Env is read server-side ONLY to derive a boolean posture
  // — the raw endpoint URL, host/IP, env-var names and secrets are NEVER sent to
  // the browser. The UI shows an operator-safe status, not the infrastructure.
  const backendConfigured = process.env.AMC_DATA_SOURCE === 'gpu1' && Boolean(process.env.AMC_SUPABASE_URL)

  const [copilots, projects] = await Promise.all([getCopilots(), getProjects()])
  const openWarnings = copilots.reduce((sum, copilot) => sum + copilot.health.openWarnings, 0)

  return (
    <div className="space-y-8">
      {/* Header uniforme sur les 5 pages /admin (directive Adrien 2026-07-11). */}
      <AgentPageHeader title="Settings" description="Control-plane posture and platform-wide guardrails." className="mt-2" />

      <AgentKpiBand
        stats={[
          { name: 'Copilots', value: String(copilots.length), hint: 'registered' },
          { name: 'Projects', value: String(projects.length), hint: 'product surfaces' },
          {
            name: 'Backend',
            value: backendConfigured ? 'Connected' : 'Not configured',
            hint: backendConfigured ? 'live perimeter' : 'fail-closed',
          },
          { name: 'Open warnings', value: String(openWarnings), hint: 'across the fleet' },
        ]}
      />

      {/* Control plane — identity + posture, ZERO infrastructure detail. No raw
          endpoint, host, IP, env-var name or file path is rendered. */}
      <AgentSectionCard title="Control plane" description="Identity and connection posture of this control plane.">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
          <Kv label="Workspace">Hearst — Agent Mission Control</Kv>
          <Kv label="Operated by">Platform admin</Kv>
          <Kv label="Mode">Live-only</Kv>
          <Kv label="Backend">
            {backendConfigured ? (
              <span className="text-sm font-medium text-zinc-950 dark:text-white">Connected · private perimeter</span>
            ) : (
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Not configured · fail-closed</span>
            )}
          </Kv>
        </dl>
        <p className="mt-8 text-xs text-zinc-500">
          Live backend reached through a private PostgREST perimeter. Secrets stay server-side and are never
          exposed to the browser.
        </p>
      </AgentSectionCard>

      {/* Runtime posture — how runs are executed, in operator terms. */}
      <AgentSectionCard title="Runtime posture" description="How copilots execute and how failures are handled.">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
          <Kv label="Model routing">Multi-provider</Kv>
          <Kv label="Fallbacks">Explicit · opt-in only</Kv>
          <Kv label="External traces">
            <span className="font-medium text-zinc-500">Not configured — no external trace recorded</span>
          </Kv>
          <Kv label="Tool calls">No external write without confirmation</Kv>
        </dl>
        <p className="mt-8 text-xs text-zinc-500">
          Fail-closed: with no backend the app never fabricates data — every read surfaces a retry instead.
        </p>
      </AgentSectionCard>

      <AgentSectionCard
        title="Guardrail defaults"
        description="Baseline applied to new copilots — each copilot can override per tool."
        contentClassName="px-6 py-6"
      >
        <SettingsGuardrails />
      </AgentSectionCard>

      <AgentSectionCard
        title="Archive workspace"
        description="Stops all copilots and freezes the registry. Reversible by a platform admin."
        actions={
          <Button outline disabled title="Ships in V2">
            Archive workspace
          </Button>
        }
      >
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Not available yet — ships in V2.</p>
      </AgentSectionCard>
    </div>
  )
}
