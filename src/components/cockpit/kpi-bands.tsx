/**
 * Les mesures de l'Aperçu, en DEUX RANGS DE PRIORITÉ.
 *
 * CE QUI CHANGE PAR RAPPORT À `KpiStrip`, ET POURQUOI
 * --------------------------------------------------
 * La bande précédente posait ses six mesures à poids égal, sur une seule ligne.
 * Or elles ne pèsent pas pareil : « Bloquées » et « À décider » appellent un
 * GESTE de l'opérateur, « Runs 24 h » et « Coût 24 h » décrivent un état. Les
 * rendre identiques oblige à lire les six pour trouver les deux qui comptent.
 *
 * Ici l'écran répond d'abord à « qu'est-ce que je dois faire ? », ensuite à
 * « comment ça va ? » :
 *  · rang 1 — trois cellules larges, liseré coloré, diode ;
 *  · rang 2 — trois cellules denses, avec la barre de couverture quand la
 *    mesure est partielle.
 *
 * CE QUI NE CHANGE PAS
 * --------------------
 * Les six mêmes mesures, lues à la même source (`DashboardKpis`), avec la même
 * règle : `null` reste `null`. Aucune valeur n'est ajoutée ni retirée — c'est
 * une recomposition, pas une nouvelle lecture.
 *
 * Les teintes viennent de `SEVERITY` (source unique). L'ancienne bande portait
 * ses PROPRES constantes `GOOD`/`WARN`/`BAD` (`#059669`, `#d97706`, `#dc2626`),
 * différentes de celles du reste du produit — deux verts sur un même écran.
 */
import { Led } from '@/components/cockpit/primitives'
import {
  Absent,
  ContextCell,
  ContextGrid,
  DecisionCell,
  Meter,
} from '@/components/design/surface'
import { MeasureLabel, MeasureValue, Muted } from '@/components/design/type'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { SEVERITY } from '@/lib/cockpit/status'

function successTone(rate: number | null): string | undefined {
  if (rate === null) return undefined
  if (rate >= 90) return SEVERITY.good
  if (rate >= 60) return SEVERITY.warn
  return SEVERITY.bad
}

function costSupport(cost: NonNullable<DashboardKpis['cost24h']>, partial: boolean): string {
  return partial
    ? `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs mesurés`
    : `${cost.totalRuns} runs mesurés`
}

/** Une mesure du rang 1 — celle qui appelle une décision. */
function Decision({
  label,
  value,
  support,
  tone,
  live,
  beat = false,
  reason,
}: Readonly<{
  label: string
  value: number | string | null
  support: string
  tone?: string
  /** `true` quand la valeur appelle réellement un geste (compteur non nul). */
  live: boolean
  beat?: boolean
  reason: 'unread' | 'no-data'
}>) {
  return (
    <DecisionCell tone={tone} live={live}>
      <div className="mb-3 flex items-center gap-2">
        {tone ? <Led color={live ? tone : SEVERITY.muted} live={beat && live} /> : null}
        <MeasureLabel>{label}</MeasureLabel>
      </div>
      {value === null ? (
        <Absent reason={reason} />
      ) : (
        <MeasureValue size="lg" tone={live ? tone : undefined}>
          {value}
        </MeasureValue>
      )}
      <Muted className="mt-2.5 truncate">{support}</Muted>
    </DecisionCell>
  )
}

/** Une mesure du rang 2 — le contexte. */
function Context({
  label,
  value,
  support,
  coverage,
  tone,
  reason,
}: Readonly<{
  label: string
  value: number | string | null
  support: string
  /** Part de la mesure réellement couverte, quand elle est partielle. */
  coverage?: number
  tone?: string
  reason: 'unread' | 'no-data'
}>) {
  return (
    <ContextCell>
      <MeasureLabel className="mb-2">{label}</MeasureLabel>
      {value === null ? <Absent reason={reason} /> : <MeasureValue>{value}</MeasureValue>}
      <Muted className="mt-1.5 truncate">{support}</Muted>
      {coverage !== undefined && tone ? <Meter ratio={coverage} tone={tone} className="mt-2.5" /> : null}
    </ContextCell>
  )
}

export default function KpiBands({
  kpis,
  unread,
}: Readonly<{
  kpis: DashboardKpis
  /** La fenêtre de runs n'a pas pu être lue — distingue « absent » de « vide ». */
  unread: boolean
}>) {
  const reason = unread ? 'unread' : 'no-data'
  const cost = kpis.cost24h
  const partial = cost !== null && cost.measuredRuns < cost.totalRuns
  const coverage = cost?.totalRuns ? cost.measuredRuns / cost.totalRuns : 0
  const blocked = kpis.blockedDeliveries
  const executableTotal = kpis.executableTotal

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Decision
          label="Bloquées"
          value={blocked}
          support="livraisons à débloquer"
          tone={SEVERITY.bad}
          live={blocked !== null && blocked > 0}
          reason={reason}
        />
        <Decision
          label="À décider"
          value={kpis.needsAction}
          support="décisions en attente"
          tone={SEVERITY.warn}
          live={kpis.needsAction > 0}
          beat
          reason={reason}
        />
        <Decision
          label="Exécutables"
          value={kpis.executableNow}
          support={
            executableTotal === null
              ? 'total du catalogue non lu'
              : `sur ${executableTotal} au catalogue`
          }
          // Zéro agent exécutable est un problème, pas un état neutre : c'est
          // le seul cas où l'absence de valeur non nulle allume la cellule.
          tone={kpis.executableNow === 0 ? SEVERITY.warn : SEVERITY.good}
          live={kpis.executableNow === 0}
          reason={reason}
        />
      </div>

      <ContextGrid className="grid-cols-1 sm:grid-cols-3">
        <Context
          label="Runs 24 h"
          value={kpis.runs24h}
          support={unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre'}
          reason={reason}
        />
        <Context
          label="Succès 24 h"
          value={kpis.success24h === null ? null : `${kpis.success24h} %`}
          support={kpis.success24h === null ? 'aucun run terminal' : 'sur les runs terminaux'}
          coverage={kpis.success24h === null ? undefined : kpis.success24h / 100}
          tone={successTone(kpis.success24h)}
          reason={reason}
        />
        <Context
          label="Coût 24 h"
          value={cost === null ? null : formatUsd(cost.usd)}
          support={cost === null ? 'aucun coût mesurable' : costSupport(cost, partial)}
          coverage={cost === null ? undefined : coverage}
          tone={partial ? SEVERITY.warn : SEVERITY.good}
          reason={reason}
        />
      </ContextGrid>
    </div>
  )
}
