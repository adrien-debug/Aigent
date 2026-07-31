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
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { GateStatus } from '@/lib/agent-mission-control/release-gate'
import type { PromotionCheckStatus } from '@/lib/agent-mission-control/promotion-gate'
import type {
  QualificationRunStatus,
  QualificationStepStatus,
} from '@/lib/agent-mission-control/qualification-orchestrator'
import type { ImprovementProposal } from '@/lib/agent-mission-control/improvement-loop'
import {
  EXECUTION_MODE_DETAIL,
  EXECUTION_MODE_LABEL,
  GATE_STATUS_LABEL,
  GATE_STATUS_MEANING,
  PROMOTION_STATUS_LABEL,
  PROMOTION_STATUS_MEANING,
  PROPOSAL_STATUS_LABEL,
  RUN_STATUS_LABEL,
  RUN_STATUS_MEANING,
  STEP_STATUS_LABEL,
  STEP_STATUS_MEANING,
  type EvidenceExecutionMode,
} from './model'

type BadgeColor = ComponentProps<typeof Badge>['color']

type GateStatusBadgeProps = { status: GateStatus }
type PromotionStatusBadgeProps = { status: PromotionCheckStatus }
type StepStatusBadgeProps = { status: QualificationStepStatus }
type RunStatusBadgeProps = { status: QualificationRunStatus }
type ExecutionModeBadgeProps = { mode: EvidenceExecutionMode }
type ProposalStatusBadgeProps = { status: ImprovementProposal['status'] }
type NotMeasuredProps = { why?: string }
type FactProps = {
  label: string
  value: ReactNode | null
  why?: string
  hint?: string
}
type FactValueProps = { children: ReactNode }
type NoteProps = {
  tone?: 'info' | 'warn' | 'blocked'
  title: string
  children?: ReactNode
}

function noteRingClass(tone: NonNullable<NoteProps['tone']>): string {
  if (tone === 'blocked') return 'border-[#e8455f]/25 bg-[#e8455f]/5'
  if (tone === 'warn') return 'border-amber-400/25 bg-amber-400/5'
  return 'border-zinc-950/10 bg-zinc-950/[0.025] dark:border-white/10 dark:bg-white/[0.025]'
}

/* ─────────────────── Gate de release — trois états ─────────────────── */

const GATE_COLOR: Record<GateStatus, BadgeColor> = {
  pass: 'emerald',
  fail: 'red',
  // Ni vert ni rouge : « non mesuré » est un troisième état, pas un demi-échec.
  missing: 'amber',
}

