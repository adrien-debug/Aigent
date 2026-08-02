import type { ReactNode } from 'react'

import { NotMeasured } from '@/components/cockpit/primitives'
import { Text } from '@/components/ui/text'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { SEVERITY } from '@/lib/cockpit/status'
import { ArcGauge, BarMeter, Led, SegmentMeter } from './meters'

const GOOD = SEVERITY.good
const WARN = SEVERITY.warn
const BAD = SEVERITY.bad

function successRateColor(success24h: number | null): string {
  if (success24h === null || success24h >= 90) return GOOD
  if (success24h >= 60) return WARN
  return BAD
}

function costSupportText(cost: NonNullable<DashboardKpis['cost24h']>, partial: boolean): string {
  if (partial) return `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs`
  return `${cost.totalRuns} runs mesurés`
}

function LeadFigure({
  label,
  value,
  unit,
  support,
  graphic,
  led,
  valueColor,
  unread,
}: Readonly<{
  label: string
  value: string | number | null
  unit?: string
  support: string
  graphic?: ReactNode
  led?: ReactNode
  valueColor?: string
  unread: boolean
}>) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        {led}
        <Text className="aig-text-faint truncate text-2xs font-medium uppercase tracking-[0.14em]">
          {label}
        </Text>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {value === null ? (
            <NotMeasured
              why={unread ? 'La fenêtre de runs n’a pas pu être lue.' : 'Aucune mesure sur la fenêtre.'}
              label={unread ? undefined : 'aucune mesure'}
            />
          ) : (
            <div className="flex items-baseline gap-1">
              <span
                className="aig-display text-3xl font-semibold tabular-nums sm:text-4xl"
                style={valueColor ? { color: valueColor } : undefined}
              >
                {value}
              </span>
              {unit ? <span className="aig-text-muted text-lg">{unit}</span> : null}
            </div>
          )}
          <Text className="aig-text-faint mt-1 truncate text-xs">{support}</Text>
        </div>
        {graphic ? <div className="shrink-0 pb-0.5">{graphic}</div> : null}
      </div>
    </div>
  )
}

function QuietFigure({
  label,
  value,
  support,
  graphic,
  led,
  valueColor,
}: Readonly<{
  label: string
  value: string | number | null
  support: string
  graphic?: ReactNode
  led?: ReactNode
  valueColor?: string
}>) {
  return (
    <div className="min-w-0 flex-1 sm:min-w-28 sm:flex-none">
      <div className="flex items-center gap-1.5">
        {led}
        <Text className="aig-text-faint truncate text-3xs uppercase tracking-[0.12em]">{label}</Text>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span
          className="aig-display text-xl font-semibold tabular-nums"
          style={valueColor ? { color: valueColor } : undefined}
        >
          {value ?? '—'}
        </span>
        {graphic ? <div className="shrink-0">{graphic}</div> : null}
      </div>
      <Text className="aig-text-faint mt-0.5 truncate text-3xs">{support}</Text>
    </div>
  )
}

export default function KpiStrip({
  kpis,
  unread,
}: Readonly<{ kpis: DashboardKpis; unread: boolean }>) {
  const successColor = successRateColor(kpis.success24h)
  const cost = kpis.cost24h
  const coverage = cost?.totalRuns && cost.totalRuns > 0 ? cost.measuredRuns / cost.totalRuns : 0
  const partial = cost !== null && cost.measuredRuns < cost.totalRuns
  const blocked = kpis.blockedDeliveries
  const executableTotal = kpis.executableTotal

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <LeadFigure
          label="Runs 24 h"
          value={unread ? null : kpis.runs24h}
          support={unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre'}
          unread={unread}
          led={<Led color={GOOD} live={(kpis.runs24h ?? 0) > 0} />}
        />
        <LeadFigure
          label="Succès 24 h"
          value={unread ? null : kpis.success24h}
          unit={kpis.success24h === null ? undefined : '%'}
          support={kpis.success24h === null ? 'aucun run terminal' : 'sur les runs terminaux'}
          valueColor={kpis.success24h === null ? undefined : successColor}
          unread={unread}
          graphic={
            kpis.success24h === null ? undefined : (
              <ArcGauge
                ratio={kpis.success24h / 100}
                color={successColor}
                size={48}
                label={`${kpis.success24h} % de succès`}
              />
            )
          }
        />
        <LeadFigure
          label="Coût 24 h"
          value={unread || cost === null ? null : formatUsd(cost.usd)}
          support={cost === null ? 'aucun coût mesurable' : costSupportText(cost, partial)}
          unread={unread}
          graphic={
            cost === null ? undefined : (
              <BarMeter ratio={coverage} color={partial ? WARN : GOOD} className="w-14" />
            )
          }
        />
        <LeadFigure
          label="Exécutables"
          value={unread ? null : kpis.executableNow}
          support={
            executableTotal === null ? 'total du catalogue non lu' : `sur ${executableTotal} au catalogue`
          }
          valueColor={kpis.executableNow === 0 ? WARN : undefined}
          unread={unread}
          graphic={
            executableTotal === null || kpis.executableNow === null ? undefined : (
              <SegmentMeter filled={kpis.executableNow} total={executableTotal} color={GOOD} />
            )
          }
        />
      </div>

      <div className="aig-hairline" />

      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <QuietFigure
          label="Bloquées"
          value={blocked}
          support="livraisons à débloquer"
          valueColor={blocked !== null && blocked > 0 ? BAD : undefined}
          led={<Led color={blocked !== null && blocked > 0 ? BAD : SEVERITY.muted} />}
        />
        <QuietFigure
          label="À décider"
          value={kpis.needsAction}
          support="décisions en attente"
          valueColor={kpis.needsAction > 0 ? WARN : undefined}
          led={<Led color={kpis.needsAction > 0 ? WARN : SEVERITY.muted} />}
        />
      </div>
    </div>
  )
}
