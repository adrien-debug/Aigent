/**
 * Primitives runtime — réexporte le socle produit + ajouts spécifiques runtime.
 */
import type { ReactNode } from 'react'

import { Unavailable } from '@/components/cockpit/primitives'
import {
  SeverityChip,
  SurfaceCallout,
  SurfaceMetaRow,
  SurfaceSection,
  SurfaceStat,
} from '@/components/surface-primitives'
import { Badge } from '@/components/ui/badge'
import { Code, Text } from '@/components/ui/text'
import { SEVERITY_BADGE_COLOR, type SeverityTone } from '@/lib/ui/severity-badge'
import {
  PROVIDER_WIRING_LABEL,
  PROVIDER_WIRING_MEANING,
  type Loaded,
  type ProviderWiring,
} from './model'

export {
  SeverityChip,
  SurfaceCallout,
  SurfaceMetaRow,
  SurfaceSection,
  SurfaceStat,
}

const WIRING_TONE: Record<ProviderWiring, SeverityTone> = {
  wired: 'good',
  'wired-unconfigured': 'warn',
  'opt-in': 'running',
  'not-wired': 'neutral',
}

export function ProviderWiringChip({ wiring }: Readonly<{ wiring: ProviderWiring }>) {
  return (
    <Badge
      color={SEVERITY_BADGE_COLOR[WIRING_TONE[wiring]]}
      title={PROVIDER_WIRING_MEANING[wiring]}
    >
      {PROVIDER_WIRING_LABEL[wiring]}
    </Badge>
  )
}

export function SurfaceLoaded<T>({
  loaded,
  what,
  children,
}: Readonly<{
  loaded: Loaded<T>
  what: string
  children: (data: T) => ReactNode
}>) {
  if (!loaded.ok) {
    return (
      <div className="flex min-h-24 flex-col justify-center gap-2">
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

const ENV_PRESENCE_TITLE =
  'Seule la PRÉSENCE de cette variable est lue. Sa valeur n’est jamais affichée, loggée ni transportée jusqu’à cet écran.'

export function EnvVarList({ names }: Readonly<{ names: readonly string[] }>) {
  if (names.length === 0) {
    return (
      <Text className="mt-1.5 text-xs">
        Aucune variable d’environnement — il n’y a rien à configurer, il faudrait du code.
      </Text>
    )
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Text className="text-xs">Variables consultées :</Text>
      {names.map((name) => (
        <Code key={name} title={ENV_PRESENCE_TITLE}>
          {name}
        </Code>
      ))}
    </div>
  )
}
