/**
 * L'écran de comparaison V1 / V2 — ce qui manquait avant une approbation.
 *
 * Server Component pur : il reçoit la vue déjà assemblée par `compare-model.ts`
 * et ne lit rien lui-même. Aucun aller-retour, aucune mesure : la donnée était
 * DÉJÀ calculée à chaque rendu de la fiche et jetée faute de rendu.
 *
 * CE PANNEAU NE DÉCIDE RIEN. Il n'expose aucun bouton d'approbation, aucune
 * promotion, aucun changement de version — la décision humaine et la promotion
 * restent exactement là où elles étaient (`decideProposal` et la route de
 * promotion, toutes deux hors de ce fichier). Ce panneau ne fait que rendre
 * lisible ce sur quoi cette décision porte.
 *
 * ABSENCE : trois vocabulaires, aucun nouveau. `Unavailable` pour un panneau
 * entier, `NotMeasured` pour une valeur en ligne, et le mot du produit
 * (`UNAVAILABLE_LABEL`) partout — ce fichier n'invente aucun quatrième mot.
 */
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { NotMeasured, Unavailable } from '@/components/cockpit/primitives'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import type { ImprovementProposal } from '@/lib/agent-mission-control/improvement-loop'
import {
  COMPARE_ABSENCE_DETAIL,
  type CompareAbsence,
  type CompareView,
  type Direction,
  type Measured,
  type NumberRow,
  type TextRow,
} from './compare-model'

/* ───────────────────────────── Rendu des valeurs ───────────────────────────── */

/** Une valeur textuelle, ou le mot d'absence. Jamais un tiret nu. */
function TextValue({ value, why }: Readonly<{ value: Measured<string>; why: string }>) {
  if (value.state !== 'measured') return <NotMeasured why={why} />
  return <span className="wrap-break-word">{value.value}</span>
}

function formatNumber(value: number, format: NumberRow['format']): string {
  if (format === 'ratio') return formatPercent(value)
  if (format === 'usd') return formatUsd(value)
  if (format === 'score100') return value.toFixed(1)
  return String(value)
}

/**
 * Une valeur numérique. `formatUsd` rend déjà le mot d'absence sur `null`, mais
 * on ne l'atteint jamais avec `null` : la narrowing se fait ici, pour que
 * l'absence emprunte le même composant que partout ailleurs sur la fiche.
 */
function NumberValue({
  value,
  format,
  why,
}: Readonly<{ value: Measured<number>; format: NumberRow['format']; why: string }>) {
  if (value.state !== 'measured') return <NotMeasured why={why} />
  return <span className="tabular-nums">{formatNumber(value.value, format)}</span>
}

/*
 * LA DIRECTION EST UN MOT AVANT D'ÊTRE UNE COULEUR.
 *
 * Un écran lu en niveaux de gris — ou par quelqu'un qui ne distingue pas le
 * rouge du vert — doit rester vrai. Chaque direction porte donc son libellé ;
 * la teinte ne fait que la doubler. `unknown` n'est ni vert ni rouge : il dit
 * que l'écart est incalculable, ce qui n'est pas un demi-échec.
 */
const DIRECTION_LABEL: Record<Direction, string> = {
  better: 'en progrès',
  worse: 'en recul',
  same: 'inchangé',
  unknown: 'écart incalculable',
}

const DIRECTION_MEANING: Record<Direction, string> = {
  better: 'La V2 est meilleure que la V1 sur cette mesure.',
  worse: 'La V2 est moins bonne que la V1 sur cette mesure.',
  same: 'Les deux versions ont été mesurées et donnent la même valeur.',
  unknown:
    'Au moins un des deux côtés n’a pas été mesuré : l’écart ne peut pas être calculé. Ce n’est pas « aucun changement ».',
}

function DirectionBadge({ direction }: Readonly<{ direction: Direction }>) {
  const color =
    direction === 'better'
      ? 'emerald'
      : direction === 'worse'
        ? 'red'
        : direction === 'unknown'
          ? 'amber'
          : 'zinc'
  return (
    <Badge color={color} title={DIRECTION_MEANING[direction]}>
      {DIRECTION_LABEL[direction]}
    </Badge>
  )
}

/* ───────────────────────────── Lignes ───────────────────────────── */

