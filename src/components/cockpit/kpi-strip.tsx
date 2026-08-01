/**
 * Bandeau d'instruments — six mesures sur une surface continue.
 *
 * Composé en Catalyst officiel (`Heading` pour la valeur, `Text` pour le
 * libellé et le support, sémantique `dl`/`dt`/`dd`). Les seuls objets hors kit
 * sont les jauges de proportion (`ArcGauge`, `BarMeter`, `SegmentMeter`) et la
 * diode `Led` — Catalyst ne fournit aucune visualisation de ce type.
 *
 * Chaque objet graphique encode une proportion RÉELLE et bornée : combien
 * d'agents sont exécutables sur le catalogue, quelle part des runs terminaux a
 * réussi, quelle part du coût a pu être mesurée. Aucun mini-graphique de série
 * temporelle : l'histogramme est en dessous, en grand.
 *
 * `value === null` bascule la cellule en « indisponible » — jamais un 0
 * rassurant sur une mesure qui n'existe pas.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { ArcGauge, BarMeter, Led, SegmentMeter, Unavailable } from './primitives'

const GOOD = '#059669'
const WARN = '#d97706'
const BAD = '#dc2626'

function successRateColor(success24h: number | null): string {
  if (success24h === null || success24h >= 90) return GOOD
  if (success24h >= 60) return WARN
  return BAD
}

function costSupportText(
  cost: NonNullable<DashboardKpis['cost24h']>,
  partial: boolean,
): string {
  if (partial) {
    return `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs mesurés`
  }
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
}: Readonly<{
  label: string
  /** `null` = non mesuré. La cellule le DIT au lieu d'afficher un chiffre. */
  value: string | number | null
  unit?: string
  support: string
  /** Objet de proportion, à droite du chiffre. Jamais une série temporelle. */
  graphic?: ReactNode
  /** Témoin de sévérité, à GAUCHE du libellé. */
  led?: ReactNode
  valueColor?: string
  unavailableReason?: 'unread' | 'no-data'
}>) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 p-4">
      <dt className="flex items-center gap-2">
        {led}
        <Text className="truncate">{label}</Text>
      </dt>

      <dd className="min-w-0">
        {value === null ? (
          <div className="w-fit">
            <Unavailable reason={unavailableReason ?? 'unread'} compact />
          </div>
        ) : (
          <div className="flex items-end justify-between gap-3">
            {/* `div` et non `p` : `Heading` rend un `<h3>` et `Text` un `<p>`,
                or un `<p>` ne peut contenir ni l'un ni l'autre — HTML invalide
                et erreur d'hydratation React. */}
            <div className="flex min-w-0 items-baseline gap-1.5">
              <Heading
                level={3}
                className={clsx('truncate tabular-nums', valueColor && 'text-(--kpi)')}
                style={valueColor ? ({ '--kpi': valueColor } as React.CSSProperties) : undefined}
              >
                {value}
              </Heading>
              {unit ? <Text>{unit}</Text> : null}
            </div>
            {graphic ? <div className="shrink-0 pb-1">{graphic}</div> : null}
          </div>
        )}
        <Text className="truncate">{support}</Text>
      </dd>
    </div>
  )
}

export default function KpiStrip({
  kpis,
  unread,
}: Readonly<{
  kpis: DashboardKpis
  /** La fenêtre de runs n'a pas pu être lue — distingue « absent » de « vide ». */
  unread: boolean
}>) {
  const reason = unread ? 'unread' : 'no-data'

  const successColor = successRateColor(kpis.success24h)

  const cost = kpis.cost24h
  const coverage = cost?.totalRuns && cost.totalRuns > 0 ? cost.measuredRuns / cost.totalRuns : 0
  const partial = cost !== null && cost.measuredRuns < cost.totalRuns

  const blocked = kpis.blockedDeliveries
  const executableTotal = kpis.executableTotal

  return (
    <dl className="dark grid shrink-0 grid-cols-2 overflow-hidden rounded-lg bg-black shadow-xs ring-1 ring-white/10 sm:grid-cols-3 xl:grid-cols-6 [&>*+*]:border-l [&>*+*]:border-white/10">
      <Cell
        label="Runs 24 h"
        value={kpis.runs24h}
        support={unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre'}
        unavailableReason={reason}
        led={<Led color={GOOD} live={(kpis.runs24h ?? 0) > 0} />}
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
        led={<Led color={blocked !== null && blocked > 0 ? BAD : 'rgb(161 161 170 / 0.5)'} />}
      />

      <Cell
        label="À décider"
        value={kpis.needsAction}
        support="décisions en attente"
        valueColor={kpis.needsAction > 0 ? WARN : undefined}
        led={<Led color={kpis.needsAction > 0 ? WARN : 'rgb(161 161 170 / 0.5)'} />}
      />
    </dl>
  )
}
