import clsx from 'clsx'

import { NotMeasured } from '@/components/cockpit/primitives'
import type { DashboardKpis } from '@/lib/agent-mission-control/dashboard-overview'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { BarMeter } from './meters'

/**
 * Bandeau de mesures — UNE composition, pas six cartes.
 *
 * Chaque mesure vivait dans sa propre boîte (`aig-surface-elevated`,
 * `rounded-xl`, padding et ombre par mesure) : six objets élevés, six liserés,
 * six ombres portées pour six nombres — la signature d'un dashboard SaaS, et
 * la raison pour laquelle le bandeau ne se lisait pas d'un seul tenant. Les
 * chiffres sont désormais nus sur la scène, alignés sur une grille unique.
 *
 * QUATRE RANGS À OFFSET CONSTANT — libellé, valeur, appui, jauge. Les hauteurs
 * de rang sont réservées (`min-h-*`) plutôt que subies : une mesure sans jauge
 * ou dont l'appui tient sur une ligne garde exactement les mêmes lignes de
 * base que ses voisines. C'est ce qui aligne le bandeau horizontalement sans
 * qu'aucune colonne ne pousse les autres.
 *
 * L'ACCENT N'EST PAS DÉCORATIF : il ne marque que les mesures qui appellent un
 * geste de l'opérateur (livraison bloquée, décision en attente) et seulement
 * lorsqu'elles sont non nulles. Il remplace les badges « BLOQUÉ » / « ATTENTE »
 * qui répétaient l'appui déjà écrit dessous et rognaient le libellé.
 */

/** La valeur transite par un `style` inline dans `BarMeter` — voir ce fichier. */
const ACCENT = 'var(--aig-accent)'

type Measure = {
  key: string
  label: string
  value: string | number | null
  unit?: string
  support: string
  /** Part mesurée, quand elle existe — rend une jauge sous l'appui. */
  ratio?: number | null
  /** Appelle un geste de l'opérateur : seul emploi de l'accent. */
  actionable?: boolean
  /** Mesure lue et vide — le zéro se lit, il ne réclame pas. */
  quiet?: boolean
}

function costSupportText(cost: NonNullable<DashboardKpis['cost24h']>, partial: boolean): string {
  if (partial) return `minorant · ${cost.measuredRuns}/${cost.totalRuns} runs`
  return `${cost.totalRuns} runs mesurés`
}

function MeasureCell({ measure }: Readonly<{ measure: Measure }>) {
  const { label, value, unit, support, ratio, actionable, quiet } = measure

  return (
    <div className="flex min-w-0 flex-col">
      <p className="aig-text-muted truncate text-2xs uppercase tracking-[0.12em]">{label}</p>

      <div className="mt-2.5 flex min-h-7 items-baseline gap-1">
        {value === null ? (
          <NotMeasured why={support} label="—" />
        ) : (
          <>
            <span
              className={clsx(
                'text-[1.75rem] font-semibold leading-none tabular-nums tracking-[-0.02em]',
                actionable ? 'aig-accent' : quiet ? 'aig-text-muted' : 'aig-text',
              )}
            >
              {value}
            </span>
            {unit ? <span className="aig-text-muted text-sm leading-none">{unit}</span> : null}
          </>
        )}
      </div>

      {/* Deux lignes réservées : l'appui peut se replier sans décaler la jauge
          des colonnes voisines. */}
      <p className="aig-text-muted mt-2 min-h-8 text-2xs uppercase leading-4 tracking-[0.08em]">
        {support}
      </p>

      {/* `mt-2` sur le conteneur, jamais sur la jauge : la marge s'applique
          même quand la cellule n'a pas de jauge, donc les quatre rangs gardent
          le même offset d'une colonne à l'autre. Sans elle, un appui replié sur
          deux lignes venait toucher la barre, qui se lisait en soulignement. */}
      <div className="mt-2 min-h-1">
        {typeof ratio === 'number' ? <BarMeter ratio={ratio} color={ACCENT} /> : null}
      </div>
    </div>
  )
}

