import clsx from 'clsx'

/**
 * A static, decorative preview of the Agent Mission Control console — a
 * copilot registry with a run summary rail. Replaces the empty wireframe
 * placeholders that shipped with the marketing template. Pure markup, no
 * data, no interactivity: it is a product screenshot rendered in the DOM so
 * it stays crisp at any width and follows the accent/zinc token doctrine.
 */

const ROWS = [
  { name: 'support-triage', stage: 'Production', runs: '48.2k', pass: '99.4%', tone: 'live' },
  { name: 'invoice-extractor', stage: 'Production', runs: '31.7k', pass: '98.9%', tone: 'live' },
  { name: 'contract-reviewer', stage: 'Shadow', runs: '6.1k', pass: '97.2%', tone: 'shadow' },
  { name: 'onboarding-guide', stage: 'Draft', runs: '—', pass: '—', tone: 'draft' },
] as const

const STATS = [
  { label: 'Live copilots', value: '12' },
  { label: 'Runs today', value: '9,204' },
  { label: 'Gate pass rate', value: '99.1%' },
] as const

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

      <div className="grid gap-px bg-white/5 sm:grid-cols-[1fr_theme(spacing.48)]">
        {/* Registry table */}
        <div className="bg-zinc-900/80 p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-white">Copilots</span>
            <span className="text-xs text-zinc-500">4 of 12</span>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-[0.65rem] tracking-wide text-zinc-500 uppercase">
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
                  <td className="hidden py-2.5 pr-3 text-right font-mono text-zinc-400 tabular-nums sm:table-cell">
                    {row.runs}
                  </td>
                  <td className="py-2.5 text-right font-mono text-zinc-200 tabular-nums">{row.pass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Run summary rail */}
        <div className="flex flex-col gap-4 bg-zinc-900/80 p-5">
          {STATS.map((stat) => (
            <div key={stat.label} className="flex flex-col gap-0.5 border-l border-accent-500/40 pl-3">
              <span className="text-[0.65rem] tracking-wide text-zinc-500 uppercase">{stat.label}</span>
              <span className="font-mono text-lg font-semibold text-white tabular-nums">{stat.value}</span>
            </div>
          ))}
          <div className="mt-auto rounded-md bg-accent-500/10 px-3 py-2 ring-1 ring-accent-500/25">
            <span className="text-[0.65rem] font-semibold text-accent-400">Promotion gate</span>
            <p className="mt-0.5 text-[0.7rem] leading-snug text-zinc-400">1 copilot awaits sign-off.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
