/**
 * Le BANC de livraison — une ligne par agent, à hauteur bornée, la liste défile
 * DANS sa box.
 *
 * Server Component : il reçoit des lectures déjà faites et les distribue. Il ne
 * lit rien lui-même, ne recalcule aucun état, et n'appelle AUCUNE route mutante.
 *
 * CE QUE CET ÉCRAN REFUSE DE FAIRE
 * --------------------------------
 * Additionner « jamais livré » et « pas pu lire ». `agent_delivery_events` porte
 * UNE ligne dans cette base : la quasi-totalité du banc est donc légitimement
 * « jamais livré », et c'est un fait qu'on affiche comme tel. Mais une table
 * muette produirait EXACTEMENT le même pixel si on ne séparait pas les deux —
 * et l'écran annoncerait sereinement « 12 agents jamais livrés » sans avoir lu
 * quoi que ce soit. Chaque ligne porte donc `deliveryRead`, et le bandeau compte
 * les non-lues à part.
 *
 * Chaque ligne mène à `/delivery/[copilotId]` — un lien réel, jamais un `#`.
 */
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Avatar } from '@/components/ui/avatar'
import { Panel, Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'

import { Note, isoShort } from './atoms'
import {
  countDeliveryRows,
  deliveryModeLabel,
  sortDeliveryRows,
  type DeliveryRow,
} from './model'
import type { ConsumerTelemetryFact } from './server-reads'

type DeliveryRosterRowProps = { row: DeliveryRow }

type DeliveryRosterScreenProps = {
  rows: DeliveryRow[]
  deliveryReadFailures: number
  telemetry: ConsumerTelemetryFact | null
  telemetryFailure: string | null
  realDeliveryEnabled: boolean
}

/** Une ligne NON LUE porte un rail ambre : elle n'est ni livrée ni non livrée. */
function rosterRailColor(deliveryRead: boolean, hasDelivery: boolean): string {
  if (!deliveryRead) return SEVERITY.warn
  if (hasDelivery) return SEVERITY.good
  return SEVERITY.muted
}

type DeliveryStatusBadgeProps = { deliveryRead: boolean; hasDelivery: boolean }

type RosterTelemetryNoteProps = {
  telemetry: ConsumerTelemetryFact | null
  telemetryFailure: string | null
}

function DeliveryStatusBadge({ deliveryRead, hasDelivery }: Readonly<DeliveryStatusBadgeProps>) {
  if (!deliveryRead) {
    return (
      <Badge
        color="amber"
        title="La lecture de l’événement de livraison a ÉCHOUÉ pour cette ligne. On ne sait pas si cet agent a été livré — ce n’est pas « jamais livré »."
      >
        livraison non lue
      </Badge>
    )
  }
  if (hasDelivery) {
    return (
      <Badge color="emerald" title="Un événement de livraison RÉEL est persisté pour cet agent.">
        livré
      </Badge>
    )
  }
  return (
    <Badge
      color="zinc"
      title="La lecture a réussi et aucun événement de livraison n’existe pour cet agent. Fait mesuré, pas une panne."
    >
      jamais livré
    </Badge>
  )
}

function RosterTelemetryNote({ telemetry, telemetryFailure }: Readonly<RosterTelemetryNoteProps>) {
  if (telemetryFailure !== null) {
    return (
      <Note tone="warn" title="Télémétrie non lue">
        Impossible de dire si un agent déployé a rapporté un run — la lecture a échoué.
        {' ' + telemetryFailure}
      </Note>
    )
  }
  if (telemetry === null) {
    return (
      <Note tone="warn" title="Télémétrie non lue">
        Aucune lecture de télémétrie n’a abouti. Aucun chiffre n’est affiché à la place.
      </Note>
    )
  }
  if (telemetry.consumerCount === 0) {
    return (
      <Note tone="structural" title="Aucun agent déployé n’a jamais rapporté de run">
        La table de télémétrie a été LUE : sur {telemetry.scannedCount} événement(s), aucun ne porte
        une provenance « consumer ». C’est un fait mesuré, pas un panneau vide. Le flux est à sens
        unique — Aigent pousse des agents, et rien ne revient.
      </Note>
    )
  }
  return (
    <Note tone="info" title="Des agents déployés ont rapporté des runs">
      {telemetry.consumerCount} événement(s) de provenance « consumer » sur{' '}
      {telemetry.scannedCount} lu(s).
    </Note>
  )
}

function DeliveryRosterRow({ row }: Readonly<DeliveryRosterRowProps>) {
  const d = row.latestDelivery

  // Trois situations, trois rendus. La troisième — « non lue » — est celle qui
  // disparaît toujours en premier quand on n'y prend pas garde.
  const rail = rosterRailColor(row.deliveryRead, d !== null)

  return (
    <li className="relative">
      <Rail color={rail} />
      <Link
        href={'/delivery/' + row.copilotId}
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:bg-zinc-950/2.5 dark:hover:bg-white/2.5"
      >
        <Avatar square initials={initialsOf(row.copilotName)} className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Strong className="truncate">{row.copilotName}</Strong>

            <DeliveryStatusBadge deliveryRead={row.deliveryRead} hasDelivery={d !== null} />

            {d?.prUrl != null ? (
              <Badge
                color="sky"
                title="Une PR a été ouverte. Aigent ne relit PAS son état de merge — ouverte ne veut pas dire mergée."
              >
                PR {d.prNumber !== null ? `#${d.prNumber}` : 'ouverte'}
              </Badge>
            ) : null}

            {row.repoFullName === null ? (
              <Badge
                color="zinc"
                title="Aucun dépôt cible n’est rattaché au projet de cet agent. Une livraison y est IMPOSSIBLE — ce n’est pas une livraison « en attente »."
              >
                pas de dépôt cible
              </Badge>
            ) : null}
          </div>

          <Text className="truncate">
            {row.repoFullName ?? 'aucun dépôt cible'}
            {row.projectName ? ' · ' + row.projectName : ''}
            {d !== null
              ? ` · ${deliveryModeLabel(d.mode) ?? d.mode} · ${isoShort(d.createdAt) ?? 'date non enregistrée'}`
              : ''}
          </Text>
        </div>
      </Link>
    </li>
  )
}

export default function DeliveryRosterScreen({
  rows,
  deliveryReadFailures,
  telemetry,
  telemetryFailure,
  realDeliveryEnabled,
}: Readonly<DeliveryRosterScreenProps>) {
  const counts = countDeliveryRows(rows)
  const ranked = sortDeliveryRows(rows)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4 max-lg:pl-14 xl:overflow-hidden">
      {/* Bandeau de comptage — dérivé de la MÊME liste que la table affiche. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge color="zinc">{counts.total} agent(s)</Badge>
        <Badge color="emerald" title="Un événement de livraison réel est persisté.">
          {counts.delivered} livré(s)
        </Badge>
        <Badge color="zinc" title="Lecture réussie, aucun événement de livraison. Fait mesuré.">
          {counts.neverDelivered} jamais livré(s)
        </Badge>
        {counts.notRead > 0 ? (
          <Badge
            color="amber"
            title="Lectures d’événement de livraison qui ont ÉCHOUÉ. Ces agents ne sont PAS comptés comme « jamais livrés » — on ne sait pas."
          >
            {counts.notRead} non lu(s)
          </Badge>
        ) : null}
        <Badge color="sky" title="Livraisons ayant ouvert une PR. Ouverte ≠ mergée.">
          {counts.withPr} PR ouverte(s)
        </Badge>
        <Badge
          color="zinc"
          title="Agents dont le projet n’a aucun dépôt GitHub lié : aucune livraison n’y est possible."
        >
          {counts.withoutRepo} sans dépôt
        </Badge>
      </div>

      {/* ── Le fait structurant de la surface, en tête ────────────────────── */}
      <div className="grid shrink-0 gap-2 lg:grid-cols-2">
        {realDeliveryEnabled ? (
          <Note
            title="Écriture GitHub réelle possible sur ce serveur"
            tone="warn"
          >
            Le verrou serveur est ouvert. Une livraison confirmée écrira réellement sur un dépôt tiers.
            Le dry-run reste le mode par défaut de chaque formulaire.
          </Note>
        ) : (
          <Note title="Shipping désactivé — toute livraison partira en dry-run">
            Une écriture GitHub réelle exige DEUX verrous : la confirmation de l’opérateur ET un verrou
            d’environnement côté serveur. Le second est fermé ici, donc les routes de livraison
            retombent en dry-run et le répondent honnêtement. Ce n’est pas une panne : c’est la
            garantie produit qui empêche une écriture accidentelle sur le dépôt d’un client.
          </Note>
        )}

        <RosterTelemetryNote telemetry={telemetry} telemetryFailure={telemetryFailure} />
      </div>

      {deliveryReadFailures > 0 ? (
        <div className="shrink-0">
          <Note tone="warn" title={deliveryReadFailures + ' lecture(s) de livraison en échec'}>
            Ces agents sont marqués « livraison non lue » et ne sont comptés ni parmi les livrés, ni
            parmi les jamais livrés. Une panne de lecture n’est pas une absence de livraison.
          </Note>
        </div>
      ) : null}

      <Panel
        title="Banc de livraison"
        hint={ranked.length + ' au catalogue'}
        className="min-h-80 min-w-0 xl:min-h-0 xl:flex-1"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        {ranked.length === 0 ? (
          <Unavailable
            reason="no-data"
            detail="Aucun agent n’est persisté dans le catalogue. La lecture a réussi — il n’y a réellement rien, ce n’est pas une panne."
          />
        ) : (
          <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
            {ranked.map((row) => (
              <DeliveryRosterRow key={row.copilotId} row={row} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
