import { ModelCell } from '@/components/runs-console/model-cell'
import { ProjectCell } from '@/components/runs-console/project-cell'
import type { RunRowModel } from '@/components/runs-console/run-row-model'
import { RunStatusBadge } from '@/components/runs-console/status-badge'
import { Link } from '@/components/ui/link'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-xs text-zinc-300">{children}</dd>
    </div>
  )
}

/**
 * The `lg`-and-below rendering of the same rows: stacked cards, not a
 * horizontally scrolling table. Every field and both actions of the desktop
 * table are preserved — the mission forbids dropping essential data on small
 * screens, and the parity test asserts it value by value.
 */
export function RunsCardList({ rows }: { rows: RunRowModel[] }) {
  return (
    <ul aria-label="Runs" className="flex flex-col gap-2 lg:hidden">
      {rows.map((row) => (
        <li key={row.id} className="rounded-2xl bg-surface-sunken p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={row.agentHref}
                title={row.agentNameResolved ? row.agentName : 'Agent name unavailable — showing id'}
                className={`block truncate text-sm font-medium hover:underline ${row.agentNameResolved ? 'text-white' : 'font-mono text-xs text-zinc-400'}`}
              >
                {row.agentName}
              </Link>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-zinc-400">
                <ProjectCell row={row} className="max-w-40" />
                <span aria-hidden="true">·</span>
                <time dateTime={row.startedAtIso} className="shrink-0">
                  {row.startedAtLabel}
                </time>
              </div>
            </div>
            <RunStatusBadge status={row.status} />
          </div>

          {row.inputSummary ? (
            <p className="mt-3 line-clamp-2 text-xs/5 text-zinc-400">{row.inputSummary}</p>
          ) : null}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Field label="Model">
              <ModelCell row={row} />
            </Field>
            <Field label="Tools">
              <span className="tabular-nums">
                {row.toolCallCount}
                {row.unsafeAttemptCount > 0 ? (
                  <span className="ml-1 text-[var(--state-danger-text)]">
                    +{row.unsafeAttemptCount} unsafe
                  </span>
                ) : null}
              </span>
            </Field>
            <Field label="Latency">
              <span className="tabular-nums">{row.duration ?? '—'}</span>
            </Field>
            <Field label="Cost">
              <span className="tabular-nums">{row.cost ?? 'Not measured'}</span>
            </Field>
          </dl>

          <div className="mt-3 flex items-center gap-3 border-t border-[var(--surface-border)] pt-3">
            <Link href={row.detailHref} className="text-xs font-medium text-white hover:underline">
              Run detail
            </Link>
            {row.traceUrl ? (
              <Link
                href={row.traceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-400 hover:underline"
              >
                Trace
              </Link>
            ) : (
              <span className="text-xs text-zinc-400">No trace</span>
            )}
            <span className="ml-auto font-mono text-[11px] text-zinc-400">{row.shortId}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
