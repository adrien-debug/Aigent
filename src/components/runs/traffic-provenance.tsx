/**
 * Bandeau de PROVENANCE du trafic — la distinction interne / consommateur.
 *
 * C'est l'affirmation la plus importante de cet écran, et la plus facile à
 * rendre fausse. La boucle produit d'Aigent est :
 *
 *     create → qualify → ship ──► le CONSOMMATEUR exécute l'agent
 *        ↑                                      │
 *        └──── improve ◄──── télémétrie ◄───────┘
 *
 * Le retour de boucle n'existe que si des agents DÉPLOYÉS chez des tiers
 * rapportent leurs runs. Un écran qui additionne les runs internes d'Aigent et
 * les runs consommateurs en un seul total dirait que la boucle est fermée alors
 * qu'elle ne l'est pas. Ce bandeau les sépare, toujours.
 *
 * QUATRE ÉTATS, JAMAIS CONFONDUS (`consumerChannelState`) :
 *  · `unread`        — la lecture des événements a échoué. On ne sait RIEN. Ce
 *                      n'est pas « zéro consommateur ».
 *  · `silent`        — lecture réussie, canal vide, toutes sources confondues.
 *  · `internal-only` — lecture réussie, du trafic existe, aucun consommateur.
 *                      C'est un FAIT MESURÉ : « aucun trafic consommateur
 *                      observé », pas « 0 run ».
 *  · `observed`      — au moins un événement consommateur est arrivé.
 *
 * La classification elle-même n'est pas refaite ici : elle appartient à
 * `classifyRuntimeTelemetryProvenance`, qui refuse de déduire « consommateur »
 * de l'absence de marqueur interne (inconnu tant que non prouvé).
 */
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { PROVENANCE_LABEL, consumerChannelState } from './run-view-model'
import type { ProvenanceBreakdown } from './run-view-model'

/** Le compteur d'une provenance. Un `0` ici est une mesure, pas une absence :
 *  la lecture a réussi et a compté zéro événement de cette source. */
function Count({
  label,
  value,
  accent,
}: Readonly<{ label: string; value: number; accent?: boolean }>) {
  return (
    <div className="min-w-0">
      <Text className="truncate text-xs uppercase">{label}</Text>
      <Strong className={accent ? 'aig-display tabular-nums' : 'tabular-nums'}>{value}</Strong>
    </div>
  )
}

export default function TrafficProvenance({
  breakdown,
}: Readonly<{
  /** `null` = la lecture du flux d'événements a ÉCHOUÉ. Jamais un flux vide. */
  breakdown: ProvenanceBreakdown | null
}>) {
  const state = consumerChannelState(breakdown)

  if (state === 'unread' || breakdown === null) {
    return (
      <div className="aig-quiet aig-line-soft min-w-0 border border-dashed px-3 py-2.5">
        <Badge color="zinc">Indisponible</Badge>
        <Text className="mt-1 block text-xs">
          Le flux d&apos;événements de télémétrie n&apos;a pas pu être lu. La part de trafic
          consommateur est donc <Strong>inconnue</Strong> — ce n&apos;est pas zéro.
        </Text>
      </div>
    )
  }

  if (state === 'silent') {
    return (
      <div className="aig-quiet aig-line-soft min-w-0 border border-dashed px-3 py-2.5">
        <Badge color="zinc">Aucune mesure</Badge>
        <Text className="mt-1 block text-xs">
          Le canal de télémétrie a été lu et ne contient <Strong>aucun événement</Strong>, toutes
          sources confondues. Absence mesurée, pas lecture manquée.
        </Text>
      </div>
    )
  }

  return (
    <div className="aig-quiet min-w-0 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {state === 'internal-only' ? (
          <Badge color="amber">Aucun trafic consommateur observé</Badge>
        ) : (
          <Badge color="emerald">Trafic consommateur observé</Badge>
        )}
        <Text className="tabular-nums">
          sur <Strong>{breakdown.total}</Strong> événement
          {breakdown.total > 1 ? 's' : ''} lu
          {breakdown.total > 1 ? 's' : ''}
        </Text>
      </div>

      <div className="aig-inset mt-2 grid grid-cols-2 gap-x-4 gap-y-2 p-2.5 sm:grid-cols-4">
        <Count label={PROVENANCE_LABEL.internal} value={breakdown.internal} />
        <Count label={PROVENANCE_LABEL.lifecycle} value={breakdown.lifecycle} />
        <Count label={PROVENANCE_LABEL.consumer} value={breakdown.consumer} accent />
        <Count label={PROVENANCE_LABEL.unknown} value={breakdown.unknown} />
      </div>

      {state === 'internal-only' ? (
        <Text className="mt-2 block text-xs">
          Tout le trafic lu provient d&apos;Aigent lui-même — runner interne, promotion, shadow,
          replay. <Strong>Aucun agent déployé chez un tiers n&apos;a rapporté de run.</Strong> La
          boucle d&apos;amélioration n&apos;est pas alimentée par le terrain : ce n&apos;est pas une
          panne de lecture, c&apos;est l&apos;état réel du canal.
        </Text>
      ) : null}
    </div>
  )
}
