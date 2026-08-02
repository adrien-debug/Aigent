import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'

import { NotMeasured } from '@/components/cockpit/primitives'
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

function Figure({
  label,
  value,
  unit,
  support,
  graphic,
  led,
  valueColor,
  glowClass,
  dimmed = false,
}: Readonly<{
  label: string
  value: string | number | null
  unit?: string
  support: string
  graphic?: ReactNode
  led?: ReactNode
  valueColor?: string
  glowClass?: string
  dimmed?: boolean
}>) {
  return (
    <div className="min-w-0 aig-surface-elevated rounded-xl p-4 flex flex-col justify-between">
      <div className="flex min-h-4 items-center gap-1.5">
        {led}
        <p className="aig-text-faint truncate text-xs font-medium uppercase tracking-wider">
          {label}
        </p>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          {value === null ? (
            <NotMeasured
              why={support}
              label="—"
            />
          ) : (
            <>
              <div className="flex items-baseline gap-1">
                <span
                  className={clsx(
                    dimmed
                      ? 'aig-kpi-quiet aig-text-faint text-[1.4rem] sm:text-[1.5rem]'
                      : 'aig-kpi-lead text-[1.95rem] sm:text-[2.15rem]',
                    valueColor && 'text-(--kpi)',
                    glowClass
                  )}
                  style={valueColor ? ({ '--kpi': valueColor } as CSSProperties) : undefined}
                >
                  {value}
                </span>
                {unit ? <span className="aig-text-muted text-sm sm:text-base">{unit}</span> : null}
              </div>
              <p className="aig-text-faint mt-1 min-h-4 truncate text-xs uppercase tracking-wider">{support}</p>
            </>
          )}
        </div>
        {graphic ? <div className="shrink-0 pb-0.5">{graphic}</div> : null}
      </div>
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
  const windowEmpty = !unread && kpis.runs24h === 0

  return (
    <>
      <Figure
        label="Runs 24 h"
        value={unread ? null : kpis.runs24h}
        support={unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre'}
        dimmed={windowEmpty && (kpis.runs24h ?? 0) === 0}
        led={(kpis.runs24h ?? 0) > 0 ? <Led color={GOOD} live /> : null}
      />
      <Figure
        label="Succès 24 h"
        value={unread ? null : kpis.success24h}
        unit={kpis.success24h === null ? undefined : '%'}
        support={kpis.success24h === null ? 'aucun run terminal' : 'sur les runs terminaux'}
        valueColor={kpis.success24h === null ? undefined : successColor}
        graphic={
          kpis.success24h === null ? undefined : (
            <ArcGauge
              ratio={kpis.success24h / 100}
              color={successColor}
              size={44}
              label={`${kpis.success24h} % de succès`}
            />
          )
        }
      />
      <Figure
        label="Coût 24 h"
        value={unread || cost === null ? null : formatUsd(cost.usd)}
        support={cost === null ? 'aucun coût mesurable' : costSupportText(cost, partial)}
        graphic={
          cost === null ? undefined : (
            <BarMeter ratio={coverage} color={partial ? WARN : GOOD} className="w-12 sm:w-14" />
          )
        }
      />
      <Figure
        label="Exécutables"
        value={unread ? null : kpis.executableNow}
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
      <Figure
        label="Livraisons"
        value={blocked}
        support="bloquées à débloquer"
        valueColor={blocked !== null && blocked > 0 ? BAD : undefined}
        glowClass={blocked !== null && blocked > 0 ? 'aig-glow-bad' : undefined}
      />
      <Figure
        label="Décisions"
        value={kpis.needsAction}
        support="opérateur en attente"
        valueColor={kpis.needsAction > 0 ? WARN : undefined}
        glowClass={kpis.needsAction > 0 ? 'aig-glow-warn' : undefined}
      />
    </>
  )
}
