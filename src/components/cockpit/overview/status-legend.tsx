import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

/**
 * Légende des statuts de la fenêtre — texte + pastille, sans boîte.
 *
 * Les jetons encadrés (fond, liseré, halo) qui vivaient ici posaient cinq
 * cartouches sur la même ligne que le titre de zone : cinq objets pour cinq
 * comptes à zéro. La pastille suffit à porter la teinte, et le libellé
 * l'accompagne TOUJOURS — la couleur seule ne code pas un statut
 * (`src/lib/cockpit/status.ts`).
 */
export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {slices.map((slice) => (
        <div key={slice.status} className="inline-flex items-center gap-x-1.5">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: RUN_STATUS_COLOR[slice.status] }}
          />
          <span className="aig-text-muted text-2xs uppercase tracking-[0.1em]">
            {RUN_STATUS_LABEL[slice.status]}
          </span>
          <span className="aig-text-muted text-2xs tabular-nums">{slice.count}</span>
        </div>
      ))}
    </div>
  )
}