/**
 * Une ligne de comparaison : le libellé, la V1, la V2, le verdict.
 *
 * En desktop c'est une grille de quatre colonnes ; en mobile la grille
 * s'effondre en pile et CHAQUE côté garde son étiquette « V1 » / « V2 ». Aucune
 * colonne n'est masquée sous un point de rupture : cacher le côté V2 sur petit
 * écran ferait disparaître exactement l'information que la page existe pour
 * montrer.
 */
function ComparisonRow({
  label,
  meaning,
  v1,
  v2,
  verdict,
  why,
  emphasised,
}: Readonly<{
  label: string
  meaning: string
  v1: ReactNode
  v2: ReactNode
  verdict: ReactNode
  why?: Measured<string>
  emphasised: boolean
}>) {
  return (
    <li className="py-3">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_auto] sm:items-baseline">
        <div className="min-w-0">
          <Text className="aig-text-faint text-xs font-medium uppercase tracking-wide" title={meaning}>
            {label}
          </Text>
        </div>

        <div className="min-w-0">
          <Text className="aig-text-faint text-2xs font-medium uppercase sm:hidden">V1</Text>
          <div className="min-w-0 text-sm">{v1}</div>
        </div>

        <div className="min-w-0">
          <Text className="aig-text-faint text-2xs font-medium uppercase sm:hidden">V2</Text>
          <div className="min-w-0 text-sm">
            {emphasised ? <Strong className="wrap-break-word">{v2}</Strong> : v2}
          </div>
        </div>

        <div className="flex shrink-0 items-center">{verdict}</div>
      </div>

      {why && why.state === 'measured' ? (
        <Text className="aig-text-muted mt-2 text-sm sm:pl-0">{why.value}</Text>
      ) : null}
    </li>
  )
}

function TextComparisonRow({ row }: Readonly<{ row: TextRow }>) {
  return (
    <ComparisonRow
      label={row.label}
      meaning={row.meaning}
      emphasised={row.changed}
      why={row.why}
      v1={
        <TextValue
          value={row.v1}
          why={`« ${row.label} » n’a pas de valeur lisible sur la V1 — c’est une absence, pas une valeur vide.`}
        />
      }
      v2={
        <TextValue
          value={row.v2}
          why={`« ${row.label} » n’a pas de valeur lisible sur la V2 — c’est une absence, pas une valeur vide.`}
        />
      }
      verdict={
        row.changed ? (
          <Badge color="sky" title="Les deux côtés sont mesurés et diffèrent.">
            modifié
          </Badge>
        ) : row.v1.state === 'measured' && row.v2.state === 'measured' ? (
          <Badge color="zinc" title="Les deux côtés sont mesurés et identiques.">
            inchangé
          </Badge>
        ) : (
          <DirectionBadge direction="unknown" />
        )
      }
    />
  )
}

function NumberComparisonRow({ row }: Readonly<{ row: NumberRow }>) {
  return (
    <ComparisonRow
      label={row.label}
      meaning={row.meaning}
      emphasised={row.direction === 'better' || row.direction === 'worse'}
      v1={
        <NumberValue
          value={row.v1}
          format={row.format}
          why={`« ${row.label} » n’a jamais été mesuré sur la V1. Ce n’est pas une valeur de zéro.`}
        />
      }
      v2={
        <NumberValue
          value={row.v2}
          format={row.format}
          why={`« ${row.label} » n’a jamais été mesuré sur la V2. Ce n’est pas une valeur de zéro.`}
        />
      }
      verdict={<DirectionBadge direction={row.direction} />}
    />
  )
}

/* ───────────────────────────── Groupes ───────────────────────────── */

