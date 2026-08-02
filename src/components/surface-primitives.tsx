/**
 * Primitives de rendu produit — grammaire `aig-*` uniquement.
 *
 * À utiliser DANS `aig-inset` : pas de `Text`/`Strong`/`Badge` Catalyst ici.
 * Le kit reste pour le chrome (dialogs, forms) ; la donnée parle `--aig-*`
 * et `--aig-severity-*`.
 */
import clsx from 'clsx'
import type { ReactNode } from 'react'

export type SeverityTone = 'good' | 'running' | 'warn' | 'blocked' | 'bad' | 'neutral'

const CHIP_TONE: Record<SeverityTone, string> = {
  good: 'aig-chip-good',
  running: 'aig-chip-running',
  warn: 'aig-chip-warn',
  blocked: 'aig-chip-blocked',
  bad: 'aig-chip-bad',
  neutral: 'aig-chip-neutral',
}

export function SeverityChip({
  tone,
  title,
  children,
  className,
}: Readonly<{
  tone: SeverityTone
  title?: string
  children: ReactNode
  className?: string
}>) {
  return (
    <span title={title} className={clsx('aig-chip', CHIP_TONE[tone], className)}>
      {children}
    </span>
  )
}

export function SurfaceStat({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: ReactNode; hint?: string }>) {
  return (
    <div className="min-w-0">
      <p className="aig-text-faint truncate text-xs">{label}</p>
      <p className="aig-text mt-0.5 truncate tabular-nums font-medium">{value}</p>
      {hint ? <p className="aig-text-faint mt-0.5 truncate text-xs">{hint}</p> : null}
    </div>
  )
}

export function SurfaceSection({
  title,
  hint,
  children,
  className,
  actions,
}: Readonly<{
  title: string
  hint?: string
  children: ReactNode
  className?: string
  actions?: ReactNode
}>) {
  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="aig-h3 truncate">{title}</h3>
        {hint ? <p className="aig-text-faint truncate text-3xs">{hint}</p> : null}
        {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
      </div>
      <div className="aig-hairline my-2" />
      {children}
    </section>
  )
}

export function SurfaceCallout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="aig-callout">
      <p className="aig-text-muted text-sm">{children}</p>
    </div>
  )
}

/** Ligne titre + identifiant technique + pastilles + méta courte. */
export function SurfaceMetaRow({
  label,
  id,
  chips,
  meta,
}: Readonly<{
  label: string
  id?: string
  chips?: ReactNode
  meta?: ReactNode
}>) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="aig-text min-w-0 truncate font-medium">{label}</span>
      {id ? <code className="aig-text-muted text-xs">{id}</code> : null}
      {chips}
      {meta ? <span className="aig-text-faint text-xs">{meta}</span> : null}
    </div>
  )
}
