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
    <div className={clsx(surfaceCardClass, 'group relative flex flex-col transition-all hover:bg-[var(--color-surface-interactive)] hover:border-white/10 hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)]')}>
      
      {/* Top Status Band */}
      <div className={clsx(
        "h-1 w-full",
        hasWarnings ? "bg-accent-500/50" : "bg-accent-500/50"
      )} />

      <div className="p-6 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-black/40 ring-1 ring-white/10 text-xl font-bold text-white uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
              {project.name.slice(0, 2)}
            </div>
            <div className="flex flex-col min-w-0">
              <Link href={href} className="text-lg font-semibold text-white truncate hover:underline before:absolute before:inset-0">
                {project.name}
              </Link>
              <div className="flex items-center gap-2 mt-1">
                <CodeBracketIcon className="size-3.5 text-zinc-500" />
                <span className="text-xs text-zinc-400 font-mono truncate">{project.repoFullName}</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 relative z-10">
            {hasWarnings ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-500/10 text-accent-400 ring-1 ring-accent-500/20">
                <ExclamationTriangleIcon className="size-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-widest">{rollup.openWarnings} Alerts</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-accent-500/10 text-accent-400 ring-1 ring-accent-500/20">
                <ShieldCheckIcon className="size-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-widest">Healthy</span>
              </div>
            )}
          </div>
        </div>

        {/* Fleet Overview */}
        <div className="flex items-center gap-4 p-4 rounded-xl bg-black/20 border border-white/5">
          <div className="flex items-center gap-3 w-1/3 border-r border-white/5">
            <CpuChipIcon className="size-5 text-accent-400" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">{rollup.activeCount} <span className="text-zinc-500 font-normal">/ {rollup.copilotCount}</span></span>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500">Active Fleet</span>
            </div>
          </div>
          <div className="flex flex-col w-1/3 border-r border-white/5 pl-4">
            <span className="text-sm font-mono text-white">{rollup.runsLast24h.toLocaleString()}</span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">24h Runs</span>
          </div>
          <div className="flex flex-col w-1/3 pl-4">
            <span className="text-sm font-mono text-white">{formatUsd(rollup.costLast24hUsd)}</span>
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">24h Cost</span>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75"></span>
              <span className="relative inline-flex size-2 rounded-full bg-accent-500"></span>
            </span>
            <span>Syncing events...</span>
          </div>
          <span className="font-medium text-accent-400 opacity-0 group-hover:opacity-100 transition-opacity">Open Cockpit &rarr;</span>
        </div>
      </div>
    </div>
  )
}
