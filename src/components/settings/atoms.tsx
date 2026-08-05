/**
 * Atomes de la surface Réglages.
 *
 * RÈGLE UNIQUE DE CE FICHIER, ET LA PLUS IMPORTANTE DE LA SURFACE : aucune
 * valeur de secret n'entre ici. Ni jeton, ni clé, ni mot de passe — ni entier,
 * ni tronqué, ni masqué. Un préfixe de clé est une fuite, et un masque `sk-…`
 * révèle déjà le provider, la longueur et la forme.
 *
 * Ce que la surface montre d'un secret est un BOOLÉEN — configuré / non
 * configuré — éventuellement accompagné du NOM de sa variable d'environnement,
 * qui n'est pas un secret et qui est exactement ce dont un opérateur a besoin
 * pour agir. C'est la même position que celle déjà tenue, délibérément, par
 * l'onglet Télémétrie de `/runtime`.
 *
 * Les statuts passent par `Badge` Catalyst via `SEVERITY_BADGE_COLOR` : une
 * seule autorité visuelle de statut, et la couleur n'est jamais seule à porter
 * le sens — l'état est toujours écrit en toutes lettres.
 */
import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  DescriptionDetails,
  DescriptionList,
  DescriptionTerm,
} from '@/components/ui/description-list'
import { Code, Text } from '@/components/ui/text'
import type { SettingsConfigStatus } from '@/lib/agent-mission-control/settings-posture'
import { SEVERITY_BADGE_COLOR, type SeverityTone } from '@/lib/ui/severity-badge'

/**
 * Les quatre statuts du contrat, traduits une seule fois.
 *
 * `unavailable` et `not_configured` sont distincts à dessein : « configuré mais
 * injoignable » demande de réparer, « non configuré » demande de renseigner. Un
 * seul mot pour les deux enverrait l'opérateur au mauvais endroit.
 */
const STATUS_LABEL: Record<SettingsConfigStatus, string> = {
  configured: 'configuré',
  partial: 'partiel',
  unavailable: 'indisponible',
  not_configured: 'non configuré',
}

const STATUS_TONE: Record<SettingsConfigStatus, SeverityTone> = {
  configured: 'good',
  partial: 'warn',
  unavailable: 'bad',
  // Neutre, jamais rouge : une capacité non configurée n'est pas en panne.
  not_configured: 'neutral',
}

const STATUS_MEANING: Record<SettingsConfigStatus, string> = {
  configured: 'Configuré : la capacité est renseignée et, quand elle est sondée, elle répond.',
  partial: 'Partiel : une partie de la configuration manque — la capacité ne tiendra pas de bout en bout.',
  unavailable: 'Indisponible : la configuration est présente mais la source n’a pas répondu.',
  not_configured: 'Non configuré : la source n’existe pas dans cet environnement. Ce n’est pas une panne.',
}

export function StatusChip({ status }: Readonly<{ status: SettingsConfigStatus }>) {
  return (
    <Badge color={SEVERITY_BADGE_COLOR[STATUS_TONE[status]]} title={STATUS_MEANING[status]}>
      {STATUS_LABEL[status]}
    </Badge>
  )
}

/**
 * Une capacité : son nom, son statut, ce qu'on en sait, et sa provenance.
 *
 * `<dt>`/`<dd>` plutôt que deux `<div>` : une paire libellé/valeur est une liste
 * de définition, et un lecteur d'écran doit pouvoir associer les deux sans
 * dépendre de leur position à l'écran.
 */
export function CapabilityRow({
  label,
  status,
  message,
  provenance,
  children,
}: Readonly<{
  label: string
  status: SettingsConfigStatus
  message: string
  provenance: string
  children?: ReactNode
}>) {
  return (
    <div className="border-t border-zinc-950/5 px-4 py-3 first:border-t-0 dark:border-white/5">
      <DescriptionList className="min-w-0 sm:grid-cols-1">
        <DescriptionTerm className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-none pt-0 sm:border-none sm:py-0">
          <span className="min-w-0 truncate font-medium text-zinc-950 dark:text-white">{label}</span>
          <StatusChip status={status} />
        </DescriptionTerm>
        <DescriptionDetails className="min-w-0 border-none pt-1 pb-0 sm:border-none sm:py-0">
          <Text>{message}</Text>
          {children}
          <Text className="mt-1 text-xs">
            Source&nbsp;: <Code>{provenance}</Code>
          </Text>
        </DescriptionDetails>
      </DescriptionList>
    </div>
  )
}

/**
 * La cible d'un endpoint, quand elle n'est pas sensible.
 *
 * La valeur affichée a déjà traversé `sanitizeEndpoint()` côté serveur, qui
 * retire identifiant, mot de passe, query et fragment — les trois endroits où un
 * secret se cache dans une URL. On n'affiche donc qu'un hôte et un chemin.
 * `null` n'est pas rendu comme « — » : une cible non résolue se dit.
 */
export function EndpointLine({ endpoint }: Readonly<{ endpoint: string | null }>) {
  if (endpoint === null) {
    return (
      <Text className="mt-1 text-xs">
        Aucune cible résolue — l’endpoint n’est pas déterminable dans cet environnement.
      </Text>
    )
  }
  return (
    <Text className="mt-1 min-w-0 truncate text-xs">
      Cible&nbsp;: <Code title={endpoint}>{endpoint}</Code>
    </Text>
  )
}

const ENV_PRESENCE_TITLE =
  'Nom de la variable consultée. Cette surface n’affiche jamais sa valeur — seulement si elle est renseignée.'

/**
 * Les NOMS des variables consultées. Jamais leurs valeurs.
 *
 * Le nom est ce qui rend la page actionnable : « OPENAI_API_KEY est absent » dit
 * à l'opérateur quoi renseigner, sans rien révéler. Il n'y a aucune valeur dans
 * ce composant — il ne reçoit que des chaînes littérales décidées à la
 * compilation.
 */
export function EnvVarNames({ names }: Readonly<{ names: readonly string[] }>) {
  if (names.length === 0) return null
  return (
    // `min-w-0` + `break-all` : `flex-wrap` sait passer à la ligne ENTRE deux
    // puces, jamais À L'INTÉRIEUR d'une. Un nom comme
    // `GEMINI_API_KEY/GOOGLE_API_KEY` est un seul token insécable qui débordait
    // le viewport à 390 px — et le débordement était CLIPPÉ, donc ni scrollable
    // ni lisible : le nom apparaissait coupé (« GEMINI_API_KEY/GOOGLE_A »), ce
    // qui rend la surface inutilisable là où elle est censée dire quoi
    // renseigner.
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <Text className="text-xs">Variables consultées&nbsp;:</Text>
      {names.map((name) => (
        <Code key={name} className="min-w-0 break-all" title={ENV_PRESENCE_TITLE}>
          {name}
        </Code>
      ))}
    </div>
  )
}
