import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Unavailable } from '@/components/cockpit/primitives'
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
  if (partial) return `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs mesurés`
  return `${cost.totalRuns} runs mesurés`
}

function Cell({
  label,
  value,
  unit,
  support,
  graphic,
  led,
  valueColor,
  unavailableReason,
  rank = 'quiet',
}: Readonly<{
  label: string
  value: string | number | null
  unit?: string
  support: string
  graphic?: ReactNode
  led?: ReactNode
  valueColor?: string
  unavailableReason?: 'unread' | 'no-data'
  rank?: 'lead' | 'quiet'
}>) {
  const lead = rank === 'lead'

  return (
    <div className={clsx('flex min-w-0 flex-col justify-between gap-2', lead && 'col-span-2 gap-3')}>
      <dt className="flex items-center gap-2">
        {led}
        <span
          className={clsx(
            'aig-text-faint truncate',
            lead && 'text-2xs font-medium uppercase tracking-[0.16em]',
          )}
        >
          {label}
        </span>
      </dt>

      <dd className="min-w-0">
        {value === null ? (
          <div className="w-fit">
            <Unavailable reason={unavailableReason ?? 'unread'} compact />
          </div>
        ) : (
          <div className="flex items-end justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <p
                className={clsx(
                  'aig-display truncate tabular-nums font-semibold leading-none',
                  lead ? 'text-4xl' : 'text-xl',
                  valueColor && 'text-(--kpi)',
                )}
                style={valueColor ? ({ '--kpi': valueColor } as React.CSSProperties) : undefined}
              >
                {value}
              </p>
              {unit ? (
                <span className={clsx('aig-text-muted', lead && 'text-lg')}>{unit}</span>
              ) : null}
            </div>
            {graphic ? <div className="shrink-0 pb-1">{graphic}</div> : null}
          </div>
        )}
        <p className={clsx('aig-text-muted truncate text-xs', lead && 'mt-1.5')}>{support}</p>
      </dd>
    </div>
  )
}

export default function KpiStrip({
  kpis,
  unread,
}: Readonly<{ kpis: DashboardKpis; unread: boolean }>) {
  const reason = unread ? 'unread' : 'no-data'
  const successColor = successRateColor(kpis.success24h)
  const cost = kpis.cost24h
  const coverage = cost?.totalRuns && cost.totalRuns > 0 ? cost.measuredRuns / cost.totalRuns : 0
  const partial = cost !== null && cost.measuredRuns < cost.totalRuns
  const blocked = kpis.blockedDeliveries
  const executableTotal = kpis.executableTotal

  return (
    <dl className="grid shrink-0 grid-cols-2 gap-x-5 gap-y-4 sm:grid-cols-4 xl:grid-cols-8">
      <Cell
        rank="lead"
        label="Runs 24 h"
        value={kpis.runs24h}
        support={unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre'}
        unavailableReason={reason}
        led={<Led color={GOOD} live={(kpis.runs24h ?? 0) > 0} />}
      />
      <Cell
        rank="lead"
        label="Succès 24 h"
        value={kpis.success24h}
        unit="%"
        support={kpis.success24h === null ? 'aucun run terminal' : 'sur les runs terminaux'}
        valueColor={successColor}
        unavailableReason={reason}
        graphic={
          kpis.success24h === null ? undefined : (
            <ArcGauge
              ratio={kpis.success24h / 100}
              color={successColor}
              size={52}
              label={`${kpis.success24h} % de succès`}
            />
          )
        }
      />
      <Cell
        label="Coût 24 h"
        value={cost === null ? null : formatUsd(cost.usd)}
        support={cost === null ? 'aucun coût mesurable' : costSupportText(cost, partial)}
        unavailableReason={reason}
        graphic={
          cost === null ? undefined : (
            <BarMeter ratio={coverage} color={partial ? WARN : GOOD} className="w-16" />
          )
        }
      />
      <Cell
        label="Exécutables"
        value={kpis.executableNow}
        support={
          executableTotal === null ? 'total du catalogue non lu' : `sur ${executableTotal} au catalogue`
        }
        valueColor={kpis.executableNow === 0 ? WARN : undefined}
        graphic={
          executableTotal === null || kpis.executableNow === null ? undefined : (
            <SegmentMeter filled={kpis.executableNow} total={executableTotal} color={GOOD} />
          )
        }
      />
      <Cell
        label="Bloquées"
        value={blocked}
        support="livraisons à débloquer"
        valueColor={blocked !== null && blocked > 0 ? BAD : undefined}
        led={<Led color={blocked !== null && blocked > 0 ? BAD : SEVERITY.muted} />}
      />
      <Cell
        label="À décider"
        value={kpis.needsAction}
        support="décisions en attente"
        valueColor={kpis.needsAction > 0 ? WARN : undefined}
        led={<Led color={kpis.needsAction > 0 ? WARN : SEVERITY.muted} />}
      />
    </dl>
  )
}
