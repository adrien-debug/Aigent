import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

export function ScreenHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Heading>{title}</Heading>
        <Text className="mt-1">{description}</Text>
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </div>
  )
}

export function Metric({
  label,
  value,
  detail,
}: {
  label: string
  value: React.ReactNode
  detail: string
}) {
  return (
    <div className="min-w-0 px-5 py-4 first:pl-0 last:pr-0 sm:px-6">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl/8 font-light tabular-nums text-white">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{detail}</p>
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  className = '',
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-white/8 bg-zinc-900 shadow-sm ${className}`}>
      <div className="border-b border-white/8 px-5 py-4 sm:px-6">
        <Heading level={2} className="text-sm/6">{title}</Heading>
        {description ? <p className="mt-1 text-xs text-zinc-400">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}
