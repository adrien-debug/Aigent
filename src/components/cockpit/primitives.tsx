/**
 * Primitives du cockpit — bâties SUR Catalyst, pas à côté.
 *
 * Le vocabulaire visuel (typographie, tons, focus) vient du kit vendoré dans
 * `src/components/ui/`. Ce fichier n'ajoute que ce que Catalyst ne fournit pas :
 * le cadre de panneau à hauteur bornée, et l'état d'absence de mesure.
 *
 * Règle structurante : une box a une hauteur BORNÉE et ne grandit jamais avec la
 * donnée — c'est la donnée qui scrolle à l'intérieur. Sans ça, un cockpit « sans
 * scroll » se remet à scroller dès que la flotte grossit.
 *
 * Règle de vérité : `Unavailable` est un état visuel de premier rang, pas un
 * fallback discret. Une mesure absente se DIT ; elle ne se peint pas en zéro.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import { Badge } from '@/components/ui/badge'
import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

/** Cadre de panneau : hauteur imposée par la grille, contenu borné. */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  /** Contrainte de hauteur imposée par la grille du cockpit (ex. `h-44 shrink-0`). */
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={clsx(
        'flex min-h-0 flex-col rounded-xl bg-white/[0.03] ring-1 ring-white/10',
        className,
      )}
    >
      <header className="flex shrink-0 items-baseline justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <Subheading level={2} className="shrink-0 whitespace-nowrap !text-xs !font-semibold !text-zinc-300">
          {title}
        </Subheading>
        {hint ? <Text className="truncate !text-xs !text-zinc-500">{hint}</Text> : null}
        {actions}
      </header>
      <div className={clsx('min-h-0 flex-1', bodyClassName ?? 'p-3')}>{children}</div>
    </section>
  )
}

/**
 * Absence de mesure. Deux raisons distinctes, jamais confondues :
 *  · `reason="unread"`  — la lecture a échoué (backend muet).
 *  · `reason="no-data"` — la lecture a réussi, il n'y avait rien à mesurer.
 */
export function Unavailable({
  reason = 'unread',
  detail,
  compact = false,
}: {
  reason?: 'unread' | 'no-data'
  detail?: string
  compact?: boolean
}) {
  const label = reason === 'unread' ? UNAVAILABLE_LABEL : 'Aucune mesure'
  return (
    <div
      className={clsx(
        'flex h-full flex-col items-center justify-center gap-1.5 rounded-lg',
        // Hachures : lisible au premier coup d'œil comme « ce n'est pas une valeur ».
        'bg-[repeating-linear-gradient(135deg,transparent,transparent_5px,rgba(255,255,255,0.045)_5px,rgba(255,255,255,0.045)_10px)]',
        compact ? 'px-2 py-1' : 'p-4',
      )}
    >
      <Badge color="zinc">{label}</Badge>
      {detail && !compact ? (
        <Text className="max-w-[30ch] text-center !text-xs !leading-tight !text-zinc-500">{detail}</Text>
      ) : null}
    </div>
  )
}

/** Le ton d'un KPI — traduit en couleur de Badge Catalyst. */
export type KpiTone = 'neutral' | 'good' | 'warn' | 'bad'

const TONE_VALUE: Record<KpiTone, string> = {
  neutral: 'text-white',
  good: 'text-emerald-300',
  warn: 'text-amber-300',
  bad: 'text-rose-300',
}

/**
 * Tuile KPI, dans l'esprit du `Stat` de Catalyst mais bornée en hauteur pour la
 * grille du cockpit. `value === null` signifie NON MESURÉ : la tuile bascule en
 * indisponible plutôt que d'afficher un 0 rassurant.
 *
 * Aucun mini-graphique inline — un chiffre, son unité, son support.
 */
export function Kpi({
  label,
  value,
  unit,
  support,
  tone = 'neutral',
  unavailableReason = 'unread',
}: {
  label: string
  value: string | number | null
  unit?: string
  support?: string
  tone?: KpiTone
  unavailableReason?: 'unread' | 'no-data'
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/10">
      <Text className="truncate !text-xs !font-medium !text-zinc-400">{label}</Text>
      {value === null ? (
        <div className="mt-1.5 flex-1">
          <Unavailable reason={unavailableReason} compact />
        </div>
      ) : (
        <p className="mt-1.5 flex items-baseline gap-1">
          <span className={clsx('truncate text-2xl/8 font-semibold tabular-nums', TONE_VALUE[tone])}>
            {value}
          </span>
          {unit ? <span className="text-xs/6 text-zinc-500">{unit}</span> : null}
        </p>
      )}
      <Text className="mt-1 truncate !text-xs !text-zinc-500">{support ?? ' '}</Text>
    </div>
  )
}
