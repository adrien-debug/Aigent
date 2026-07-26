import clsx from 'clsx'
import { ShieldCheckIcon, ServerStackIcon } from '@heroicons/react/24/outline'

import { SettingsGuardrails } from '@/components/agent-ops/settings-guardrails'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { PageHeader, eyebrowClass } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { surfaceSunken } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'

/**
 * Key/value tile of the two posture cards.
 *
 * The label rides `eyebrowClass` rather than a hand-written copy of it. The
 * hand-written one shipped `text-zinc-500`, measured 4.02:1 on this sunken
 * plane (#0d0d10) at 10px — under the 4.5 AA threshold, and 8 of the 8 glyph
 * runs the contrast gate reported on /admin/settings. `eyebrowClass` is the
 * ONE definition of that overline and already carries the measured fix
 * (zinc-400 = 7.57:1 on the same plane); importing it is also what stops this
 * label drifting away from the page header's overline again.
 *
 * No per-tile icon. Four of the eight tiles carried a decorative icon and the
 * other four did not, so the two cards sitting side by side in the same grid
 * row rendered label rows of different heights (78px against 77px, measured)
 * — a visible imbalance for glyphs that carried no information the label did
 * not already state. Removed rather than duplicated onto the other four.
 *
 * Spacing has ONE owner: the `gap-1.5` of this column. The value used to add
 * `mt-1` on top of it, so the label/value distance was 6px+4px decided in two
 * places.
 */
function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={clsx('flex flex-col gap-1.5 p-4', surfaceSunken)}>
      <span className={eyebrowClass}>{label}</span>
      <div className="text-sm font-medium text-white">{children}</div>
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

      {/* Both cards must fill their grid cell in EVERY state — the two posture
          cards carry different sentence lengths, so their natural heights only
          coincide by luck at one viewport width. `h-full` on the animated cell
          AND on the section makes it structural: `items-stretch` alone stops at
          the motion wrapper, and the section inside it would still be auto. */}
      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
        <StaggerFade className="h-full" delay={2}>
          <Section
            className="h-full"
            contentClassName="p-6 flex-1 flex flex-col justify-between"
            title={
              <span className="inline-flex items-center gap-3">
                <ServerStackIcon className="size-5 text-accent-400" />
                Control Plane
              </span>
            }
            description="Identity and connection posture of this control plane."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Kv label="Workspace">Aigent — Command Center</Kv>
              <Kv label="Operated by">Platform Admin</Kv>
              <Kv label="Mode">Live-only</Kv>
              <Kv label="Backend">
                {backendConfigured ? (
                  <span className="text-accent-400">Connected · private perimeter</span>
                ) : (
                  // zinc-400, not zinc-500: on this sunken plane zinc-500 measures
                  // 4.02:1 — the exact ratio the contrast gate rejected for the
                  // labels above. This branch only renders when the backend is
                  // missing, so the gate never sees it; the plane is the same, so
                  // the verdict is the same.
                  <span className="text-zinc-400">Not configured · fail-closed</span>
                )}
              </Kv>
            </div>
            <p className="mt-6 text-xs leading-relaxed text-zinc-400">
              Live backend reached through a private PostgREST perimeter. Secrets stay server-side and are never
              exposed to the browser.
            </p>
          </Section>
        </StaggerFade>

        <StaggerFade className="h-full" delay={3}>
          <Section
            className="h-full"
            contentClassName="p-6 flex-1 flex flex-col justify-between"
            title={
              <span className="inline-flex items-center gap-3">
                <ShieldCheckIcon className="size-5 text-accent-400" />
                Runtime Posture
              </span>
            }
            description="How copilots execute and how failures are handled."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Kv label="Model routing">Multi-provider</Kv>
              <Kv label="Fallbacks">Explicit · opt-in only</Kv>
              <Kv label="External traces">
                {/* Same measured reason as the Backend tile above. */}
                {tracesConfigured ? (
                  <span className="text-accent-400">Configured · Langfuse</span>
                ) : (
                  <span className="text-zinc-400">Not configured</span>
                )}
              </Kv>
              <Kv label="Tool calls">No external write</Kv>
            </div>
            <p className="mt-6 text-xs leading-relaxed text-zinc-400">
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
