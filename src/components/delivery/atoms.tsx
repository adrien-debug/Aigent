/**
 * Atomes de la surface Livraison — composés à partir de Catalyst, jamais à côté.
 *
 * `src/components/ui/` ne se modifie pas et ne se double pas. Ce fichier ne
 * contient donc aucun badge maison, aucun bouton, aucune surface générique :
 * uniquement des COMPOSITIONS qui portent une règle métier que le kit ne connaît
 * pas.
 *
 * LE CHOIX QUI COMPTE SUR CETTE SURFACE
 * -------------------------------------
 * Les deux INCONNUES STRUCTURELLES (`merge inconnu`, `activation consommateur
 * inconnue`) ne sont ni vertes ni rouges : elles sont BLEUES, et elles portent
 * toujours le mot « structurel ». Une inconnue structurelle n'est pas un
 * problème à résoudre — c'est une frontière du produit. La peindre en rouge
 * apprendrait à l'opérateur à chercher une panne qui n'existe pas ; la peindre
 * en vert lui ferait croire à une confirmation qui n'a jamais eu lieu.
 *
 * Le FAIT MESURÉ (`aucune télémétrie consommateur`) est encore autre chose, et
 * il a sa propre couleur : la lecture a RÉUSSI et son résultat est « rien ».
 * C'est une information positive, pas une absence de mesure — et surtout pas la
 * même chose qu'une inconnue structurelle, même si les deux « ne montrent rien ».
 *
 * La couleur n'est jamais le seul porteur du sens : chaque état porte son mot et
 * son `title` explicatif.
 */
import type { ComponentProps, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { Fact, FactValue, NotMeasured } from '@/components/cockpit/primitives'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { SandboxCheckStatus, SandboxStatus } from '@/lib/agent-mission-control/target-repo-sandbox'
import type { DimensionStatus } from '@/lib/agent-mission-control/delivery-scorecard'

import type { DeliveryState, DeliveryStateKind } from './model'

export { Fact, FactValue, NotMeasured }

type BadgeColor = ComponentProps<typeof Badge>['color']

type DeliveryStateBadgeProps = { state: DeliveryState }
type StateKindTagProps = { kind: DeliveryStateKind }
type DeliveryStateRowProps = { state: DeliveryState }
type SandboxStatusBadgeProps = { status: SandboxStatus; title?: string }
type SandboxCheckBadgeProps = { status: SandboxCheckStatus; reason?: string }
type DimensionBadgeProps = { status: DimensionStatus }
type NoteProps = {
  tone?: 'info' | 'warn' | 'blocked' | 'structural'
  title: string
  children?: ReactNode
}

function noteRingClass(tone: NonNullable<NoteProps['tone']>): string {
  if (tone === 'blocked') return 'border-[#e8455f]/25 bg-[#e8455f]/5'
  if (tone === 'warn') return 'border-amber-400/25 bg-amber-400/5'
  if (tone === 'structural') return 'border-sky-400/25 bg-sky-400/5'
  return 'border-zinc-950/10 bg-zinc-950/2.5 dark:border-white/10 dark:bg-white/2.5'
}

function sandboxCheckTitle(status: SandboxCheckStatus, reason?: string): string | undefined {
  if (status !== 'skipped') return reason
  const suffix = reason ? ' (' + reason + ')' : ''
  return 'Ce check n’a RIEN mesuré' + suffix + ' — il n’est ni passé ni échoué.'
}

/* ═════════════════ Les huit états de livraison ═════════════════ */

/**
 * La couleur d'un état dépend de sa NATURE, pas de son caractère « bon » ou
 * « mauvais » — parce que la moitié de ces états ne sont ni l'un ni l'autre.
 */
const KIND_COLOR: Record<DeliveryStateKind, BadgeColor> = {
  // Un état de configuration ne juge rien : il décrit le serveur.
  configuration: 'zinc',
  // Un fait observé et atteint : c'est la seule chose qu'on ait le droit de
  // peindre en vert sur cette surface.
  observed: 'emerald',
  // Frontière du produit. Bleu, jamais rouge : ce n'est pas un échec.
  structural_unknown: 'sky',
  // Une lecture réussie dont le résultat est « rien ». Distincte d'une inconnue.
  measured_absence: 'purple',
}

const KIND_LABEL: Record<DeliveryStateKind, string> = {
  configuration: 'configuration',
  observed: 'observé',
  structural_unknown: 'inconnue structurelle',
  measured_absence: 'fait mesuré',
}

const KIND_MEANING: Record<DeliveryStateKind, string> = {
  configuration:
    'Un état de la configuration du serveur. Ni bon ni mauvais en soi — il dit ce que cet environnement peut faire.',
  observed: 'Un événement qui a réellement eu lieu et qu’Aigent a observé et persisté.',
  structural_unknown:
    'Aigent n’a AUCUN canal pour le savoir. Ce n’est pas un échec, ce n’est pas une donnée manquante : c’est une frontière du produit.',
  measured_absence:
    'Une lecture a RÉUSSI et son résultat est « rien ». C’est une information positive — l’exact opposé d’une inconnue.',
}

/**
 * Le badge d'un état.
 *
 * `reached === null` est rendu en `zinc` avec le mot du produit pour l'absence :
 * la question n'a pas pu être posée, ce qui n'est ni « atteint » ni
 * « non atteint ». Un `false` par défaut affirmerait le second.
 *
 * Un état ATTEINT garde la couleur de sa nature ; un état NON atteint retombe en
 * neutre — sauf les inconnues structurelles, qui sont vraies par construction et
 * ne peuvent pas être « non atteintes ».
 */
export function DeliveryStateBadge({ state }: Readonly<DeliveryStateBadgeProps>) {
  if (state.reached === null) {
    return (
      <Badge color="zinc" title={`${state.meaning}\n\nCette question n’a pas pu être posée : la lecture nécessaire n’a pas abouti.`}>
        {UNAVAILABLE_LABEL}
      </Badge>
    )
  }
  const color: BadgeColor = state.reached ? KIND_COLOR[state.kind] : 'zinc'
  return (
    <Badge color={color} title={`${state.meaning}\n\n(${KIND_LABEL[state.kind]}) ${KIND_MEANING[state.kind]}`}>
      {state.reached ? state.label : `Non — ${state.label.toLowerCase()}`}
    </Badge>
  )
}

/** Le mot qui qualifie la NATURE d'un état — affiché à côté de lui, jamais à sa place. */
export function StateKindTag({ kind }: Readonly<StateKindTagProps>) {
  return (
    <span
      className="text-3xs tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
      title={KIND_MEANING[kind]}
    >
      {KIND_LABEL[kind]}
    </span>
  )
}

/**
 * Une ligne d'état complète : le badge, la nature, la signification, la preuve.
 *
 * La PREUVE est le champ qui distingue cette surface d'un tableau de voyants.
 * `evidence === null` ne se rend pas comme une preuve vide : le composant dit
 * qu'aucune lecture n'a eu lieu.
 */
export function DeliveryStateRow({ state }: Readonly<DeliveryStateRowProps>) {
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <DeliveryStateBadge state={state} />
        <StateKindTag kind={state.kind} />
      </div>
      <Text className="mt-1.5">{state.meaning}</Text>
      <div className="mt-1">
        {state.evidence === null ? (
          <NotMeasured why="Aucune lecture n’a été effectuée pour cet état — ce n’est pas une preuve vide, c’est une absence de preuve." />
        ) : (
          <Text className="text-xs">
            <Strong>Preuve — </Strong>
            {state.evidence}
          </Text>
        )}
      </div>
    </div>
  )
}

