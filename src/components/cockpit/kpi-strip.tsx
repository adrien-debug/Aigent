/**
 * Bandeau d'instruments — six mesures sur UNE surface continue, pas six boîtes.
 *
 * La version précédente alignait six rectangles identiques : même fond, même
 * cadre, même taille de chiffre. Six objets de même poids ne hiérarchisent
 * rien. Ici la surface est unique, les cellules sont séparées par des filets, et
 * une seule mesure — les runs de la fenêtre — porte l'accent : c'est le pouls de
 * la flotte, tout le reste le qualifie.
 *
 * Trois cellules portent un objet graphique, et chacun encode une proportion
 * RÉELLE et bornée : combien d'agents sont exécutables sur le catalogue, quelle
 * part des runs terminaux a réussi, quelle part du coût a pu être mesurée. Aucun
 * mini-graphique de série temporelle : l'histogramme est en dessous, en grand.
 *
 * `value === null` bascule la cellule en « indisponible » — jamais un 0
 * rassurant sur une mesure qui n'existe pas.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Text } from '@/components/ui/text'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { ArcGauge, BarMeter, Led, SegmentMeter, Unavailable } from './primitives'

const GOOD = '#0da87f'
const WARN = '#be850f'
const BAD = '#e8455f'

function Cell({
  label,
  value,
  unit,
  support,
  graphic,
  led,
  hero = false,
  valueColor,
  unavailableReason,
}: {
  label: string
  /** `null` = non mesuré. La cellule le DIT au lieu d'afficher un chiffre. */
  value: string | number | null
  unit?: string
  support: string
  /** Objet de proportion, à droite du chiffre. Jamais une série temporelle. */
  graphic?: ReactNode
  /** Témoin de sévérité, à GAUCHE du libellé — un point posé à côté d'un
   *  chiffre se lit comme une poussière, à côté d'un libellé comme un état. */
  led?: ReactNode
  hero?: boolean
  valueColor?: string
  unavailableReason?: 'unread' | 'no-data'
}) {
  return (
    <div
      className={clsx(
        'relative flex min-w-0 flex-col justify-between gap-1.5 px-4 py-3',
        hero && 'bg-white/[0.015]',
      )}
    >
      {hero ? (
        <span
          aria-hidden
          className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-accent"
        />
      ) : null}

      <dt className="flex items-center gap-1.5">
        {led}
        <span className="truncate text-[9.5px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
          {label}
        </span>
      </dt>

      <dd>
        {value === null ? (
          <div className="h-9 w-fit">
            <Unavailable reason={unavailableReason ?? 'unread'} compact />
          </div>
        ) : (
          <div className="flex items-end justify-between gap-3">
            <p className="flex min-w-0 items-baseline gap-1">
              <span
                className={clsx(
                  'truncate font-mono font-semibold tracking-tight tabular-nums',
                  hero ? 'text-[34px] leading-8' : 'text-[26px] leading-7',
                )}
                style={valueColor ? { color: valueColor } : undefined}
              >
                {value}
              </span>
              {unit ? <span className="text-[11px] text-ink-faint">{unit}</span> : null}
            </p>
            {graphic ? <div className="shrink-0 pb-0.5">{graphic}</div> : null}
          </div>
        )}
        <Text className="truncate leading-tight">{support}</Text>
      </dd>
    </div>
  )
}

export default function KpiStrip({
  kpis,
  unread,
}: {
  kpis: DashboardKpis
  /** La fenêtre de runs n'a pas pu être lue — distingue « absent » de « vide ». */
  unread: boolean
}) {
  const reason = unread ? 'unread' : 'no-data'

  const successColor =
    kpis.success24h === null ? GOOD : kpis.success24h >= 90 ? GOOD : kpis.success24h >= 60 ? WARN : BAD

  const cost = kpis.cost24h
  const coverage = cost && cost.totalRuns > 0 ? cost.measuredRuns / cost.totalRuns : 0
  const partial = cost !== null && cost.measuredRuns < cost.totalRuns

  const blocked = kpis.blockedDeliveries
  const executableTotal = kpis.executableTotal

  return (
    <dl className="lip elev relative grid shrink-0 grid-cols-2 overflow-hidden rounded-xl border border-white/6 bg-raised sm:grid-cols-3 xl:grid-cols-6 [&>*+*]:border-l [&>*+*]:border-white/5 [&>*]:min-h-[92px]">
      <Cell
        hero
        label="Runs 24 h"
        value={kpis.runs24h}
        support={unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre'}
        valueColor="var(--accent-main)"
        unavailableReason={reason}
        led={<Led color="var(--accent-main)" live={(kpis.runs24h ?? 0) > 0} />}
      />

      <Cell
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
              label={`${kpis.success24h} % de succès`}
            />
          )
        }
      />

      <Cell
        label="Coût 24 h"
        value={cost === null ? null : formatUsd(cost.usd)}
        support={
          cost === null
            ? 'aucun coût mesurable'
            : partial
              ? `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs mesurés`
              : `${cost.totalRuns} runs mesurés`
        }
        unavailableReason={reason}
        graphic={
          cost === null ? undefined : (
            <BarMeter ratio={coverage} color={partial ? WARN : 'var(--accent-soft)'} className="w-16" />
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
            <SegmentMeter
              filled={kpis.executableNow}
              total={executableTotal}
              color="var(--accent-main)"
            />
          )
        }
      />

      <Cell
        label="Bloquées"
        value={blocked}
        support="livraisons à débloquer"
        valueColor={blocked !== null && blocked > 0 ? BAD : undefined}
        led={<Led color={blocked !== null && blocked > 0 ? BAD : '#3a4048'} />}
      />

      <Cell
        label="À décider"
        value={kpis.needsAction}
        support="décisions en attente"
        valueColor={kpis.needsAction > 0 ? WARN : undefined}
        graphic={<Led color={kpis.needsAction > 0 ? WARN : '#3a4048'} className="mb-3 size-2" />}
      />
    </dl>
  )
}
