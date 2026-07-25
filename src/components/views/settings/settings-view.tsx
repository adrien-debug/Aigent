import clsx from 'clsx'
import { ShieldCheckIcon, ServerStackIcon, LockClosedIcon, CogIcon } from '@heroicons/react/24/outline'

import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { surfaceSunken } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'

function Kv({ label, children, icon: Icon }: { label: string; children: React.ReactNode; icon?: React.ElementType }) {
  return (
    <div className={clsx('flex flex-col gap-1.5 p-4', surfaceSunken)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className="size-4 text-zinc-500" />}
        <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</span>
      </div>
      <div className="text-sm font-medium text-white mt-1">{children}</div>
    </div>
  )
}

export function SettingsView({
  backendConfigured,
  tracesConfigured,
}: {
  backendConfigured: boolean
  tracesConfigured: boolean
}) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={1}>
        <PageHeader title="Settings" />
      </StaggerFade>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StaggerFade delay={2}>
          <Section
            className="flex h-full flex-col"
            contentClassName="p-6 flex-1 flex flex-col justify-between"
            title={
              <span className="inline-flex items-center gap-3">
                <ServerStackIcon className="size-5 text-accent-400" />
                Control Plane
              </span>
            }
            description="Identity and connection posture of this control plane."
          >
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
            <p className="mt-6 text-xs text-zinc-400 leading-relaxed">
              Live backend reached through a private PostgREST perimeter. Secrets stay server-side and are never
              exposed to the browser.
            </p>
          </Section>
        </StaggerFade>

        <StaggerFade delay={3}>
          <Section
            className="flex h-full flex-col"
            contentClassName="p-6 flex-1 flex flex-col justify-between"
            title={
              <span className="inline-flex items-center gap-3">
                <ShieldCheckIcon className="size-5 text-accent-400" />
                Runtime Posture
              </span>
            }
            description="How copilots execute and how failures are handled."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Kv label="Model routing">Multi-provider</Kv>
              <Kv label="Fallbacks">Explicit · opt-in only</Kv>
              <Kv label="External traces">
                {tracesConfigured ? (
                  <span className="text-accent-400">Configured · Langfuse</span>
                ) : (
                  <span className="text-zinc-500">Not configured</span>
                )}
              </Kv>
              <Kv label="Tool calls">No external write</Kv>
            </div>
            <p className="mt-6 text-xs text-zinc-400 leading-relaxed">
              Fail-closed: with no backend the app never fabricates data — every read surfaces a retry instead.
            </p>
          </Section>
        </StaggerFade>
      </div>

      <StaggerFade delay={4}>
        <Section title="Guardrail Defaults" description="Baseline applied to new copilots — each copilot can override per tool.">
          <SettingsGuardrails />
        </Section>
      </StaggerFade>
    </PageLayout>
  )
}
