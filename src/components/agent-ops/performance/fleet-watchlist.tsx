import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import { formatPercent } from '@/lib/agent-mission-control/format'
import type { Copilot } from '@/lib/agent-mission-control/types'

function WatchRow({ copilot, value }: { copilot: Copilot; value: string }) {
  return (
    <li>
      <Link
        href={`/admin/agents/${copilot.id}`}
        className="flex min-h-11 items-center gap-2.5 px-4 py-2 text-sm hover:bg-[var(--color-surface-focus)]"
      >
        <CopilotAvatar copilot={copilot} className="size-7 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1 truncate font-medium text-white">{copilot.name}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">{value}</span>
      </Link>
    </li>
  )
}

export function FleetWatchlist({ copilots }: { copilots: Copilot[] }) {
  const lowestPassRates = copilots
    .filter((copilot) => copilot.healthEvidence === 'runs')
    .sort((a, b) => a.health.testPassRate - b.health.testPassRate || a.name.localeCompare(b.name))
    .slice(0, 4)

  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Fleet Watchlist" className="px-4 pt-3 pb-2" />
      <div className="pb-2">
        <h3 className="px-4 py-2 text-[10px] font-medium uppercase tracking-widest text-zinc-400">
          Lowest Pass Rate
        </h3>
        {lowestPassRates.length > 0 ? (
          <ul className="divide-y divide-white/5">
            {lowestPassRates.map((copilot) => (
              <WatchRow
                key={copilot.id}
                copilot={copilot}
                value={formatPercent(copilot.health.testPassRate)}
              />
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-2 text-xs text-zinc-500">No run-backed evidence.</p>
        )}
      </div>
    </SurfaceCard>
  )
}