export function GateStatusBadge({ status }: GateStatusBadgeProps) {
  return (
    <Badge color={GATE_COLOR[status]} title={GATE_STATUS_MEANING[status]}>
      {GATE_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ─────────────────── Gate de promotion — quatre états ─────────────────── */

const PROMOTION_COLOR: Record<PromotionCheckStatus, BadgeColor> = {
  PASS: 'emerald',
  FAIL: 'red',
  // « non exigé » n'accuse rien et ne prouve rien : un ton neutre, pas un vert.
  NOT_CONFIGURED: 'zinc',
  INSUFFICIENT_EVIDENCE: 'amber',
}

export function PromotionStatusBadge({ status }: PromotionStatusBadgeProps) {
  return (
    <Badge color={PROMOTION_COLOR[status]} title={PROMOTION_STATUS_MEANING[status]}>
      {PROMOTION_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ─────────────────── Étapes de qualification ─────────────────── */

const STEP_COLOR: Record<QualificationStepStatus, BadgeColor> = {
  PASS: 'emerald',
  FAIL: 'red',
  NOT_CONFIGURED: 'zinc',
  // Capacité non câblée : une absence de MOTEUR, pas une absence de preuve.
  NOT_AVAILABLE: 'sky',
  INSUFFICIENT_EVIDENCE: 'amber',
  PENDING: 'zinc',
}

export function StepStatusBadge({ status }: StepStatusBadgeProps) {
  return (
    <Badge color={STEP_COLOR[status]} title={STEP_STATUS_MEANING[status]}>
      {STEP_STATUS_LABEL[status]}
    </Badge>
  )
}

const RUN_STATUS_COLOR: Record<QualificationRunStatus, BadgeColor> = {
  running: 'sky',
  blocked: 'red',
  promotable: 'emerald',
  superseded: 'amber',
  aborted: 'amber',
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  return (
    <Badge color={RUN_STATUS_COLOR[status]} title={RUN_STATUS_MEANING[status]}>
      {RUN_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ─────────────────── Provenance d'une preuve ─────────────────── */

const EXECUTION_MODE_COLOR: Record<EvidenceExecutionMode, BadgeColor> = {
  live_langgraph: 'emerald',
  // Une simulation est BLEUE, jamais verte : elle prouve la mécanique, pas le
  // candidat, et un vert la ferait lire comme une preuve de production.
  deterministic_fixture: 'sky',
  legacy_unknown: 'zinc',
}

export function ExecutionModeBadge({ mode }: ExecutionModeBadgeProps) {
  return (
    <Badge color={EXECUTION_MODE_COLOR[mode]} title={EXECUTION_MODE_DETAIL[mode]}>
      {EXECUTION_MODE_LABEL[mode]}
    </Badge>
  )
}

/* ─────────────────── Boucle d'amélioration ─────────────────── */

const PROPOSAL_COLOR: Record<ImprovementProposal['status'], BadgeColor> = {
  proposed: 'amber',
  'v2-created': 'amber',
  approved: 'emerald',
  rejected: 'zinc',
}

export function ProposalStatusBadge({ status }: ProposalStatusBadgeProps) {
  return (
    <Badge
      color={PROPOSAL_COLOR[status]}
      title="État de la boucle d’amélioration. Tant qu’elle n’est ni approuvée ni rejetée, elle est OUVERTE — et la base n’en tolère qu’une seule ouverte par copilot."
    >
      {PROPOSAL_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ─────────────────── Absence ─────────────────── */

/**
 * Une valeur non mesurée, en ligne. Un seul mot — celui du produit entier — et
 * un `title` qui dit POURQUOI quand on le sait : « non mesuré » et « lecture
 * échouée » ne sont pas la même chose.
 */
export function NotMeasured({ why }: NotMeasuredProps) {
  return (
    <span
      className="text-xs text-zinc-500 uppercase dark:text-zinc-400"
      title={why ?? 'Cette valeur n’a jamais été mesurée — elle n’est pas nulle, elle est absente.'}
    >
      {UNAVAILABLE_LABEL}
    </span>
  )
}

/**
 * Une paire libellé / valeur. `value === null` rend `NotMeasured` : c'est le
 * contrat de ce composant, et il dispense chaque appelant de réécrire la garde
 * (donc de l'oublier). Un `0` mesuré reste un `0` — seul `null` est une absence.
 */
export function Fact({ label, value, why, hint }: FactProps) {
  return (
    <div className="min-w-0">
      <Text className="truncate text-xs">{label}</Text>
      <div className="mt-0.5 min-w-0 truncate">{value === null ? <NotMeasured why={why} /> : value}</div>
      {hint ? <Text className="mt-0.5 truncate text-xs">{hint}</Text> : null}
    </div>
  )
}

/** Une valeur mise en avant dans un `Fact`. */
export function FactValue({ children }: FactValueProps) {
  return <Strong className="tabular-nums">{children}</Strong>
}

/**
 * Un encadré d'information — ni erreur ni succès.
 *
 * Sert notamment à « une boucle est déjà ouverte » : c'est un FAIT du système,
 * garanti en base, pas une panne. Le rendre en rouge apprendrait à l'opérateur
 * qu'il a fait une bêtise alors qu'il a simplement rencontré un invariant.
 */
export function Note({ tone = 'info', title, children }: NoteProps) {
  const ring = noteRingClass(tone)
  return (
    <div className={'rounded-md border px-3 py-2 ' + ring}>
      <Strong className="block">{title}</Strong>
      {children ? <Text className="mt-0.5">{children}</Text> : null}
    </div>
  )
}

/** Une date ISO → texte court et déterministe (UTC, sans locale). */
export function isoShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
}
