import clsx from 'clsx'

/**
 * Status pill — fintech-premium doctrine: outline + solid dot, never a
 * filled color badge. No glow, no shadow — the dot alone carries the signal.
 */
export function StatusPill({ label, tone }: { label: string; tone: 'accent' | 'zinc' }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium tracking-widest uppercase ring-1 ring-white/10">
      <span
        aria-hidden="true"
        className={clsx('size-1.5 rounded-full', tone === 'accent' ? 'bg-accent-500' : 'bg-zinc-600')}
      />
      <span className={tone === 'accent' ? 'text-accent-300' : 'text-zinc-400'}>{label}</span>
    </span>
  )
}
