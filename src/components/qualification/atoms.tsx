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
 * Surface zinc Catalyst uniquement — le `tone` reste accepté pour compat API
 * mais ne colore plus l'encadré.
 */
export function Note({ title, children }: Readonly<NoteProps>) {
  return (
    <div className="rounded-lg border border-zinc-950/10 bg-zinc-950/2.5 px-3 py-2 dark:border-white/10 dark:bg-white/5">
      <Strong className="block">{title}</Strong>
      {children ? <Text className="mt-0.5">{children}</Text> : null}
    </div>
  )
}