function CompareGroupBlock({ group }: Readonly<{ group: CompareView['groups'][number] }>) {
  const rowCount = group.textRows.length + group.numberRows.length
  return (
    <div className="min-w-0">
      <Subheading level={3}>{group.title}</Subheading>
      <div className="aig-hairline my-2" />
      <Text className="aig-text-muted text-sm">{group.description}</Text>

      {rowCount === 0 ? (
        <div className="mt-3">
          <Unavailable reason="no-data" detail="Aucune ligne comparable dans ce groupe." />
        </div>
      ) : (
        /* Creux à hauteur bornée : la boîte ne grandit pas avec la donnée, la
           donnée défile dedans. */
        <div className="aig-inset mt-3 max-h-96 overflow-y-auto px-4">
          <ul className="divide-y divide-[color:var(--aig-line-soft)]">
            {group.textRows.map((row) => (
              <TextComparisonRow key={row.key} row={row} />
            ))}
            {group.numberRows.map((row) => (
              <NumberComparisonRow key={row.key} row={row} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────────── Panneau ───────────────────────────── */

const STATUS_LABEL: Record<ImprovementProposal['status'], string> = {
  proposed: 'proposée',
  'v2-created': 'V2 matérialisée, décision en attente',
  approved: 'approuvée',
  rejected: 'rejetée',
}

const STATUS_MEANING: Record<ImprovementProposal['status'], string> = {
  proposed: 'La boucle a proposé une V2 ; aucun brouillon n’est encore matérialisé.',
  'v2-created':
    'Le brouillon V2 existe et attend une décision humaine. Approuver n’est PAS promouvoir : la promotion en production reste un geste séparé.',
  approved:
    'Un opérateur a approuvé cette proposition. L’approbation ne promeut pas à elle seule la V2 en production.',
  rejected: 'Un opérateur a rejeté cette proposition.',
}

function StatusBadge({ status }: Readonly<{ status: ImprovementProposal['status'] }>) {
  const color =
    status === 'approved'
      ? 'emerald'
      : status === 'rejected'
        ? 'red'
        : status === 'v2-created'
          ? 'sky'
          : 'zinc'
  return (
    <Badge color={color} title={STATUS_MEANING[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

/**
 * La comparaison V1 / V2, ou l'absence HONNÊTE qui explique pourquoi il n'y en
 * a pas.
 *
 * `absence` et `view` sont exclusifs : l'appelant a déjà tranché lequel des deux
 * cas s'applique, précisément pour qu'un « aucune proposition » ne puisse jamais
 * se rendre comme un tableau de comparaison vide — qui se lirait « la V2 ne
 * change rien », l'exact contraire de la vérité.
 */
export default function ComparePanel({
  view,
  absence,
}: Readonly<{ view: CompareView | null; absence: CompareAbsence | null }>) {
  if (view === null) {
    const reason: CompareAbsence = absence ?? 'unread'
    return (
      <div className="aig-quiet p-4 sm:p-5">
        <Unavailable
          reason={reason === 'unread' ? 'unread' : 'no-data'}
          detail={COMPARE_ABSENCE_DETAIL[reason]}
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* L'en-tête du cycle : quelles versions, quel statut, combien d'écarts.
          Pas de grande carte : une bande de faits plats. */}
      <div className="aig-quiet flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
            Comparaison
          </Text>
          <Text className="text-sm">
            <Strong>
              {view.v1Label.state === 'measured' ? view.v1Label.value : 'V1 non résolue'}
            </Strong>
            {' → '}
            <Strong>
              {view.v2Label.state === 'measured' ? view.v2Label.value : 'V2 non résolue'}
            </Strong>
          </Text>
          <StatusBadge status={view.proposalStatus} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge color="zinc" title="Lignes dont les deux côtés sont mesurés et diffèrent.">
            {view.changedCount} écart(s) mesuré(s)
          </Badge>
          <Badge
            color="amber"
            title="Lignes dont au moins un côté n’a pas été mesuré : l’écart est inconnu, pas nul."
          >
            {view.unknownCount} écart(s) incalculable(s)
          </Badge>
        </div>

        {view.summary.state === 'measured' ? (
          <Text className="aig-text-muted text-sm">{view.summary.value}</Text>
        ) : (
          <Unavailable
            reason="no-data"
            detail="La proposition ne porte aucun résumé explicatif."
            compact
          />
        )}

        {/* L'invariant produit, écrit à l'écran : lire cette comparaison
            n'engage rien. C'est la phrase qui empêche de croire qu'un écran de
            diff est un écran de déploiement. */}
        <Text className="aig-text-faint text-xs">
          Cette comparaison se lit : elle ne déclenche ni approbation, ni promotion, ni changement de
          version. Une V2 ne s’auto-promeut jamais.
        </Text>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        {view.groups.map((group) => (
          <CompareGroupBlock key={group.key} group={group} />
        ))}
      </div>
    </div>
  )
}
