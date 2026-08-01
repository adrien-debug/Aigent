/**
 * Légende de statut du cockpit.
 *
 * Ce fichier portait aussi `HourlyRunsChart`, un histogramme Recharts — le SEUL
 * usage de Recharts du produit. Il a été remplacé par `activity-graph.tsx`, un
 * tracé SVG animé par Motion, et supprimé avec sa dépendance : garder un
 * graphique que plus aucun écran ne rend, c'est laisser croire qu'il sert
 * encore.
 *
 * La pastille de couleur reste un élément de dataviz — elle relie le libellé à
 * sa courbe — et c'est le seul ajout au `Badge` Catalyst, qui ne fournit rien
 * d'équivalent.
 */
import { Badge } from '@/components/ui/badge'
import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {slices.map((s) => (
        <li key={s.status}>
          <Badge color="zinc">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: RUN_STATUS_COLOR[s.status], opacity: s.count === 0 ? 0.3 : 1 }}
            />
            {RUN_STATUS_LABEL[s.status]}
            <span className="tabular-nums">{s.count}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}
