import clsx from 'clsx'

/**
 * A static, decorative preview of the Agent Mission Control console — a
 * copilot registry with a run summary rail. Replaces the empty wireframe
 * placeholders that shipped with the marketing template. Pure markup, no
 * data, no interactivity: it is a product screenshot rendered in the DOM so
 * it stays crisp at any width and follows the accent/zinc token doctrine.
 *
 * Deliberately carries NO numeric values: the copilot names and stage labels
 * are illustrative, but runs/pass columns and the summary rail render as
 * neutral bars and dashes so nothing here can be mistaken for a live metric.
 */

const ROWS = [
  { name: 'support-triage', stage: 'Production', tone: 'live' },
  { name: 'invoice-extractor', stage: 'Production', tone: 'live' },
  { name: 'contract-reviewer', stage: 'Shadow', tone: 'shadow' },
  { name: 'onboarding-guide', stage: 'Draft', tone: 'draft' },
] as const

const STAT_LABELS = ['Live copilots', 'Runs today', 'Gate pass rate'] as const

export function ConsolePreview({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'overflow-hidden rounded-xl bg-zinc-900/80 shadow-2xl ring-1 ring-white/10 backdrop-blur-sm',
        className,
      )}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/[0.04] px-4 py-3">
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="ml-3 text-xs font-medium text-zinc-500">Agent Mission Control — Registry</span>
      </div>

      <div className="grid gap-px bg-white/5 sm:grid-cols-[1fr_12rem]">
        {/* Registry table */}
        <div className="min-w-0 bg-zinc-900/80 p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-white">Copilots</span>
            <span className="text-xs text-zinc-500">Registry</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[20rem] text-left text-xs">
              <thead>
                <tr className="border-b border-white/10 text-xs tracking-wide text-zinc-500 uppercase">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Stage</th>
                  <th className="hidden pb-2 pr-3 text-right font-medium sm:table-cell">Runs</th>
                  <th className="pb-2 text-right font-medium">Pass</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ROWS.map((row) => (
                  <tr key={row.name}>
                    <td className="py-2.5 pr-3 font-mono whitespace-nowrap text-zinc-200">{row.name}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={clsx(
                          'inline-flex items-center gap-1.5 whitespace-nowrap',
                          row.tone === 'draft' ? 'text-zinc-500' : 'text-zinc-300',
                        )}
                      >
                        <span
                          className={clsx(
                            'size-1.5 shrink-0 rounded-full',
                            row.tone === 'live' && 'bg-accent-400',
                            row.tone === 'shadow' && 'bg-accent-600',
                            row.tone === 'draft' && 'bg-zinc-600',
                          )}
                        />
                        {row.stage}
                      </span>
                    </td>
                    <td className="hidden py-2.5 pr-3 sm:table-cell">
                      {row.tone === 'draft' ? (
                        <div className="flex justify-end text-zinc-600">—</div>
                      ) : (
                        <div className="ml-auto h-1.5 w-16 rounded-full bg-zinc-700" />
                      )}
                    </td>
                    <td className="py-2.5">
                      {row.tone === 'draft' ? (
                        <div className="flex justify-end text-zinc-600">—</div>
                      ) : (
                        <div className="ml-auto h-1.5 w-10 rounded-full bg-zinc-700" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Run summary rail */}
        <div className="flex flex-col gap-4 bg-zinc-900/80 p-5">
          {STAT_LABELS.map((label) => (
            <div key={label} className="flex flex-col gap-1.5 border-l border-accent-500/40 pl-3">
              <span className="text-xs tracking-wide text-zinc-500 uppercase">{label}</span>
              <div className="h-2 w-14 rounded-full bg-zinc-700" />
            </div>
          ))}
          <div className="mt-auto rounded-md bg-accent-500/10 px-3 py-2 ring-1 ring-accent-500/25">
            <span className="text-xs font-semibold text-accent-400">Promotion gate</span>
            <p className="mt-0.5 text-xs leading-snug text-zinc-400">Copilots awaiting sign-off.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
