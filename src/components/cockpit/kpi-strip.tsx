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
import { ArcGauge, BarMeter, Led, SEVERITY, SegmentMeter, Unavailable } from './primitives'

/*
 * LA PALETTE VIENT DU CANON, ELLE N'EST PLUS REDECLAREE ICI.
 *
 * Ces trois constantes portaient `#059669` / `#d97706` / `#dc2626` — des
 * valeurs PROCHES mais DIFFERENTES de `SEVERITY` (`#0da87f` / `#be850f` /
 * `#e8455f`). Consequence visible et non theorique : la jauge de reussite de ce
 * bandeau rendait un vert, et le rail de severite de la ligne juste en dessous
 * en rendait un autre, sur le meme ecran.
 *
 * C'est exactement la derive que l'en-tete de `status.ts` dit avoir eliminee en
 * reconciliant deux palettes concurrentes — elle etait simplement revenue par
 * un troisieme fichier. Une seule source, donc, et aucune redeclaration locale.
 */
const GOOD = SEVERITY.good
const WARN = SEVERITY.warn
const BAD = SEVERITY.bad

function successRateColor(success24h: number | null): string {
  if (success24h === null || success24h >= 90) return GOOD
  if (success24h >= 60) return WARN
  return BAD
}

function costSupportText(cost: NonNullable<DashboardKpis['cost24h']>, partial: boolean): string {
  if (partial) {
    return `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs mesurés`
  }
  return `${cost.totalRuns} runs mesurés`
}

/**
 * Une cellule du bandeau — en deux RANGS, pas en six exemplaires égaux.
 *
 * POURQUOI DEUX RANGS. Les six mesures avaient exactement le même poids
 * typographique, la même cellule, la même surface. Un opérateur qui arrive sur
 * l'écran n'avait aucun point d'entrée : « Runs 24 h » et « À décider » se
 * disputaient le regard à égalité. Or ces six mesures ne valent pas la même
 * chose — deux répondent à « est-ce que ça tourne et est-ce que ça tient ? »,
 * les quatre autres qualifient.
 *
 *  · `rank="lead"`  — le chiffre porte l'écran : `text-4xl`, blanc métallique.
 *  · `rank="quiet"` — la mesure qualifie : `text-xl`, libellé compact.
 *
 * Le rang est une décision ÉDITORIALE de l'appelant, pas une propriété de la
 * donnée : la même mesure peut mener un écran et en qualifier un autre.
 */
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
  rank?: 'lead' | 'quiet'
}>) {
  const lead = rank === 'lead'

  return (
    <div
      className={clsx(
        'flex min-w-0 flex-col justify-between gap-2',
        // Une menante vaut deux qualifiantes en largeur, à tous les points de
        // rupture : c'est ce qui lui laisse la place d'un chiffre `text-4xl`
        // sans le tronquer, et ce qui rend le rang lisible d'un coup d'œil.
        lead ? 'col-span-2 gap-3 p-5' : 'p-4',
      )}
    >
      <dt className="flex items-center gap-2">
        {led}
        <Text
          className={clsx(
            'truncate',
            lead && 'text-2xs font-medium uppercase tracking-[0.16em]',
          )}
        >
          {label}
        </Text>
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
              {lead ? (
                // Un `<p>` typé à la main plutôt que `Heading` : à `text-4xl`,
                // le composant du kit impose sa propre échelle et son propre
                // poids. On ne le modifie pas (gate d'intégrité) — on ne
                // l'utilise simplement pas ici.
                <p
                  className={clsx(
                    'aig-display truncate text-4xl font-semibold leading-none',
                    valueColor && 'text-(--kpi)',
                  )}
                  style={valueColor ? ({ '--kpi': valueColor } as React.CSSProperties) : undefined}
                >
                  {value}
                </p>
              ) : (
                <Heading
                  level={3}
                  className={clsx('truncate tabular-nums', valueColor && 'text-(--kpi)')}
                  style={valueColor ? ({ '--kpi': valueColor } as React.CSSProperties) : undefined}
                >
                  {value}
                </Heading>
              )}
              {unit ? (
                <Text className={clsx(lead && 'aig-text-muted text-lg')}>{unit}</Text>
              ) : null}
            </div>
            {graphic ? <div className="shrink-0 pb-1">{graphic}</div> : null}
          </div>
        )}
        <Text className={clsx('truncate', lead && 'mt-1.5')}>{support}</Text>
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
    /* LES SÉPARATEURS SONT DES GOUTTIÈRES, PAS DES BORDURES
       -----------------------------------------------------
       `[&>*+*]:border-l` suivait l'ordre DOM, pas la grille : à 2 ou 3
       colonnes, les cellules qui OUVRENT une ligne (3ᵉ et 5ᵉ en mobile)
       portaient un liseré collé au bord gauche de la box, et aucune ligne ne
       séparait les rangées. Six cellules sur trois rangées : le motif était
       faux deux fois sur trois.
       Ici c'est le fond de la `dl` qui transparaît par un `gap` d'1 px : la
       séparation suit la géométrie réelle de la grille à tous les points de
       rupture, verticalement comme horizontalement, et ne peut pas déborder
       puisqu'une gouttière n'existe qu'ENTRE deux cellules. Les cellules
       reprennent le noir de la box ; `overflow-hidden` + le rayon de la `dl`
       recoupent les angles. */
    /* DEUX MENANTES, QUATRE QUALIFIANTES — la grille suit l'éditorial.
       Les deux premières cellules occupent chacune deux colonnes sur les six
       de la rangée `xl` et portent leur chiffre en `text-4xl` ; les quatre
       autres se rangent par deux dans les deux colonnes restantes. En dessous
       de `xl` la grille dégrade proprement : 2 colonnes en mobile, 3 en `sm`,
       les menantes gardant leur double largeur. */
    <dl className="aig-panel grid shrink-0 grid-cols-2 gap-px overflow-hidden bg-[var(--aig-line-soft)] sm:grid-cols-4 xl:grid-cols-8 [&>*]:bg-[var(--aig-base)]">
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
          executableTotal === null
            ? 'total du catalogue non lu'
            : `sur ${executableTotal} au catalogue`
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
