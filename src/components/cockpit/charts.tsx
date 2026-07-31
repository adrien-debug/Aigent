'use client'

/**
 * L'histogramme d'activité — le graphe central de l'écran.
 *
 * `'use client'` : Recharts mesure le DOM pour son `ResponsiveContainer`. Les
 * données arrivent DÉJÀ dérivées du serveur ; ces composants ne calculent rien,
 * ils dessinent. Toute la logique testable vit dans
 * `src/lib/cockpit/overview-series.ts`.
 *
 * Vérité : une série `null` (fenêtre non lue) ne descend jamais jusqu'ici sous
 * forme de tableau vide. L'appelant rend `<Unavailable/>` à la place — un axe
 * vide et une fenêtre morte ne doivent pas se ressembler.
 *
 * Dessin : segments empilés séparés par un filet de la couleur de la surface
 * (2 px de respiration, sans quoi cinq statuts empilés forment un bloc), sommet
 * arrondi, grille horizontale seule et très en retrait, axes en chiffres
 * monospacés. Les libellés portent l'identité autant que la couleur.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipContentProps } from 'recharts'

import type { HourlyBucket, StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL, RUN_STATUS_ORDER } from '@/lib/cockpit/status'

/**
 * Hauteur plancher d'un segment — pour qu'un run isolé reste visible.
 *
 * Elle vaut IMPÉRATIVEMENT 0 quand le compte est 0 : passer une constante à
 * `minPointSize` faisait dessiner un trait de 2 px sur CHAQUE heure vide, c'est
 * à dire peindre de l'activité là où il n'y en a pas. Une heure sans run est
 * une mesure, et cette mesure vaut zéro pixel.
 */
const floorHeight = (value: number | undefined | null) => (value ? 2 : 0)

const AXIS_TICK = {
  fontSize: 9.5,
  fill: 'var(--text-muted)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

/** Info-bulle : seuls les statuts NON NULS sont listés — un zéro n'apprend rien. */
function RunsTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null
  const bucket = payload[0]?.payload as HourlyBucket | undefined
  if (!bucket) return null

  const present = RUN_STATUS_ORDER.filter((s) => bucket[s] > 0)

  return (
    <div className="elev min-w-[9rem] rounded-lg border border-white/10 bg-overlay/95 px-2.5 py-2 backdrop-blur-sm">
      <div className="flex items-baseline justify-between gap-4 border-b border-white/8 pb-1.5">
        <span className="font-mono text-[11px] text-ink">{bucket.label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-dim">
          {bucket.total} run{bucket.total > 1 ? 's' : ''}
        </span>
      </div>
      {present.length === 0 ? (
        <p className="pt-1.5 text-[10px] text-ink-faint">Aucune exécution sur cette heure.</p>
      ) : (
        <ul className="space-y-0.5 pt-1.5">
          {present.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: RUN_STATUS_COLOR[s] }}
              />
              <span className="flex-1 text-[10.5px] text-ink-dim">{RUN_STATUS_LABEL[s]}</span>
              <span className="font-mono text-[10.5px] tabular-nums text-ink">{bucket[s]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function HourlyRunsChart({ buckets }: { buckets: HourlyBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={buckets} margin={{ top: 8, right: 6, bottom: 0, left: -18 }} barCategoryGap="22%">
        <defs>
          {RUN_STATUS_ORDER.map((s) => (
            <linearGradient key={s} id={`fill-${s}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={RUN_STATUS_COLOR[s]} stopOpacity={1} />
              <stop offset="100%" stopColor={RUN_STATUS_COLOR[s]} stopOpacity={0.55} />
            </linearGradient>
          ))}
        </defs>

        <CartesianGrid vertical={false} stroke="rgb(255 255 255 / 0.06)" strokeDasharray="2 5" />
        <XAxis
          dataKey="label"
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: 'rgb(255 255 255 / 0.1)' }}
          interval={2}
          dy={2}
        />
        {/* L'axe part TOUJOURS de zéro — seul le plafond s'adapte, avec deux
            crans minimum pour qu'une heure à un seul run ne remplisse pas la
            boîte. Tronquer la base, elle, exagérerait les écarts. */}
        <YAxis
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={34}
          domain={[0, (dataMax: number) => Math.max(2, Math.ceil(dataMax * 1.15))]}
        />
        <Tooltip
          cursor={{ fill: 'rgb(0 229 211 / 0.06)' }}
          content={RunsTooltip}
          animationDuration={120}
        />

        {/* Ordre d'empilement = ordre de déclaration. Les échecs en haut, visibles.
            `stroke` de la couleur de surface : c'est lui qui creuse la respiration
            de 2 px entre deux segments collés. */}
        {RUN_STATUS_ORDER.map((s) => (
          <Bar
            key={s}
            dataKey={s}
            stackId="runs"
            name={RUN_STATUS_LABEL[s]}
            fill={`url(#fill-${s})`}
            stroke="var(--surface-raised)"
            strokeWidth={1.5}
            radius={[2, 2, 0, 0]}
            minPointSize={floorHeight}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Légende de l'histogramme — un seul vocabulaire de statut pour tout l'écran. */
export function StatusLegend({ slices }: { slices: StatusSlice[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {slices.map((s) => {
        const empty = s.count === 0
        return (
          <li
            key={s.status}
            className="flex items-center gap-1.5 rounded border border-white/6 bg-elevated px-1.5 py-0.5"
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{
                background: RUN_STATUS_COLOR[s.status],
                opacity: empty ? 0.3 : 1,
              }}
            />
            <span className="text-[10px] tracking-wide text-ink-faint">
              {RUN_STATUS_LABEL[s.status]}
            </span>
            <span
              className={`font-mono text-[10px] tabular-nums ${empty ? 'text-ink-faint' : 'text-ink'}`}
            >
              {s.count}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
