import clsx from 'clsx'
import type { Metadata } from 'next'
import { ShieldCheckIcon, ServerStackIcon, LockClosedIcon, CogIcon } from '@heroicons/react/24/outline'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { SurfaceCard, SurfaceCardHeader, surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings — Aigent',
}

function Kv({ label, children, icon: Icon }: { label: string; children: React.ReactNode, icon?: React.ElementType }) {
  return (
    <div className={clsx('flex flex-col gap-1.5 p-4', surfaceInsetClass)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-zinc-500" />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
      </div>
      <div className="text-sm font-medium text-white mt-1">{children}</div>
    </div>
  )
}

export default async function SettingsPage() {
  const backendConfigured = process.env.AMC_DATA_SOURCE === 'gpu1' && Boolean(process.env.AMC_SUPABASE_URL)

  const [copilots, projects] = await Promise.all([getCopilots(), getProjects()])
  const openWarnings = copilots.reduce((sum, copilot) => sum + copilot.health.openWarnings, 0)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <AgentKpiBand
          stats={[
            { name: 'Registered Copilots', value: String(copilots.length) },
            { name: 'Product Surfaces', value: String(projects.length) },
            {
              name: 'Backend Posture',
              value: backendConfigured ? 'Connected' : 'Offline',
              valueTone: backendConfigured ? 'accent' : 'muted',
            },
            {
              name: 'Active Warnings',
              value: String(openWarnings),
              valueTone: openWarnings > 0 ? 'accent' : 'muted',
            },
          ]}
        />
      </StaggerFade>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StaggerFade delay={2}>
          <SurfaceCard className="flex h-full flex-col">
            <SurfaceCardHeader
              className="p-4 sm:p-6"
              title={
                <span className="inline-flex items-center gap-3">
                  <ServerStackIcon className="size-5 text-accent-400" />
                  Control Plane
                </span>
              }
              description="Identity and connection posture of this control plane."
            />
            <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Kv label="Workspace" icon={CogIcon}>Aigent — Command Center</Kv>
                <Kv label="Operated by" icon={ShieldCheckIcon}>Platform Admin</Kv>
                <Kv label="Mode" icon={LockClosedIcon}>Live-only</Kv>
                <Kv label="Backend" icon={ServerStackIcon}>
                  {backendConfigured ? (
                    <span className="text-accent-400">Connected · private perimeter</span>
                  ) : (
                    <span className="text-zinc-500">Not configured · fail-closed</span>
                  )}
                </Kv>
              </div>
              <div className="mt-6 p-4 rounded-xl bg-accent-500/5 border border-accent-500/10">
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Live backend reached through a private PostgREST perimeter. Secrets stay server-side and are never
                  exposed to the browser.
                </p>
              </div>
            </div>
          </SurfaceCard>
        </StaggerFade>

        <StaggerFade delay={3}>
          <SurfaceCard className="flex h-full flex-col">
            <SurfaceCardHeader
              className="p-4 sm:p-6"
              title={
                <span className="inline-flex items-center gap-3">
                  <ShieldCheckIcon className="size-5 text-accent-400" />
                  Runtime Posture
                </span>
              }
              description="How copilots execute and how failures are handled."
            />
            <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Kv label="Model routing">Multi-provider</Kv>
                <Kv label="Fallbacks">Explicit · opt-in only</Kv>
                <Kv label="External traces">
                  <span className="text-zinc-500">Not configured</span>
                </Kv>
                <Kv label="Tool calls">No external write</Kv>
              </div>
              <div className={clsx(surfaceInsetClass, 'mt-6 p-4')}>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Fail-closed: with no backend the app never fabricates data — every read surfaces a retry instead.
                </p>
              </div>
            </div>
          </SurfaceCard>
        </StaggerFade>
      </div>

      <StaggerFade delay={4}>
        <SurfaceCard>
          <SurfaceCardHeader
            className="p-4 sm:p-6"
            title="Guardrail Defaults"
            description="Baseline applied to new copilots — each copilot can override per tool."
          />
          <div className="p-4 sm:p-6">
            <SettingsGuardrails />
          </div>
        </SurfaceCard>
      </StaggerFade>
    </div>
  )
}
