/**
 * Flux d'exécution — ce qui SE PASSE, ligne à ligne, du plus récent au plus
 * ancien.
 *
 * Ce n'était qu'une table de gestion : cinq colonnes, une bordure de grille,
 * des pastilles pleines. C'est maintenant un flux de télémétrie — horodatage
 * monospacé en tête de ligne, rail de statut sur l'arête gauche, identité au
 * centre, mesures alignées à droite. Rien n'a été retiré : les mêmes cinq faits
 * sont là, mais la ligne se lit d'un balayage vertical au lieu d'un
 * déchiffrement cellule par cellule.
 *
 * Une mesure absente reste absente : ni « 0 ms », ni « $0.00 ».
 */
import { UNAVAILABLE_LABEL, formatUsd } from '@/lib/agent-mission-control/format'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import { clockTime, timeAgo } from '@/lib/cockpit/named-runs'
import { RUN_STATUS_COLOR, RUN_STATUS_SINGULAR } from '@/lib/cockpit/status'
import { Led, Rail } from './primitives'

/** Une seule définition de grille pour l'en-tête et les lignes — sinon elles glissent. */
const COLS =
  'grid grid-cols-[52px_minmax(0,1fr)_56px_66px_62px] items-center gap-x-3 sm:grid-cols-[52px_88px_minmax(0,1fr)_56px_66px_62px]'

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`
}

export default function RunStream({ runs, nowMs }: { runs: NamedRun[]; nowMs: number }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={`${COLS} shrink-0 border-b border-white/6 px-3.5 py-1.5 text-[9px] font-semibold tracking-[0.16em] text-ink-faint uppercase`}
      >
        <span>Heure</span>
        <span className="hidden sm:block">Statut</span>
        <span>Agent</span>
        <span className="text-right">Durée</span>
        <span className="text-right">Coût</span>
        <span className="text-right">Il y a</span>
      </div>

      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {runs.map((run) => {
          const color = RUN_STATUS_COLOR[run.status]
          const live = run.status === 'running'
          return (
            <li
              key={run.id}
              className={`${COLS} group relative border-b border-white/[0.035] px-3.5 py-2 transition-colors hover:bg-elevated`}
            >
              <Rail color={color} className="opacity-50 transition-opacity group-hover:opacity-100" />

              <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                {clockTime(run.startedAtMs)}
              </span>

              <span className="hidden items-center gap-1.5 sm:flex">
                <Led color={color} live={live} />
                <span className="truncate text-[10.5px] tracking-wide text-ink-dim">
                  {RUN_STATUS_SINGULAR[run.status]}
                </span>
              </span>

              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="truncate text-[12.5px] font-medium text-ink">
                  {run.copilotName ?? (
                    <span className="font-mono text-[11px] text-ink-faint">{run.copilotId}</span>
                  )}
                </span>
                <span className="truncate text-[10.5px] text-ink-faint">
                  {run.projectName ? `· ${run.projectName}` : '· sans projet'}
                </span>
              </span>

              <span className="text-right font-mono text-[11px] tabular-nums text-ink-dim">
                {run.latencyMs === null ? (
                  <span className="text-[9px] tracking-wide text-ink-faint uppercase">
                    {UNAVAILABLE_LABEL}
                  </span>
                ) : (
                  duration(run.latencyMs)
                )}
              </span>

              <span className="text-right font-mono text-[11px] tabular-nums text-ink-dim">
                {run.costUsd === null ? (
                  <span className="text-[9px] tracking-wide text-ink-faint uppercase">
                    {UNAVAILABLE_LABEL}
                  </span>
                ) : (
                  formatUsd(run.costUsd)
                )}
              </span>

              <span className="truncate text-right font-mono text-[10.5px] whitespace-nowrap text-ink-faint">
                {timeAgo(run.startedAtMs, nowMs).replace('il y a ', '')}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
