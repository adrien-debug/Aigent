/**
 * Lignes de roster — agents et projets.
 *
 * C'étaient des fiches : un en-tête d'identité, puis une `DescriptionList` de
 * trois paires terme/valeur. Trois lignes de formulaire par entité, quatre
 * entités à l'écran — de l'administratif, pas un cockpit.
 *
 * Même grammaire que le flux d'exécution : un rail de statut sur l'arête
 * gauche, l'identité au centre, les mesures alignées à droite en chiffres
 * monospacés. Une entité tient sur une ligne dense, on en voit six au lieu de
 * deux, et les trois listes de l'écran se lisent avec le même œil.
 *
 * Les faits affichés sont exactement les mêmes qu'avant, et une mesure absente
 * l'est toujours explicitement.
 */
import { UNAVAILABLE_LABEL, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentCard, ProjectCard } from '@/lib/cockpit/named-runs'
import { timeAgo } from '@/lib/cockpit/named-runs'
import { COPILOT_STATUS_COLOR, COPILOT_STATUS_LABEL } from '@/lib/cockpit/status'
import { Led, Rail } from './primitives'

const MUTED_RAIL = '#2e343c'

/** Deux lettres d'identité — jamais un nom inventé, seulement son abréviation. */
function initials(name: string | null): string {
  if (!name) return '··'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Valeur monospacée, ou la marque d'absence — jamais un zéro de remplacement. */
function Measure({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] tabular-nums text-ink-dim">{children}</span>
}

function Absent() {
  return (
    <span className="font-mono text-[9px] tracking-wide text-ink-faint uppercase">
      {UNAVAILABLE_LABEL}
    </span>
  )
}

/** Un agent qui a réellement tourné sur la fenêtre. */
export function AgentRow({ card, nowMs }: { card: AgentCard; nowMs: number }) {
  const statusColor = COPILOT_STATUS_COLOR[card.status] ?? COPILOT_STATUS_COLOR.draft
  const statusLabel = COPILOT_STATUS_LABEL[card.status] ?? COPILOT_STATUS_LABEL.draft
  const failing = card.failures24h > 0
  const railColor = failing ? '#e8455f' : card.status === 'active' ? '#0da87f' : MUTED_RAIL

  return (
    <li className="group relative flex items-center gap-2.5 border-b border-white/[0.035] px-3.5 py-2.5 transition-colors hover:bg-elevated">
      <Rail color={railColor} className="opacity-60 transition-opacity group-hover:opacity-100" />

      <span
        aria-hidden
        className="grid size-7 shrink-0 place-items-center rounded-md border border-accent/25 bg-accent/10 font-mono text-[10px] font-semibold text-accent"
      >
        {initials(card.name)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-ink">
            {card.name ?? <span className="text-ink-faint">Agent non résolu</span>}
          </span>
          <Led color={statusColor} live={card.status === 'active'} />
          <span className="shrink-0 text-[9.5px] tracking-[0.12em] text-ink-faint uppercase">
            {statusLabel}
          </span>
        </span>
        <span className="truncate text-[10.5px] text-ink-faint">
          {card.projectName ?? 'Sans projet'}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="flex items-baseline gap-1">
          <span className="font-mono text-[14px] leading-none font-semibold tabular-nums text-ink">
            {card.runs24h}
          </span>
          <span className="text-[9.5px] text-ink-faint">runs</span>
          {failing ? (
            <span className="ml-1 rounded border border-[#e8455f]/35 bg-[#e8455f]/12 px-1 font-mono text-[9.5px] text-[#e8455f]">
              {card.failures24h} KO
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex items-baseline gap-1.5">
          {card.costUsd === null ? <Absent /> : <Measure>{formatUsd(card.costUsd)}</Measure>}
          <span aria-hidden className="text-ink-faint/50">
            ·
          </span>
          <span className="font-mono text-[10px] whitespace-nowrap text-ink-faint">
            {card.lastRunMs === null ? '—' : timeAgo(card.lastRunMs, nowMs).replace('il y a ', '')}
          </span>
        </span>
      </span>
    </li>
  )
}

/** Un projet du catalogue — actif ou non, il est dit tel qu'il est. */
export function ProjectRow({ card }: { card: ProjectCard }) {
  const live = card.activeCount > 0
  const railColor = live ? 'var(--accent-main)' : MUTED_RAIL

  return (
    <li className="group relative flex items-center gap-2.5 border-b border-white/[0.035] px-3.5 py-2.5 transition-colors hover:bg-elevated">
      <Rail color={railColor} className="opacity-60 transition-opacity group-hover:opacity-100" />

      <span
        aria-hidden
        className={`grid size-7 shrink-0 place-items-center rounded-md border font-mono text-[10px] font-semibold ${
          live
            ? 'border-accent/25 bg-accent/10 text-accent'
            : 'border-white/8 bg-elevated text-ink-faint'
        }`}
      >
        {initials(card.name)}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium text-ink">{card.name}</span>
          <span className="shrink-0 rounded border border-white/8 bg-elevated px-1 font-mono text-[9.5px] text-ink-faint">
            {card.activeCount}/{card.copilotCount}
          </span>
        </span>
        <span className="truncate font-mono text-[10px] text-ink-faint">
          {card.repoFullName ?? 'aucun repo lié'}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end">
        <span className="flex items-baseline gap-1">
          {card.runs24h === null ? (
            <Absent />
          ) : (
            <>
              <span className="font-mono text-[14px] leading-none font-semibold tabular-nums text-ink">
                {card.runs24h}
              </span>
              <span className="text-[9.5px] text-ink-faint">runs</span>
            </>
          )}
        </span>
        <span className="mt-1 flex items-baseline gap-1.5">
          {card.costLast24hUsd === null ? <Absent /> : <Measure>{formatUsd(card.costLast24hUsd)}</Measure>}
          <span aria-hidden className="text-ink-faint/50">
            ·
          </span>
          {card.passRate === null ? (
            <span className="font-mono text-[10px] text-ink-faint">—</span>
          ) : (
            <span className="font-mono text-[10px] tabular-nums text-ink-faint">
              {Math.round(card.passRate * 100)} %
            </span>
          )}
        </span>
      </span>
    </li>
  )
}
