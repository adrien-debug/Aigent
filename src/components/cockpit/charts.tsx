'use client'

/**
 * Graphiques du cockpit (Recharts).
 *
 * `'use client'` : Recharts mesure le DOM pour son `ResponsiveContainer`.
 * Les données arrivent DÉJÀ dérivées du serveur — ces composants ne calculent
 * rien, ils dessinent. Toute la logique testable vit dans
 * `src/lib/cockpit/overview-series.ts`.
 *
 * Vérité : une série `null` (fenêtre non lue) ne descend jamais jusqu'ici sous
 * forme de tableau vide. L'appelant rend `<Unavailable/>` à la place — un axe
 * vide et une fenêtre morte ne doivent pas se ressembler.
 */
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { HourlyBucket, StatusSlice } from '@/lib/cockpit/overview-series'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/** Une couleur par statut, stable entre l'histogramme et le donut. */
export const STATUS_COLOR: Record<AgentRunStatus, string> = {
  completed: '#34d399',
  running: '#60a5fa',
  'needs-confirmation': '#fbbf24',
  blocked: '#a78bfa',
  failed: '#fb7185',
}

export const STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Terminés',
  running: 'En cours',
  'needs-confirmation': 'À confirmer',
  blocked: 'Bloqués',
  failed: 'Échoués',
}

const AXIS = { fontSize: 10, fill: '#6b7280' } as const

const tooltipStyle = {
  contentStyle: {
    background: '#0b0f17',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: '#e5e7eb', fontSize: 11 },
  itemStyle: { color: '#e5e7eb', fontSize: 11 },
} as const

/** Histogramme empilé des runs par heure — le graphe central de l'écran. */
export function HourlyRunsChart({ buckets }: { buckets: HourlyBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: -22 }} barCategoryGap="18%">
        <XAxis
          dataKey="label"
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
          interval={3}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={38} />
        <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} {...tooltipStyle} />
        {/* Ordre d'empilement = ordre de déclaration. Les échecs en haut, visibles. */}
        <Bar dataKey="completed" stackId="s" fill={STATUS_COLOR.completed} name={STATUS_LABEL.completed} />
        <Bar dataKey="running" stackId="s" fill={STATUS_COLOR.running} name={STATUS_LABEL.running} />
        <Bar
          dataKey="needs-confirmation"
          stackId="s"
          fill={STATUS_COLOR['needs-confirmation']}
          name={STATUS_LABEL['needs-confirmation']}
        />
        <Bar dataKey="blocked" stackId="s" fill={STATUS_COLOR.blocked} name={STATUS_LABEL.blocked} />
        <Bar
          dataKey="failed"
          stackId="s"
          fill={STATUS_COLOR.failed}
          name={STATUS_LABEL.failed}
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Donut de répartition par statut, sur la même fenêtre que l'histogramme. */
export function StatusDonut({ slices }: { slices: StatusSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.count, 0)
  const data = slices.map((s) => ({ ...s, label: STATUS_LABEL[s.status] }))

  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="label"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={total === 0 ? 0 : 2}
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((s) => (
              <Cell key={s.status} fill={total === 0 ? 'rgba(255,255,255,0.07)' : STATUS_COLOR[s.status]} />
            ))}
          </Pie>
          {total > 0 ? <Tooltip {...tooltipStyle} /> : null}
        </PieChart>
      </ResponsiveContainer>
      {/* Centre du donut : le total, mesuré — 0 est ici une vraie mesure. */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl leading-none font-semibold tabular-nums text-white">{total}</span>
        <span className="mt-0.5 text-[10px] tracking-wide text-gray-500 uppercase">runs 24 h</span>
      </div>
    </div>
  )
}

/** Légende partagée par l'histogramme et le donut — une seule grammaire. */
export function StatusLegend({ slices }: { slices: StatusSlice[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {slices.map((s) => (
        <li key={s.status} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: STATUS_COLOR[s.status] }}
          />
          <span className="text-[11px] text-gray-400">{STATUS_LABEL[s.status]}</span>
          <span className="text-[11px] font-semibold tabular-nums text-gray-300">{s.count}</span>
        </li>
      ))}
    </ul>
  )
}
