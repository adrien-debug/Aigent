/**
 * Compositions Catalyst pour les surfaces produit — pas de grammaire `aig-chip`.
 *
 * Une seule autorité visuelle de statut : `Badge`. `SeverityChip` n’est qu’un
 * alias mince (blast radius) qui rend `Badge` via `SEVERITY_BADGE_COLOR`.
 */
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Code, Strong, Text } from '@/components/ui/text'
import {
  SEVERITY_BADGE_COLOR,
  type SeverityTone,
} from '@/lib/ui/severity-badge'

export type { SeverityTone }

/** Alias temporaire — rend `Badge` Catalyst, pas `aig-chip`. */
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
    <Badge color={SEVERITY_BADGE_COLOR[tone]} title={title} className={className}>
      {children}
    </Badge>
  )
}

export function SurfaceStat({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: ReactNode; hint?: string }>) {
  return (
    <div className="min-w-0">
      <Text className="truncate text-xs">{label}</Text>
      <Strong className="mt-0.5 block truncate tabular-nums">{value}</Strong>
      {hint ? <Text className="mt-0.5 truncate text-xs">{hint}</Text> : null}
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
        <Subheading level={3} className="truncate">
          {title}
        </Subheading>
        {hint ? <Text className="truncate text-xs">{hint}</Text> : null}
        {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
      </div>
      <Divider soft className="my-2" />
      {children}
    </section>
  )
}

export function SurfaceCallout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="rounded-lg border border-zinc-950/10 p-3 dark:border-white/10">
      <Text>{children}</Text>
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
      <Text className="min-w-0 truncate font-medium text-zinc-950 dark:text-white">{label}</Text>
      {id ? <Code>{id}</Code> : null}
      {chips}
      {meta ? <Text className="text-xs">{meta}</Text> : null}
    </div>
  )
}
