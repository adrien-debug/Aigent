import clsx from 'clsx'

export interface AgentKpiStat {
  name: string
  value: string
  change?: string
  changeType?: 'positive' | 'negative'
  hint?: string
  /** Optional inline visualization (meter/gauge/bar) rendered under the value. */
  viz?: React.ReactNode
}

/**
 * KPI band — Tailwind Plus dark stats pattern (directive Adrien 2026-07-10) :
 * bande full-bleed du menu au bord droit du navigateur, cellules noires
 * séparées par des hairlines (`gap-px bg-white/10`). Toujours posée au même
 * endroit : PREMIER élément de la page, sous la navigation. Le `-mx-4 lg:-mx-6`
 * annule le padding du shell pour aller bord à bord.
 */
export function AgentKpiBand({ stats, className }: { stats: AgentKpiStat[]; className?: string }) {
  return (
    <dl
      className={clsx(
        '-mx-4 grid grid-cols-1 gap-px bg-zinc-950/10 sm:grid-cols-2 lg:-mx-6 dark:bg-white/10',
        stats.length >= 6
          ? 'lg:grid-cols-3 xl:grid-cols-6'
          : stats.length === 5
            ? 'lg:grid-cols-5'
            : stats.length === 4
              ? 'lg:grid-cols-4'
              : 'lg:grid-cols-3',
        className
      )}
    >
      {stats.map((stat) => (
        <div
          key={stat.name}
          className="flex flex-col items-center gap-y-1 bg-white px-4 py-5 text-center sm:px-6 xl:px-8 dark:bg-zinc-950"
        >
          <dt className="text-sm/6 font-medium text-zinc-500 dark:text-zinc-400">{stat.name}</dt>
          {stat.change ? (
            <dd
              className={clsx(
                stat.changeType === 'negative'
                  ? 'text-accent-600 dark:text-accent-400'
                  : 'text-zinc-600 dark:text-zinc-300',
                'text-xs font-medium'
              )}
            >
              {stat.change}
            </dd>
          ) : null}
          <dd className="text-2xl/8 font-medium tracking-tight text-zinc-950 dark:text-white">
            {stat.value}
          </dd>
          {stat.viz ? <dd className="mt-3 w-full flex-none">{stat.viz}</dd> : null}
          {stat.hint ? <dd className="text-xs text-zinc-500">{stat.hint}</dd> : null}
        </div>
      ))}
    </dl>
  )
}
