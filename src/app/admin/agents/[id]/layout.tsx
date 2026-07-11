import { ChevronLeftIcon } from '@heroicons/react/16/solid'
import { notFound } from 'next/navigation'
import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { CopilotTabs } from '@/components/agent-ops/copilot-tabs'
import { Subheading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { getCopilot } from '@/lib/agent-mission-control/data'

export default async function CopilotLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const { health } = copilot
  const untested = health.testPassRate === 0
  const noRuns = health.runsLast24h === 0

  return (
    <div>
      {/* Ligne d'orientation compacte — back-link + nom du copilot. Breadcrumb discret,
          la doctrine reste KPI-first : une seule ligne, pas de gros header. */}
      <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
        <Link
          href="/admin/agents"
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
          Copilots
        </Link>
        <span aria-hidden="true" className="text-zinc-500">
          /
        </span>
        <Subheading className="truncate">{copilot.name}</Subheading>
      </nav>

      {/* KPI au-dessus des menus ; marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-4"
        stats={[
          {
            name: 'Test pass rate',
            value: untested ? '—' : formatPercent(health.testPassRate),
            hint: untested ? 'Not tested' : undefined,
          },
          {
            name: 'Benchmark score',
            value: health.benchmarkScore === 0 ? '—' : String(health.benchmarkScore),
            hint: health.benchmarkScore === 0 ? 'Never benchmarked' : 'Best composite, out of 100',
          },
          {
            name: 'Runs (24h)',
            value: String(health.runsLast24h),
            hint: noRuns ? undefined : `${formatPercent(health.errorRateLast24h)} error rate`,
          },
          {
            name: 'Cost (24h)',
            value: noRuns ? '—' : formatUsd(health.costLast24hUsd),
            hint: noRuns
              ? 'No runs'
              : `≈ ${formatUsd(health.costLast24hUsd / health.runsLast24h)} per run`,
          },
        ]}
      />

      {/* Menus sous les KPI */}
      <div className="mt-0">
        <CopilotTabs copilotId={id} />
      </div>

      <div className="mt-6 lg:mt-8">{children}</div>
    </div>
  )
}
