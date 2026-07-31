/**
 * Atomes de la surface Runtime — des COMPOSITIONS de Catalyst, jamais des
 * doublons de Catalyst.
 *
 * `src/components/ui/` ne se modifie pas et ne se réimplémente pas ici. Ce
 * fichier ne contient que ce que le kit ne sait pas dire : le câblage d'un
 * provider, le piège de l'assistant, la nature fail-closed d'un outil, et une
 * lecture échouée rendue comme telle.
 *
 * Chaque badge porte son `title` explicatif. La couleur n'est jamais le seul
 * porteur du sens : un écran lu en niveaux de gris reste vrai, et « non câblé »
 * s'écrit en toutes lettres plutôt que de se déduire d'un gris.
 */
import type { ComponentProps, ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import { Unavailable } from '@/components/cockpit/primitives'
import {
  MUTATION_MEANING,
  PROVIDER_WIRING_LABEL,
  PROVIDER_WIRING_MEANING,
  PROVISIONING_LABEL,
  PROVISIONING_MEANING,
  mutationLabel,
  provisioningState,
  type Loaded,
  type ProviderWiring,
} from './model'

type BadgeColor = ComponentProps<typeof Badge>['color']

/* ───────────────────────────── Absences ──────────────────────────────── */

/** Une valeur non mesurée, en ligne. Jamais un `0` à la place. */
export function NotMeasured({ why }: Readonly<{ why?: string }>) {
  return (
    <span
      className="text-xs text-zinc-500 uppercase dark:text-zinc-400"
      title={why ?? 'Cette valeur n’a pas été mesurée — elle n’est pas nulle, elle est absente.'}
    >
      {UNAVAILABLE_LABEL}
    </span>
  )
}

/**
 * Une paire libellé / valeur. `value === null` rend `NotMeasured` : la garde est
 * dans la fonction, donc aucun appelant ne peut l'oublier. Un `0` mesuré reste
 * un `0` — seul `null` est une absence.
 */
export function Fact({
  label,
  value,
  why,
  hint,
}: Readonly<{
  label: string
  value: ReactNode | null
  why?: string
  hint?: string
}>) {
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

export function FactValue({ children }: Readonly<{ children: ReactNode }>) {
  return <Strong className="tabular-nums">{children}</Strong>
}

/**
 * Le rendu d'un `Loaded<T>` : succès → `children`, échec → l'échec DIT.
 *
 * C'est le seul point de passage autorisé pour afficher une lecture de cette
 * surface. Il rend structurellement impossible le raccourci « catch → liste
 * vide », parce qu'aucun appelant n'a la liste vide sous la main dans la branche
 * d'échec.
 */
export function LoadedBlock<T>({
  loaded,
  what,
  children,
}: Readonly<{
  loaded: Loaded<T>
  /** Ce qui n'a pas pu être lu, à la première personne du panneau. */
  what: string
  children: (data: T) => ReactNode
}>) {
  if (!loaded.ok) {
    return (
      <div className="flex h-full min-h-32 flex-col justify-center gap-2">
        <Unavailable
          reason="unread"
          detail={`${what} n’a pas pu être lu. Rien n’est listé : une liste vide se lirait comme « il n’y a rien », ce qui n’est pas ce qui est su.`}
        />
        <Text className="truncate text-center text-xs" title={loaded.reason}>
          {loaded.reason}
        </Text>
      </div>
    )
  }
  return <>{children(loaded.data)}</>
}

/** La lecture a réussi et n'a rien rendu — un vide PROUVÉ, pas une panne. */
export function ProvenEmpty({ detail }: Readonly<{ detail: string }>) {
  return <Unavailable reason="no-data" detail={detail} />
}

/* ──────────────────────────── Câblage provider ───────────────────────── */

const WIRING_COLOR: Record<ProviderWiring, BadgeColor> = {
  wired: 'emerald',
  'wired-unconfigured': 'amber',
  'opt-in': 'sky',
  'not-wired': 'zinc',
}

/**
 * L'état de câblage d'un provider.
 *
 * `not-wired` est délibérément `zinc` et non `red` : Mistral n'est pas EN PANNE,
 * il n'est pas implémenté. Le rouge dirait « quelque chose est cassé, répare-le ».
 */
export function ProviderWiringBadge({ wiring }: Readonly<{ wiring: ProviderWiring }>) {
  return (
    <Badge color={WIRING_COLOR[wiring]} title={PROVIDER_WIRING_MEANING[wiring]}>
      {PROVIDER_WIRING_LABEL[wiring]}
    </Badge>
  )
}

/* ──────────────────────── Provisioning d'un agent ────────────────────── */

/**
 * Le piège de l'assistant.
 *
 * `not-applicable` ne rend RIEN. Afficher un badge neutre sur un runtime qui ne
 * provisionne jamais d'assistant transformerait un « sans objet » en signal, et
 * la surface se mettrait à clignoter sur des agents parfaitement sains.
 */
export function ProvisioningBadge({ runtimeProvisioned }: Readonly<{ runtimeProvisioned: boolean | null }>) {
  const state = provisioningState(runtimeProvisioned)
  if (state === 'not-applicable') return null
  return (
    <Badge
      color={state === 'provisioned' ? 'emerald' : 'amber'}
      title={PROVISIONING_MEANING[state]}
    >
      {PROVISIONING_LABEL[state]}
    </Badge>
  )
}

/* ────────────────────────────── Outils ───────────────────────────────── */

/** La nature d'un outil, fail-closed : le doute s'affiche comme une mutation. */
export function MutationBadge({ mutates }: Readonly<{ mutates: boolean }>) {
  return (
    <Badge
      color={mutates ? 'amber' : 'zinc'}
      title={mutates ? MUTATION_MEANING.mutating : MUTATION_MEANING.readOnly}
    >
      {mutationLabel(mutates)}
    </Badge>
  )
}

const RISK_COLOR: Record<string, BadgeColor> = {
  low: 'zinc',
  medium: 'amber',
  high: 'red',
}

/**
 * Le risque déclaré. Un niveau inconnu est traité comme le PIRE — un registre
 * qui gagnerait un niveau `critical` ne doit pas l'afficher en gris rassurant.
 */
export function RiskBadge({ risk }: Readonly<{ risk: string }>) {
  const known = risk in RISK_COLOR
  return (
    <Badge
      color={known ? RISK_COLOR[risk] : 'red'}
      title={
        known
          ? `Risque déclaré au registre canonique : ${risk}.`
          : `Niveau de risque « ${risk} » inconnu de cet écran — présenté au niveau le plus élevé par défaut plutôt qu’au plus bas.`
      }
    >
      risque {risk}
    </Badge>
  )
}

/** Confirmation humaine exigée avant l'appel. Absent = pas de badge. */
export function ConfirmationBadge({ required }: Readonly<{ required: boolean }>) {
  if (!required) return null
  return (
    <Badge
      color="sky"
      title="Le graphe interrompt le run avant cet appel et attend une confirmation humaine explicite (interrupt/resume)."
    >
      confirmation requise
    </Badge>
  )
}
