import type { Metadata } from 'next'
import { ShieldCheckIcon, ServerStackIcon, LockClosedIcon, CogIcon } from '@heroicons/react/24/outline'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Settings — Aigent',
}

function Kv({ label, children, icon: Icon }: { label: string; children: React.ReactNode, icon?: React.ElementType }) {
  return (
    <div className="flex flex-col gap-1.5 p-4 rounded-xl bg-black/20 border border-white/5">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-zinc-500" />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
      </div>
      <div className="text-sm font-medium text-white mt-1">{children}</div>
    </div>
  )
}

interface KpiBandProps {
  copilotsCount: number
  projectsCount: number
  backendConfigured: boolean
  openWarnings: number
}

function KpiBand({ copilotsCount, projectsCount, backendConfigured, openWarnings }: KpiBandProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 py-6 border-b border-white/5 mb-8">
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Registered Copilots</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{copilotsCount}</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Product Surfaces</span>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-light tracking-tight text-white">{projectsCount}</span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Backend Posture</span>
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-light tracking-tight ${backendConfigured ? 'text-accent-400' : 'text-zinc-500'}`}>
            {backendConfigured ? 'Connected' : 'Offline'}
          </span>
        </div>
      </div>
      <div className="flex flex-col">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Active Warnings</span>
        <div className="flex items-baseline gap-2">
          <span className={`text-4xl font-light tracking-tight ${openWarnings > 0 ? 'text-accent-400' : 'text-zinc-500'}`}>{openWarnings}</span>
        </div>
      </div>
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
        <AgentPageHeader
          title="Settings"
          description="Control-plane posture, security policies, and platform-wide guardrails."
          breadcrumbs={[
            { label: 'Platform', href: '/admin' },
            { label: 'Settings' }
          ]}
        />
      </StaggerFade>

      <StaggerFade delay={1}>
        <KpiBand 
          copilotsCount={copilots.length} 
          projectsCount={projects.length} 
          backendConfigured={backendConfigured} 
          openWarnings={openWarnings} 
        />
      </StaggerFade>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StaggerFade delay={2}>
          <div className="flex flex-col rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden h-full">
            <div className="p-6 border-b border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <ServerStackIcon className="size-5 text-accent-400" />
                <h2 className="text-sm font-semibold text-white">Control Plane</h2>
              </div>
              <p className="text-xs text-zinc-400">Identity and connection posture of this control plane.</p>
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between">
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
          </div>
        </StaggerFade>

        <StaggerFade delay={3}>
          <div className="flex flex-col rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden h-full">
            <div className="p-6 border-b border-white/5">
              <div className="flex items-center gap-3 mb-2">
                <ShieldCheckIcon className="size-5 text-accent-400" />
                <h2 className="text-sm font-semibold text-white">Runtime Posture</h2>
              </div>
              <p className="text-xs text-zinc-400">How copilots execute and how failures are handled.</p>
            </div>
            <div className="p-6 flex-1 flex flex-col justify-between">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Kv label="Model routing">Multi-provider</Kv>
                <Kv label="Fallbacks">Explicit · opt-in only</Kv>
                <Kv label="External traces">
                  <span className="text-zinc-500">Not configured</span>
                </Kv>
                <Kv label="Tool calls">No external write</Kv>
              </div>
              <div className="mt-6 p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Fail-closed: with no backend the app never fabricates data — every read surfaces a retry instead.
                </p>
              </div>
            </div>
          </div>
        </StaggerFade>
      </div>

      <StaggerFade delay={4}>
        <div className="flex flex-col rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden">
          <div className="p-6 border-b border-white/5">
            <h2 className="text-sm font-semibold text-white">Guardrail Defaults</h2>
            <p className="text-xs text-zinc-400 mt-1">Baseline applied to new copilots — each copilot can override per tool.</p>
          </div>
          <div className="p-6">
            <SettingsGuardrails />
          </div>
        </div>
      </StaggerFade>
    </div>
  )
}
