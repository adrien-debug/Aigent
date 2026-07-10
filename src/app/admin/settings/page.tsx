import type { Metadata } from 'next'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { Badge } from '@/components/catalyst/badge'
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
    <div className="mt-2 space-y-6">
      <AgentSectionCard title="Control plane" description="Identity of this control plane.">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Kv label="Workspace name">Hearst — Agent Mission Control</Kv>
          <Kv label="Owner">
            <span className="font-mono tabular-nums">adrien@hearstcorporation.io</span>
          </Kv>
          <Kv label="Data source">
            {isGpu1 ? <Badge color="accent">GPU1 · PostgREST</Badge> : <Badge color="zinc">Mock dataset</Badge>}
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

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/5 pt-6">
        <div className="min-w-0">
          <p className="text-sm/6 font-medium text-zinc-950 dark:text-white">Archive this workspace</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Stops all copilots and freezes the registry. Reversible by a platform admin.
          </p>
        </div>
        <Button outline disabled title="Ships in V2">
          <span className="text-accent-600 dark:text-accent-400">Archive workspace</span>
        </Button>
      </div>
    </div>
  )
}