/* ═════════════════ Sandbox ═════════════════ */

const SANDBOX_STATUS_COLOR: Record<SandboxStatus, BadgeColor> = {
  passed: 'emerald',
  warning: 'amber',
  failed: 'red',
}

const SANDBOX_STATUS_LABEL: Record<SandboxStatus, string> = {
  passed: 'Sandbox verte',
  warning: 'Sandbox avec réserves',
  failed: 'Sandbox rouge',
}

export function SandboxStatusBadge({ status, title }: Readonly<SandboxStatusBadgeProps>) {
  return (
    <Badge color={SANDBOX_STATUS_COLOR[status]} title={title}>
      {SANDBOX_STATUS_LABEL[status]}
    </Badge>
  )
}

const CHECK_COLOR: Record<SandboxCheckStatus, BadgeColor> = {
  passed: 'emerald',
  failed: 'red',
  warning: 'amber',
  // Un check « skipped » n'a rien mesuré. Neutre, jamais vert : en dry-run c'est
  // l'état de TOUS les scripts du dépôt cible, et un vert les ferait lire comme
  // « passés » alors qu'ils n'ont jamais tourné.
  skipped: 'zinc',
}

const CHECK_LABEL: Record<SandboxCheckStatus, string> = {
  passed: 'passé',
  failed: 'échoué',
  warning: 'réserve',
  skipped: 'non exécuté',
}

export function SandboxCheckBadge({ status, reason }: Readonly<SandboxCheckBadgeProps>) {
  return (
    <Badge
      color={CHECK_COLOR[status]}
      title={sandboxCheckTitle(status, reason)}
    >
      {CHECK_LABEL[status]}
    </Badge>
  )
}

/* ═════════════════ Scorecard ═════════════════ */

const DIMENSION_COLOR: Record<DimensionStatus, BadgeColor> = {
  pass: 'emerald',
  warn: 'amber',
  fail: 'red',
  // Ni vert ni rouge : « non mesuré » est un troisième état, pas un demi-échec.
  missing: 'zinc',
}

const DIMENSION_LABEL: Record<DimensionStatus, string> = {
  pass: 'passe',
  warn: 'réserve',
  fail: 'échoue',
  missing: 'non mesuré',
}

export function DimensionBadge({ status }: Readonly<DimensionBadgeProps>) {
  return (
    <Badge
      color={DIMENSION_COLOR[status]}
      title={
        status === 'missing'
          ? 'Cette dimension n’a jamais été mesurée. Son poids n’est PAS attribué — le score agrégé est donc plafonné, pas pénalisé.'
          : undefined
      }
    >
      {DIMENSION_LABEL[status]}
    </Badge>
  )
}

/**
 * Un encadré d'information — ni erreur ni succès.
 *
 * Le ton `structural` est propre à cette surface : il porte les deux inconnues
 * du produit. Il n'est ni `warn` ni `blocked`, parce qu'il n'y a rien à corriger.
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

/** Une date ISO → texte court et déterministe (UTC, sans locale). */
export function isoShort(iso: string | null | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
}
