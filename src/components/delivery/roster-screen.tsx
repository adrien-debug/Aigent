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
import { PageBody, PageHeader } from '@/components/app-shell'
import { Badge } from '@/components/ui/badge'
import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Avatar } from '@/components/ui/avatar'
import { Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { navEntry } from '@/components/navigation'

import { Note, isoShort } from './atoms'
import { countDeliveryRows, deliveryModeLabel, sortDeliveryRows, type DeliveryRow } from './model'
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
      {telemetry.consumerCount} événement(s) de provenance « consumer » sur {telemetry.scannedCount}{' '}
      lu(s).
    </Note>
  )
}

/**
 * Un chiffre de poussée, à la taille de son importance.
 *
 * Comptages dérivés de la MÊME liste que le banc affiche — jamais une mesure
 * lue à part. Un `0` y est donc un vrai zéro. Les NON LUES ne montent jamais
 * ici : une lecture échouée n'est ni une livraison ni une absence de livraison,
 * et lui donner un grand chiffre l'agrégerait visuellement aux deux autres.
 */
function DeliveryFigure({
  value,
  label,
  hint,
  tone = 'default',
  title,
}: Readonly<{
  value: number
  label: string
  hint?: string
  tone?: 'default' | 'good' | 'warn'
  title?: string
}>) {
  const toneColor = tone === 'warn' ? SEVERITY.warn : tone === 'good' ? SEVERITY.good : null

  return (
    <div className="min-w-0" title={title}>
      <div className="aig-display text-3xl font-semibold tabular-nums sm:text-4xl" style={toneColor ? { color: toneColor } : undefined}>
        {value}
      </div>
      <Text className="aig-text-muted mt-1 truncate text-sm">{label}</Text>
      {hint ? <Text className="aig-text-faint mt-0.5 truncate text-xs">{hint}</Text> : null}
    </div>
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
        // Survol = un palier de clarté au-dessus du panneau, comme sur le banc
        // de qualification. Le voile blanc dosé à la main disparaît.
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:aig-raised"
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
    // `PageHeader` porte la gouttière mobile et le `sticky` : les reposer ici
    // les doublerait. Le conteneur ne garde que la contrainte de hauteur — la
    // page ne pousse pas le shell, c'est le banc qui défile dans sa box.
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Le bandeau de comptage devient le `meta` de l'en-tête : c'est du
          contexte chiffré de la surface, dérivé de la MÊME liste que la table
          affiche, pas une action. */}
      <PageHeader
        title={navEntry('/delivery').name}
        description={navEntry('/delivery').purpose}
      />

      <PageBody className="min-h-0 flex-1 gap-5">
        {/* LES POUSSÉES — la zone dominante. Les six comptages vivaient en
            badges de 11 px dans le `meta` ; ils portent l'information
            principale de la surface et prennent la scène. Les `title`
            explicatifs sont conservés mot pour mot. */}
        <section
          className="aig-stage aig-accent-edge shrink-0 p-5 sm:p-6"
          aria-label="État des poussées"
        >
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
            <div className="min-w-0 xl:flex-1">
              <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
                État des poussées
              </Text>

              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                <DeliveryFigure value={counts.total} label="Agent(s)" />
                <DeliveryFigure
                  value={counts.delivered}
                  label="Livré(s)"
                  tone={counts.delivered > 0 ? 'good' : 'default'}
                  title="Un événement de livraison réel est persisté."
                />
                <DeliveryFigure
                  value={counts.neverDelivered}
                  label="Jamais livré(s)"
                  hint="fait mesuré, pas une panne"
                  title="Lecture réussie, aucun événement de livraison. Fait mesuré."
                />
                <DeliveryFigure
                  value={counts.withPr}
                  label="PR ouverte(s)"
                  hint="ouverte ≠ mergée"
                  title="Livraisons ayant ouvert une PR. Ouverte ≠ mergée."
                />
              </div>

              <div className="aig-hairline my-5" />

              {/* Les inconnues et les impossibilités restent en ligne neutre :
                  une lecture échouée n'est pas un verdict, et la grossir
                  l'agrégerait visuellement aux poussées réelles. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Badge
                  color="zinc"
                  title="Agents dont le projet n’a aucun dépôt GitHub lié : aucune livraison n’y est possible."
                >
                  {counts.withoutRepo} sans dépôt cible
                </Badge>
                {counts.notRead > 0 ? (
                  <Badge
                    color="amber"
                    title="Lectures d’événement de livraison qui ont ÉCHOUÉ. Ces agents ne sont PAS comptés comme « jamais livrés » — on ne sait pas."
                  >
                    {counts.notRead} livraison(s) non lue(s)
                  </Badge>
                ) : null}
              </div>
            </div>

            {/* LOT 5 — les états de canal, GROUPÉS. Trois encadrés de même
                nature (verrou d'écriture, retour de télémétrie, lectures en
                échec) s'empilaient en gros rectangles de rang égal à la liste.
                Ils tiennent maintenant dans un creux unique, au second rang,
                titré par leur cause commune : ce que ce serveur peut faire et
                ce qu'il sait. Aucun texte n'est retiré. */}
            <div className="aig-inset flex min-w-0 flex-col gap-2 p-3 xl:w-[26rem] xl:shrink-0">
              <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
                Canal de livraison — ce que ce serveur peut et sait
              </Text>

              {realDeliveryEnabled ? (
                <Note title="Écriture GitHub réelle possible sur ce serveur" tone="warn">
                  Le verrou serveur est ouvert. Une livraison confirmée écrira réellement sur un
                  dépôt tiers. Le dry-run reste le mode par défaut de chaque formulaire.
                </Note>
              ) : (
                <Note title="Shipping désactivé — toute livraison partira en dry-run">
                  Une écriture GitHub réelle exige DEUX verrous : la confirmation de l’opérateur ET
                  un verrou d’environnement côté serveur. Le second est fermé ici, donc les routes
                  de livraison retombent en dry-run et le répondent honnêtement. Ce n’est pas une
                  panne : c’est la garantie produit qui empêche une écriture accidentelle sur le
                  dépôt d’un client.
                </Note>
              )}

              <RosterTelemetryNote telemetry={telemetry} telemetryFailure={telemetryFailure} />

              {deliveryReadFailures > 0 ? (
                <Note tone="warn" title={deliveryReadFailures + ' lecture(s) de livraison en échec'}>
                  Ces agents sont marqués « livraison non lue » et ne sont comptés ni parmi les
                  livrés, ni parmi les jamais livrés. Une panne de lecture n’est pas une absence de
                  livraison.
                </Note>
              ) : null}
            </div>
          </div>
        </section>

        {/* Le banc dans un CREUX : il accueille la liste, il ne se pose pas en
            carte de rang égal à la scène. Box bornée, la donnée défile dedans. */}
        <section className="flex min-h-0 min-w-0 flex-col xl:flex-1">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 pb-3">
            <Subheading level={2}>Banc de livraison</Subheading>
            <Text className="aig-text-muted text-sm">{ranked.length} au catalogue</Text>
          </div>

          <div className="aig-inset flex min-h-80 min-w-0 flex-col overflow-hidden xl:min-h-0 xl:flex-1">
            {ranked.length === 0 ? (
              <div className="p-4">
                <Unavailable
                  reason="no-data"
                  detail="Aucun agent n’est persisté dans le catalogue. La lecture a réussi — il n’y a réellement rien, ce n’est pas une panne."
                />
              </div>
            ) : (
              // Séparateur discret de la grammaire — la paire claire/sombre dosée à
              // la main n'avait plus de moitié claire à rendre.
              <ul className="scroll-thin min-h-0 flex-1 divide-y divide-[color:var(--aig-line-soft)] overflow-y-auto">
                {ranked.map((row) => (
                  <DeliveryRosterRow key={row.copilotId} row={row} />
                ))}
              </ul>
            )}
          </div>
        </section>
      </PageBody>
    </div>
  )
}
