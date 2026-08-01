/**
 * Atomes de la surface Qualification — composés à partir de Catalyst, jamais à
 * côté.
 *
 * `src/components/ui/` ne se modifie pas à la légère et ne se double pas (gate
 * `check:ui-kit-integrity`). Ce fichier ne contient donc aucun badge maison,
 * aucun bouton, aucun texte, aucune surface générique : uniquement des
 * COMPOSITIONS qui portent une règle métier que le kit ne connaît pas.
 *
 * LE CHOIX QUI COMPTE : `missing` n'est ni `emerald` (pass) ni `red` (fail) mais
 * `amber`, et il porte TOUJOURS son mot (« Non mesuré »). Même règle pour
 * `INSUFFICIENT_EVIDENCE`, `NOT_AVAILABLE` et `NOT_CONFIGURED` — quatre
 * affirmations différentes, quatre rendus différents. La couleur n'est jamais le
 * seul porteur du sens.
 */
import type { ComponentProps, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import type { QualificationRunStatus } from '@/lib/agent-mission-control/qualification-orchestrator'
import { RUN_STATUS_LABEL, RUN_STATUS_MEANING } from './model'

type BadgeColor = ComponentProps<typeof Badge>['color']

type RunStatusBadgeProps = { status: QualificationRunStatus }
type NoteProps = {
  tone?: 'info' | 'warn' | 'blocked'
  title: string
  children?: ReactNode
}

/**
 * Le liseré et le fond d'un encadré, par ton.
 *
 * Les deux tons PORTEURS DE SENS (`blocked`, `warn`) gardent leur teinte : ici la
 * couleur double le mot, elle ne le remplace pas — c'est la règle de tête de
 * fichier. Le ton NEUTRE, lui, ne portait aucun sens : sa paire claire/sombre
 * (`bg-zinc-950/2.5 dark:bg-white/2.5`) était une décision de surface, et la
 * grammaire `aig-*` la nomme mieux — `aig-raised` est le rôle « ce qui ressort
 * du fond » et `aig-line` son liseré franc. Le scope `dark:` local est retiré :
 * le document entier est sombre depuis `layout.tsx`, la moitié claire ne se
 * rendait plus jamais.
 */
function noteRingClass(tone: NonNullable<NoteProps['tone']>): string {
  if (tone === 'blocked') return 'border-[#e8455f]/25 bg-[#e8455f]/5'
  if (tone === 'warn') return 'border-amber-400/25 bg-amber-400/5'
  return 'aig-raised aig-line'
}

/* ─────────────────── Gate de release — trois états ─────────────────── */

/* ─────────────────── Gate de promotion — quatre états ─────────────────── */

/* ─────────────────── Étapes de qualification ─────────────────── */

const RUN_STATUS_COLOR: Record<QualificationRunStatus, BadgeColor> = {
  running: 'sky',
  blocked: 'red',
  promotable: 'emerald',
  superseded: 'amber',
  aborted: 'amber',
}

export function RunStatusBadge({ status }: Readonly<RunStatusBadgeProps>) {
  return (
    <Badge color={RUN_STATUS_COLOR[status]} title={RUN_STATUS_MEANING[status]}>
      {RUN_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ─────────────────── Provenance d'une preuve ─────────────────── */

/* ─────────────────── Boucle d'amélioration ─────────────────── */

/* ─────────────────── Absence ─────────────────── */

/**
 * Un encadré d'information — ni erreur ni succès.
 *
 * Sert notamment à « une boucle est déjà ouverte » : c'est un FAIT du système,
 * garanti en base, pas une panne. Le rendre en rouge apprendrait à l'opérateur
 * qu'il a fait une bêtise alors qu'il a simplement rencontré un invariant.
 */
export function Note({ tone = 'info', title, children }: Readonly<NoteProps>) {
  const ring = noteRingClass(tone)
  return (
    <div className={'rounded-md border px-3 py-2 ' + ring}>
      <Strong className="block">{title}</Strong>
      {children ? <Text className="mt-0.5">{children}</Text> : null}
    </div>
  )
}