export default function KpiStrip({
  kpis,
  unread,
}: Readonly<{ kpis: DashboardKpis; unread: boolean }>) {
  const cost = kpis.cost24h
  const partial = cost !== null && cost.measuredRuns < cost.totalRuns
  const coverage =
    cost !== null && cost.totalRuns > 0 ? cost.measuredRuns / cost.totalRuns : null
  const executableTotal = kpis.executableTotal
  const blocked = kpis.blockedDeliveries
  const windowEmpty = !unread && kpis.runs24h === 0

  const measures: Measure[] = [
    {
      key: 'runs',
      label: 'Runs 24 h',
      value: unread ? null : kpis.runs24h,
      support: unread ? 'fenêtre non lue' : 'exécutions sur la fenêtre',
      quiet: windowEmpty,
    },
    {
      key: 'success',
      label: 'Succès 24 h',
      value: unread ? null : kpis.success24h,
      unit: kpis.success24h === null ? undefined : '%',
      support: kpis.success24h === null ? 'aucun run terminal' : 'sur les runs terminaux',
      ratio: kpis.success24h === null ? null : kpis.success24h / 100,
    },
    {
      key: 'cost',
      label: 'Coût 24 h',
      value: unread || cost === null ? null : formatUsd(cost.usd),
      support: cost === null ? 'aucun coût mesurable' : costSupportText(cost, partial),
      ratio: coverage,
    },
    {
      key: 'executable',
      label: 'Exécutables',
      value: unread ? null : kpis.executableNow,
      support:
        executableTotal === null ? 'total du catalogue non lu' : `sur ${executableTotal} au catalogue`,
      ratio:
        executableTotal !== null && executableTotal > 0 && kpis.executableNow !== null
          ? kpis.executableNow / executableTotal
          : null,
    },
    {
      /*
        LEARNING — la boucle d'amélioration, mesurée et non simulée.
        (AIGENT-UX-IA-001, #93 : « Learning » rejoint le bandeau.)

        `readyForManualTest` était DÉJÀ calculé par `getDashboardOverview` et
        n'était affiché nulle part : ce sont les versions livrées qui attendent
        une revue humaine, c'est-à-dire l'entrée de la boucle d'amélioration.
        Il porte la même discipline que les autres rangs — `null` quand la
        lecture des événements de livraison échoue, jamais un zéro de confort,
        ce qui dirait « personne n'attend » là où le fait est « on n'a pas pu
        vérifier ».

        Les propositions d'amélioration (`improvement_decision`) auraient été
        l'autre candidat, mais l'Aperçu ne les lit pas : elles demandent un scan
        borné à trente copilots que seule `/actions` paie. Les afficher ici
        aurait exigé une lecture supplémentaire — hors périmètre de cette
        mission, qui interdit de toucher au backend.
      */
      key: 'learning',
      label: 'Learning',
      value: kpis.readyForManualTest,
      support:
        kpis.readyForManualTest === null ? 'revue non lue' : 'versions en attente de revue',
      actionable: kpis.readyForManualTest !== null && kpis.readyForManualTest > 0,
    },
    {
      key: 'deliveries',
      label: 'Livraisons',
      value: blocked,
      support: 'bloquées à débloquer',
      actionable: blocked !== null && blocked > 0,
    },
    {
      key: 'decisions',
      label: 'Décisions',
      value: kpis.needsAction,
      support: 'opérateur en attente',
      actionable: kpis.needsAction > 0,
    },
  ]

  // SEPT colonnes en `xl`, pas six : la mesure « Learning » ajoutée par
  // AIGENT-UX-IA-001 aurait sinon basculé seule sur une deuxième ligne, et un
  // bandeau qui se lit « six mesures puis une » n'est plus une composition. En
  // `lg` on reste à quatre par ligne (4 + 3), ce qui garde des colonnes assez
  // larges pour que les libellés ne se tronquent pas.
  return (
    <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 xl:gap-x-6">
      {measures.map((measure) => (
        <MeasureCell key={measure.key} measure={measure} />
      ))}
    </div>
  )
}
