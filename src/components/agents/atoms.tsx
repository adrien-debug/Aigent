/**
 * Atomes de la surface Agents — composés à partir du kit `ui/`, jamais à côté.
 *
 * `src/components/ui/` ne se modifie pas et ne se double pas : il n'y a ici ni
 * badge maison, ni bouton, ni texte, ni surface générique. Ce fichier ne contient
 * que des COMPOSITIONS qui portent une règle métier que le kit ne connaît pas —
 * essentiellement les trois vocabulaires d'absence du produit.
 *
 * Les couleurs viennent de la palette `Badge` du kit `ui/`. Le choix qui compte :
 * `missing` n'est ni `emerald` (pass) ni `red` (fail) mais `amber`, et il porte
 * TOUJOURS son mot (« Non mesuré »). La couleur n'est jamais le seul porteur du
 * sens — un écran lu en niveaux de gris doit rester vrai.
 */
import type { ComponentProps, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { GateStatus } from '@/lib/agent-mission-control/release-gate'
import type { AvailableAgentStatus } from '@/lib/agent-mission-control/available-agents'
import {
  GATE_STATUS_LABEL,
  GATE_STATUS_MEANING,
  STAGE_DISPLAY_LABEL,
  type StageDisplay,
} from './evidence-model'
import {
  PROVIDER_WIRING_DETAIL,
  RUNTIME_STATUS_LABEL,
  RUNTIME_STATUS_MEANING,
  lifecycleStatusLabel,
  providerWiring,
  type ProviderWiring,
} from './roster-model'

type BadgeColor = ComponentProps<typeof Badge>['color']

/* ───────────────────────────── Statuts ───────────────────────────── */

const RUNTIME_STATUS_COLOR: Record<AvailableAgentStatus, BadgeColor> = {
  active: 'emerald',
  inactive: 'zinc',
  degraded: 'red',
  unavailable: 'amber',
}

/**
 * Le statut RUNTIME — ce que le catalogue prouve. Son `title` porte la
 * définition, parce que « Actif » sans sa définition laisse croire à un statut
 * posé à la main alors que c'est une dérivation.
 */
export function RuntimeStatusBadge({ status }: { status: AvailableAgentStatus }) {
  return (
    <Badge color={RUNTIME_STATUS_COLOR[status]} title={RUNTIME_STATUS_MEANING[status]}>
      {RUNTIME_STATUS_LABEL[status]}
    </Badge>
  )
}

const LIFECYCLE_STATUS_COLOR: Record<string, BadgeColor> = {
  active: 'emerald',
  paused: 'amber',
  draft: 'zinc',
  archived: 'zinc',
}

/**
 * Le statut de CYCLE DE VIE — la décision de l'opérateur, brute.
 *
 * Il vit à côté du statut runtime et jamais à sa place : un agent peut être
 * légitimement `draft` (cycle de vie) et `inactive` (runtime) au même instant,
 * et afficher un seul des deux en l'appelant « le » statut est précisément le
 * bug que le contrat canonique documente.
 */
export function LifecycleStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      color={LIFECYCLE_STATUS_COLOR[status] ?? 'zinc'}
      title="Statut de cycle de vie (colonne copilots.status) — la décision de l’opérateur, distincte de ce que le runtime peut prouver."
    >
      {lifecycleStatusLabel(status)}
    </Badge>
  )
}

/* ───────────────────────────── Gate ───────────────────────────── */

const GATE_COLOR: Record<GateStatus, BadgeColor> = {
  pass: 'emerald',
  fail: 'red',
  // Ni vert ni rouge : « non mesuré » est un troisième état, pas un demi-échec.
  missing: 'amber',
}

/** Un check de gate — trois états visuellement distincts, chacun avec son mot. */
export function GateStatusBadge({ status }: { status: GateStatus }) {
  return (
    <Badge color={GATE_COLOR[status]} title={GATE_STATUS_MEANING[status]}>
      {GATE_STATUS_LABEL[status]}
    </Badge>
  )
}

/* ───────────────────────── Cycle de vie ───────────────────────── */

const STAGE_COLOR: Record<StageDisplay, BadgeColor> = {
  reached: 'emerald',
  'not-reached': 'zinc',
  unknown: 'amber',
  // Une panne de lecture n'est pas une inconnue tranquille : elle a sa propre
  // couleur pour qu'un opérateur ne la confonde jamais avec « rien à signaler ».
  unavailable: 'orange',
}

/**
 * Une étape du cycle de vie. `unknown` est ambré et porte le mot « Inconnue »,
 * `unavailable` est orange et dit « Lecture impossible » — jamais un vert ni un
 * rouge, qui affirmeraient tous deux un fait qu'Aigent n'a pas lu.
 */
export function StageBadge({ display, title }: { display: StageDisplay; title?: string }) {
  return (
    <Badge color={STAGE_COLOR[display]} title={title}>
      {STAGE_DISPLAY_LABEL[display]}
    </Badge>
  )
}

/* ───────────────────────────── Provider ───────────────────────────── */

const WIRING_COLOR: Record<ProviderWiring, BadgeColor> = {
  wired: 'emerald',
  'opt-in': 'sky',
  'not-wired': 'red',
  unknown: 'zinc',
}

const WIRING_LABEL: Record<ProviderWiring, string> = {
  wired: 'câblé',
  'opt-in': 'opt-in',
  'not-wired': 'non câblé',
  unknown: 'câblage inconnu',
}

/**
 * Le provider ET son câblage réel. Un provider `null` ne devient jamais
 * « openai » : il se dit non résolu.
 */
export function ProviderBadge({ provider }: { provider: string | null }) {
  const wiring = providerWiring(provider)
  if (provider === null) {
    return (
      <Badge color="zinc" title={PROVIDER_WIRING_DETAIL.unknown}>
        provider non résolu
      </Badge>
    )
  }
  return (
    <Badge color={WIRING_COLOR[wiring]} title={PROVIDER_WIRING_DETAIL[wiring]}>
      {provider} · {WIRING_LABEL[wiring]}
    </Badge>
  )
}

/* ───────────────────────────── Absence ───────────────────────────── */

/**
 * Une valeur non mesurée, en ligne. Un seul mot, celui du produit entier
 * (`UNAVAILABLE_LABEL`), et un `title` qui dit POURQUOI c'est absent quand on le
 * sait — « non mesuré » et « lecture échouée » ne sont pas la même chose.
 */
export function NotMeasured({ why }: { why?: string }) {
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
 * Une paire libellé / valeur.
 *
 * `value === null` rend `NotMeasured` : c'est le contrat de cette fonction, et il
 * dispense chaque appelant de réécrire la garde (donc de l'oublier). Un `0`
 * mesuré reste un `0` — seul `null` est une absence.
 */
export function Fact({
  label,
  value,
  why,
  hint,
}: {
  label: string
  value: ReactNode | null
  /** Pourquoi c'est absent, quand `value` est `null`. */
  why?: string
  /** Précision affichée sous la valeur, quand elle existe. */
  hint?: string
}) {
  return (
    <div className="min-w-0">
      <Text className="truncate text-xs">{label}</Text>
      <div className="mt-0.5 min-w-0 truncate">
        {value === null ? <NotMeasured why={why} /> : value}
      </div>
      {hint ? <Text className="mt-0.5 truncate text-xs">{hint}</Text> : null}
    </div>
  )
}

/** Une valeur numérique/textuelle mise en avant dans un `Fact`. */
export function FactValue({ children }: { children: ReactNode }) {
  return <Strong className="tabular-nums">{children}</Strong>
}
