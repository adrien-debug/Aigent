import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'

import { NotMeasured } from '@/components/cockpit/primitives'
import { Badge } from '@/components/ui/badge'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { ArcGauge, BarMeter, SegmentMeter } from './meters'

const BRONZE_ACTIVE = '#CD7F32'
const BRONZE_URGENT = '#FFB347'
const BRONZE_PASSIVE = '#8B5A2B'

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
  badge,
  glowClass,
  dimmed = false,
}: Readonly<{
  label: string
  value: string | number | null
  unit?: string
  support: string
  graphic?: ReactNode
  badge?: ReactNode
  glowClass?: string
  dimmed?: boolean
}>) {
  return (
    <div className="min-w-0 aig-surface-elevated rounded-xl p-4 flex flex-col justify-between">
      <div className="flex min-h-4 items-center justify-between gap-1.5">
        <p className="text-white/40 truncate text-xs font-light uppercase tracking-wider">
          {label}
        </p>
        {badge}
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
                      ? 'text-white/60 text-[1.4rem] sm:text-[1.5rem] font-medium'
                      : 'text-white text-[1.95rem] sm:text-[2.15rem] font-semibold',
                    glowClass
                  )}
                >
                  {value}
                </span>
                {unit ? <span className="text-white/60 text-sm sm:text-base">{unit}</span> : null}
              </div>
              <p className="text-white/40 mt-1 min-h-4 truncate text-xs uppercase tracking-wider">{support}</p>
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
        badge={
          (kpis.runs24h ?? 0) > 0 ? (
            <div className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium bg-[#CD7F32]/10 text-[#CD7F32] border border-[#CD7F32]/20 pulse-live uppercase tracking-widest">
              Actif
            </div>
          ) : null
        }
      />
      <Figure
        label="Succès 24 h"
        value={unread ? null : kpis.success24h}
        unit={kpis.success24h === null ? undefined : '%'}
        support={kpis.success24h === null ? 'aucun run terminal' : 'sur les runs terminaux'}
        graphic={
          kpis.success24h === null ? undefined : (
            <ArcGauge
              ratio={kpis.success24h / 100}
              color={kpis.success24h >= 90 ? BRONZE_ACTIVE : BRONZE_URGENT}
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
            <BarMeter ratio={coverage} color={partial ? BRONZE_URGENT : BRONZE_ACTIVE} className="w-12 sm:w-14" />
          )
        }
      />
      <Figure
        label="Exécutables"
        value={unread ? null : kpis.executableNow}
        support={
          executableTotal === null ? 'total du catalogue non lu' : `sur ${executableTotal} au catalogue`
        }
        graphic={
          executableTotal === null || kpis.executableNow === null ? undefined : (
            <SegmentMeter filled={kpis.executableNow} total={executableTotal} color={BRONZE_ACTIVE} />
          )
        }
      />
      <Figure
        label="Livraisons"
        value={blocked}
        support="bloquées à débloquer"
        glowClass={blocked !== null && blocked > 0 ? 'aig-glow-bronze-bright' : undefined}
        badge={
          blocked !== null && blocked > 0 ? (
            <div className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium bg-[#FFB347]/10 text-[#FFB347] border border-[#FFB347]/20 uppercase tracking-widest">
              Bloqué
            </div>
          ) : null
        }
      />
      <Figure
        label="Décisions"
        value={kpis.needsAction}
        support="opérateur en attente"
        glowClass={kpis.needsAction > 0 ? 'aig-glow-bronze' : undefined}
        badge={
          kpis.needsAction > 0 ? (
            <div className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium bg-[#CD7F32]/10 text-[#CD7F32] border border-[#CD7F32]/20 uppercase tracking-widest">
              Attente
            </div>
          ) : null
        }
      />
    </>
  )
}
