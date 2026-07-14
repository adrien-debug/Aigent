import clsx from 'clsx'
import { AnimatedNumber } from '@/components/agent-ops/animated-number'

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
/**
 * Colonnes fixes par largeur (directive Adrien 2026-07-11) : la bande s'aligne
 * au pixel d'une page à l'autre. 2 colonnes en tablette, puis 3/4/5 selon le
 * nombre de stats — la grille ne « saute » plus entre pages à même count.
 */
const COLS_CLASS: Record<number, string> = {
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-3 xl:grid-cols-5',
}

export function AgentKpiBand({ stats, className }: { stats: AgentKpiStat[]; className?: string }) {
  // A row (change / viz / hint) only takes space in the band if at least one
  // stat uses it — reserved for every cell so all boxes share the same fixed
  // height, but never reserved for a row nobody in this band needs.
  const hasChange = stats.some((stat) => stat.change)
  const hasViz = stats.some((stat) => stat.viz)
  const hasHint = stats.some((stat) => stat.hint)

  return (
    <div
      className={clsx(
        // Very subtle hairlines (white/5 equivalent). We keep gap-px instead of divide-x
        // because this grid wraps (2 cols on tablet) and divide-x fails on wrapped rows.
        '-mx-4 grid grid-cols-1 gap-px bg-zinc-950/5 sm:grid-cols-2 lg:-mx-8 dark:bg-white/[0.02]',
        COLS_CLASS[stats.length] ?? (stats.length >= 6 ? 'lg:grid-cols-3 xl:grid-cols-6' : 'lg:grid-cols-4'),
        className
      )}
    >
      {/* Every cell renders the same row set, just empty when a stat has no
          value for a row the band uses — so every box is the same fixed
          height, never taller because a neighbor has more data. */}
      {stats.map((stat) => (
        <div
          key={stat.name}
          className="flex flex-col items-start gap-y-2 bg-white px-6 py-6 sm:px-8 xl:px-10 dark:bg-zinc-950 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
        >
          <dt className="text-[11px] font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">{stat.name}</dt>
          {hasChange ? (
            <dd
              className={clsx(
                'h-4 text-xs font-medium tracking-tight tabular-nums',
                stat.changeType === 'negative'
                  ? 'text-accent-600 dark:text-accent-400'
                  : 'text-zinc-600 dark:text-zinc-400'
              )}
            >
              {stat.change ?? ' '}
            </dd>
          ) : null}
          {/* Valeur KPI en accent orange (directive Adrien 2026-07-11) — le chiffre
              est le point focal coloré de la bande ; label et hint restent gris. */}
          <dd className="text-3xl font-semibold tracking-tighter tabular-nums text-accent-600 dark:text-accent-400">
            <AnimatedNumber value={stat.value} />
          </dd>
          {hasViz ? <dd className="mt-3 w-full flex-none">{stat.viz ?? null}</dd> : null}
          {hasHint ? <dd className="h-4 text-[11px] tracking-tight text-zinc-500">{stat.hint ?? ' '}</dd> : null}
        </div>
      ))}
    </div>
  )
}
