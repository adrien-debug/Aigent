import clsx from 'clsx'
import { CodeBracketIcon, CpuChipIcon, ShieldCheckIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { surfaceCardClass } from '@/components/agent-ops/surface-card'

import { Link } from '@/components/catalyst/link'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Project } from '@/lib/agent-mission-control/types'

interface ProjectRollup {
  copilotCount: number
  activeCount: number
  runsLast24h: number
  costLast24hUsd: number
  openWarnings: number
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="truncate text-sm font-mono tabular-nums text-white">{children}</span>
      <span className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</span>
    </div>
  )
}

export function ProjectCard({
  project,
  rollup,
  href,
}: {
  project: Project
  rollup: ProjectRollup
  href: string
}) {
  const hasWarnings = rollup.openWarnings > 0

  return (
    <div
      className={clsx(
        surfaceCardClass,
        'group relative flex flex-col bg-[var(--color-surface-elevated)]'
      )}
    >
      {/* Top accent band */}
      <div className="h-1 w-full shrink-0 bg-[var(--accent-line)]" />

      <div className="flex flex-1 flex-col gap-5 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-black/40 text-lg font-bold uppercase text-white ring-1 ring-white/10">
              {project.name.slice(0, 2)}
            </div>
            <div className="flex min-w-0 flex-col">
              <Link
                href={href}
                className="truncate text-base font-semibold text-white hover:underline before:absolute before:inset-0"
              >
                {project.name}
              </Link>
              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                <CodeBracketIcon className="size-3.5 shrink-0 text-zinc-500" />
                <span className="truncate font-mono text-xs text-zinc-400">
                  {project.repoFullName ?? 'no repo linked'}
                </span>
              </div>
            </div>
          </div>

          <div className="relative z-10 shrink-0">
            {hasWarnings ? (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-surface)] px-2 py-1 text-accent-300 ring-1 ring-[var(--accent-line)]">
                <ExclamationTriangleIcon className="size-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-widest">
                  {rollup.openWarnings} {rollup.openWarnings === 1 ? 'Alert' : 'Alerts'}
                </span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1 text-zinc-300 ring-1 ring-white/10">
                <ShieldCheckIcon className="size-3.5 text-accent-400" />
                <span className="text-[10px] font-medium uppercase tracking-widest">Healthy</span>
              </span>
            )}
          </div>
        </div>

        {/* Fleet stats — divider-separated, no nested box, wraps at narrow width */}
        <div className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(90px,1fr))] gap-x-4 gap-y-4 border-t border-white/5 pt-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <CpuChipIcon className="size-5 shrink-0 text-accent-400" />
            <Stat label="Active Fleet">
              {rollup.activeCount}
              <span className="font-normal text-zinc-500"> / {rollup.copilotCount}</span>
            </Stat>
          </div>
          <Stat label="24h Runs">{rollup.runsLast24h.toLocaleString()}</Stat>
          <Stat label="24h Cost">{formatUsd(rollup.costLast24hUsd)}</Stat>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{rollup.copilotCount} copilot{rollup.copilotCount === 1 ? '' : 's'} assigned</span>
          <span className="font-medium text-accent-400">
            Open cockpit &rarr;
          </span>
        </div>
      </div>
    </div>
  )
}
