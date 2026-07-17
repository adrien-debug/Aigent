import clsx from 'clsx'

import { Badge } from '@/components/catalyst/badge'
import { Text } from '@/components/catalyst/text'

import type { TradingAgentVM } from './roster-view-model'

/**
 * One agent in the Trading Agent Factory roster — a hairline-separated ROW
 * inside the single roster SurfaceCard (no box-in-box: rows are divided by
 * `border-t border-white/5`, never wrapped in their own bordered card).
 *
 * Mono-accent: the ONLY chromatic surface is the accent badge escalation
 * (accent / accentStrong / accentSolid) and accent dots. Status of a
 * not-yet-materialized agent is muted zinc text, per doctrine (lifecycle
 * status = muted text, not a pill).
 *
 * Tool tiles show DISPONIBLE vs INDISPONIBLE — available tools carry an
 * accent dot; unavailable tools are dimmed zinc with a strike-through dot and
 * their reason, making the UNAVAILABLE state visible at a glance (invariant #8).
 */
export function TradingAgentRow({ agent, index }: { agent: TradingAgentVM; index: number }) {
  return (
    <div className={clsx('px-6 py-6 lg:px-8', index > 0 && 'border-t border-white/5')}>
      {/* Identity + meta */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {/* Ordinal marker — accent hairline tile, not a box-in-box (a marker, sized square) */}
          <span
            aria-hidden="true"
            className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] font-mono text-xs text-accent-300 sm:flex"
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h3 className="text-base font-semibold tracking-tight text-white">{agent.name}</h3>
              <Badge color="accent" className="uppercase tracking-wide">
                {agent.statusLabel}
              </Badge>
              <span className="text-xs text-zinc-500">Non matérialisé</span>
            </div>
            <p className="mt-1 text-sm text-zinc-400">{agent.specialty}</p>
            <Text className="mt-2 max-w-2xl">{agent.description}</Text>
          </div>
        </div>

        {/* Version + contract — right-aligned mono meta, no box */}
        <div className="flex shrink-0 flex-row flex-wrap items-center gap-x-6 gap-y-2 sm:flex-col sm:items-end sm:gap-y-1.5">
          <div className="flex flex-col sm:items-end">
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Version</span>
            <span className="font-mono text-sm tabular-nums text-zinc-300">{agent.version}</span>
          </div>
          <div className="flex flex-col sm:items-end">
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Output contract</span>
            <span className="font-mono text-sm text-zinc-300">{agent.contractName}</span>
          </div>
        </div>
      </div>

      {/* Budget targets — naked stats on a hairline, no box (KPI-strip rhythm) */}
      <div className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 border-t border-white/5 pt-4 sm:grid-cols-3">
        <BudgetStat label="Max steps / run" value={String(agent.maxStepsPerRun)} />
        <BudgetStat label="Cost target / run" value={`$${agent.maxCostPerRunUsd.toFixed(2)}`} />
        <BudgetStat label="Latency target" value={`${Math.round(agent.maxLatencyMsTarget / 1000)}s`} />
      </div>

      {/* Tools — available vs unavailable */}
      <div className="mt-6 border-t border-white/5 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">Tools</span>
          <span className="text-xs text-zinc-500">
            <span className="text-accent-300">{agent.availableToolCount} available</span>
            {agent.unavailableToolCount > 0 ? (
              <>
                <span aria-hidden="true" className="mx-1.5 text-zinc-700">·</span>
                <span className="text-zinc-500">{agent.unavailableToolCount} unavailable</span>
              </>
            ) : null}
          </span>
        </div>
        <ul role="list" className="mt-3 flex flex-wrap gap-2">
          {agent.tools.map((tool) => (
            <li key={tool.id}>
              <ToolTile id={tool.id} available={tool.availability === 'available'} note={tool.note} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function BudgetStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="font-mono text-lg font-light tabular-nums text-white">{value}</span>
    </div>
  )
}

/**
 * A single tool tile. Available → accent dot + zinc mono name. Unavailable →
 * dimmed, hollow dot, reason appended. This IS the visible UNAVAILABLE state
 * (dimmed tiles + hollow markers + note).
 */
function ToolTile({ id, available, note }: { id: string; available: boolean; note: string | null }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs',
        available
          ? 'bg-zinc-950/5 text-zinc-300 ring-1 ring-inset ring-white/10 dark:bg-white/[0.03]'
          : 'bg-zinc-950/5 text-zinc-600 ring-1 ring-inset ring-white/[0.06] line-through decoration-zinc-700 dark:bg-white/[0.015]'
      )}
      title={available ? undefined : note ?? 'unavailable'}
    >
      <span
        aria-hidden="true"
        className={clsx(
          'size-1.5 shrink-0 rounded-full',
          available ? 'bg-accent-400' : 'border border-zinc-600'
        )}
      />
      {id}
      {!available && note ? (
        <span className="ml-1 no-underline text-[10px] tracking-wide text-zinc-600">— {note}</span>
      ) : null}
    </span>
  )
}
