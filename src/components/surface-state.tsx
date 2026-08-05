/**
 * États vides / chargement / indisponible — texte Catalyst uniquement.
 *
 * Pas d’illustration, pas d’animation, pas de SVG : le statut se lit en clair
 * (LABEL + détail), `role="status"` + `aria-live`.
 */
import type { ReactNode } from 'react'

import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

export type SurfaceStateKind = 'loading' | 'empty' | 'not-configured' | 'unavailable' | 'error'

const LABEL: Record<SurfaceStateKind, string> = {
  loading: 'Chargement',
  empty: 'Rien à afficher',
  'not-configured': 'Surface non configurée',
  unavailable: UNAVAILABLE_LABEL,
  error: 'Erreur',
}

export default function SurfaceState({
  kind,
  detail,
  action,
}: Readonly<{
  kind: SurfaceStateKind
  /** Ce qu'on sait, en clair. Jamais un secret, jamais une pile d'appels. */
  detail?: string | null
  /** Action sûre proposée à l'opérateur (lecture seule). Jamais un bouton inerte. */
  action?: ReactNode
}>) {
  return (
    <div
      role="status"
      aria-live={kind === 'loading' ? 'polite' : 'assertive'}
      className="flex min-h-32 flex-col items-start justify-center gap-2 py-6"
    >
      <Heading level={3}>{LABEL[kind]}</Heading>
      {detail ? <Text>{detail}</Text> : null}
      {action}
    </div>
  )
}
