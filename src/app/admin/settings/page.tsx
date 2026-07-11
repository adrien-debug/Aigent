import type { Metadata } from 'next'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { Button } from '@/components/catalyst/button'

export const metadata: Metadata = {
  title: 'Settings — Agent Mission Control',
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm text-zinc-950 dark:text-white">{children}</dd>
    </div>
  )
}

export default function SettingsPage() {
  // Server component: env is read server-side only, nothing leaks to the client.
  const isGpu1 = process.env.AMC_DATA_SOURCE === 'gpu1'
  const endpoint = process.env.AMC_SUPABASE_URL ?? '— (mock)'

  return (
    <div className="space-y-8">
      <AgentSectionCard title="Control plane" description="Identity of this control plane.">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <Kv label="Workspace name">Hearst — Agent Mission Control</Kv>
          <Kv label="Owner">
            <span className="font-mono tabular-nums">adrien@hearstcorporation.io</span>
          </Kv>
          <Kv label="Data source">
            {isGpu1 ? (
              <span className="text-sm text-zinc-950 dark:text-white">GPU1 · PostgREST</span>
            ) : (
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Mock dataset</span>
            )}
          </Kv>
          <Kv label="Endpoint">
            <span className="font-mono tabular-nums break-all">{endpoint}</span>
          </Kv>
        </dl>
        <p className="mt-4 text-xs text-zinc-500">Managed by the platform · .env.local, never committed.</p>
      </AgentSectionCard>

      <AgentSectionCard
        title="Guardrail defaults"
        description="Baseline applied to new copilots — each copilot can override per tool."
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
