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

import { Badge } from '@/components/ui/badge'
import { Muted } from '@/components/design/type'
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
  fill: 'rgb(161 161 170)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

/** Info-bulle : seuls les statuts NON NULS sont listés — un zéro n'apprend rien. */
function RunsTooltip({ active, payload }: Readonly<TooltipContentProps>) {
  if (!active || !payload?.length) return null
  const bucket = payload[0]?.payload as HourlyBucket | undefined
  if (!bucket) return null

  const present = RUN_STATUS_ORDER.filter((s) => bucket[s] > 0)

  return (
    <div className="min-w-[9rem] border border-line-hi bg-ink-700 px-3 py-2 shadow-lg">
      <div className="flex items-baseline justify-between gap-4 pb-1.5">
        <span className="font-mono text-2xs tracking-[0.12em] text-fg uppercase">
          {bucket.label}
        </span>
        <span className="font-mono text-2xs text-fg-mid tabular-nums">
          {bucket.total} run{bucket.total > 1 ? 's' : ''}
        </span>
      </div>
      <span aria-hidden className="block h-px bg-line" />
      {present.length === 0 ? (
        <Muted className="pt-1.5">Aucune exécution sur cette heure.</Muted>
      ) : (
        <ul className="space-y-0.5 pt-1.5">
          {present.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-1.5 shrink-0"
                style={{ background: RUN_STATUS_COLOR[s] }}
              />
              <span className="flex-1 text-xs text-fg-mid">{RUN_STATUS_LABEL[s]}</span>
              <span className="font-mono text-xs font-semibold text-fg tabular-nums">
                {bucket[s]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function HourlyRunsChart({ buckets }: Readonly<{ buckets: HourlyBucket[] }>) {
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
          cursor={{ fill: 'rgb(161 161 170 / 0.12)' }}
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
            // Le filet entre deux segments empilés prend la couleur de la
            // SURFACE, pas une valeur fixe : c'est lui qui creuse la respiration
            // de 2 px. Sur l'encre, l'ancien `rgb(24 24 27)` dessinait un liseré
            // plus clair que le fond au lieu de le trouer.
            stroke="var(--color-ink-800)"
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

/**
 * Légende de l'histogramme — `Badge` Catalyst officiel, un par statut.
 *
 * La pastille de couleur reste un élément de dataviz (elle relie le libellé à
 * sa barre dans le graphe) : c'est le seul ajout au badge, et Catalyst ne
 * fournit rien d'équivalent.
 */
export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {slices.map((s) => (
        <li key={s.status}>
          <Badge color="zinc">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: RUN_STATUS_COLOR[s.status], opacity: s.count === 0 ? 0.3 : 1 }}
            />
            {RUN_STATUS_LABEL[s.status]}
            <span className="tabular-nums">{s.count}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}
