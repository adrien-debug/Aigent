import { ArrowRightIcon, BoltIcon, InboxStackIcon } from '@heroicons/react/24/outline'

import { Card, CardBody, CardTitle } from '@/components/dashboard/card'
import { RingGauge } from '@/components/dashboard/charts/ring-gauge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/components/ui/cn'
import { Divider } from '@/components/ui/divider'
import { Link } from '@/components/ui/link'
import { Text } from '@/components/ui/text'
import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import { AGENT_RUN_STATUS_LABELS, UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/labels'

/**
 * A1 — « Actions prioritaires », le bloc de commande de la home /admin.
 *
 * Composant SERVEUR. Tout chiffre affiché ci-dessous ARRIVE en prop, déjà mesuré
 * par `getAdminHomeData()` : rien n'est ici dérivé, coalescé ni arrondi. Les
 * seules opérations sont de la GÉOMÉTRIE (une largeur en % dans la barre de
 * répartition) et du FORMATAGE (`formatUsd`), jamais le calcul d'une mesure.
 *
 * Les quatre règles de vérité que ce bloc applique, dans l'ordre où elles mordent :
 *
 *  1. `cost24h === null` affiche `UNAVAILABLE_LABEL`. Jamais « 0,00 $ » : une
 *     fenêtre sans rien à sommer est une ABSENCE, et 0,00 $ affirmerait que les
 *     agents ont tourné gratuitement.
 *  2. `runs24h` est un COMPTE sur une fenêtre. Zéro y est une mesure réelle et
 *     s'affiche donc en chiffre — la distinction null/zéro n'existe que pour les
 *     métriques qui portent `| null` dans le contrat.
 *  3. `distribution === null` affiche `UNAVAILABLE_LABEL` au lieu d'une barre
 *     vide : une piste sans segment et une piste dont tous les segments valent 0
 *     se ressemblent à l'œil, alors que l'une est une absence et l'autre un zéro
 *     mesuré. Le mot porte la différence, pas le dessin.
 *  4. Une file d'attente vide est énoncée AFFIRMATIVEMENT. Le vide de la file est
 *     un fait sur la file, pas une mesure manquante : il a droit à une phrase,
 *     pas au mot « Indisponible ».
 *
 * ROUTES. Ce build n'expose que `/admin` et `/admin/runs`. Les `href` frappés par
 * `buildActionItems()` visent aussi `/admin/agents/<id>`, `/admin/projects/<id>`
 * et des URL externes de PR : `isInternalRoute()` filtre, et une action non
 * routable se rend en TEXTE non cliquable. Jamais un lien vers un 404.
 */

// ---------------------------------------------------------------------------
// Répartition — le contrat de la bande segmentée
// ---------------------------------------------------------------------------

/**
 * Rôle visuel d'une part. `accent` = la part réussie/exécutable (le seul vert de
 * la page), `danger` = la part en échec (le seul rouge), `muted` = le reste, qui
 * ne prétend rien.
 */
type DistributionTone = 'accent' | 'muted' | 'danger'

type DistributionShare = {
  /** Clé React, stable. Jamais affichée. */
  key: string
  /** Le mot de la légende. Un mot de STATUT vient de `labels.ts`, pas d'ici. */
  label: string
  /** Un COMPTE mesuré. 0 est un vrai 0 et s'affiche en chiffre. */
  count: number
  tone: DistributionTone
}

type CommandDistribution = {
  /** Légende d'une ligne, en français, au-dessus de la bande. */
  caption: string
  /**
   * L'ensemble mesuré dont les parts sont extraites. `0` est un total mesuré :
   * la piste reste nue et la légende affiche les zéros réels.
   */
  total: number
  /**
   * Parts colorées, dans l'ordre d'affichage. Leur somme peut être inférieure à
   * `total` : le reliquat apparaît alors simplement comme piste nue, sans entrée
   * de légende — un reste non nommé n'est pas une catégorie inventée.
   */
  shares: DistributionShare[]
}

const SHARE_STYLES: Record<DistributionTone, { bar: string; dot: string; text: string }> = {
  accent: { bar: 'bg-(--chart-bar)', dot: 'bg-(--chart-bar)', text: 'text-accent-300' },
  muted: { bar: 'bg-(--chart-bar-muted)', dot: 'bg-(--chart-bar-muted)', text: 'text-zinc-400' },
  danger: {
    bar: 'bg-(--state-danger-solid)',
    dot: 'bg-(--state-danger-solid)',
    text: 'text-[var(--state-danger-text)]',
  },
}

// ---------------------------------------------------------------------------
// Actions — routage et vocabulaire
// ---------------------------------------------------------------------------

/**
 * Les deux seules destinations qui existent dans ce build. Tout le reste — y
 * compris les `href` légitimes que la couche domaine continue de produire — se
 * rend en texte inerte plutôt qu'en lien mort.
 */
function isInternalRoute(href: string): boolean {
  return href === '/admin' || href.startsWith('/admin/runs')
}

/**
 * Le mot de statut, ou rien.
 *
 * `ActionItem.status` est une chaîne BRUTE remontée du domaine (`'failed'`,
 * `'open'`, un statut de mission…). Seules les clés que `labels.ts` connaît ont
 * une orthographe française officielle ; pour les autres on n'affiche PAS de
 * badge, plutôt que d'inventer un second vocabulaire ou de laisser fuir un enum
 * anglais dans une interface française.
 */
const RUN_STATUS_LABEL_BY_KEY = new Map<string, string>(Object.entries(AGENT_RUN_STATUS_LABELS))

/**
 * Le rôle rouge se déduit du `kind` — un champ typé et exhaustif — et non d'une
 * comparaison de chaînes sur `status`. Un échec ou un blocage ne porte jamais
 * l'accent vert.
 */
const KIND_BADGE_COLOR: Record<ActionItemKind, 'zinc' | 'danger'> = {
  ready_manual: 'zinc',
  sandbox_failed: 'danger',
  release_gate_red: 'danger',
  pr_open: 'zinc',
  mission_blocked: 'danger',
  data_unavailable: 'zinc',
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type CommandCardProps = {
  /**
   * `kpis.success24h` — DÉJÀ un pourcentage entier 0..100, jamais un ratio 0..1
   * (un consommateur qui avait supposé un ratio a livré « 10000 % »). Passé tel
   * quel à la jauge, `null` compris : la jauge possède le rendu « non mesuré ».
   */
  success24h: number | null
  /** `kpis.runs24h` — compte sur la fenêtre 24 h partagée. 0 est mesuré. */
  runs24h: number
  /** `kpis.cost24h` — USD sommés sur la fenêtre, `null` si rien n'était mesurable. */
  cost24h: number | null
  /** `kpis.needsAction` — longueur de la file d'actions. Un compte : 0 est mesuré. */
  needsAction: number
  /**
   * La répartition affichée sous les deux gros chiffres. `null` = les comptes
   * sous-jacents n'ont pas pu être lus (ABSENT ≠ ZÉRO) et la bande cède la place
   * au mot `UNAVAILABLE_LABEL`.
   */
  distribution: CommandDistribution | null
  /**
   * `actionItems`, DÉJÀ trié par priorité en amont. La première entrée devient
   * l'appel à l'action principal, les deux suivantes la liste compacte ; le
   * reste n'est pas rendu ici (le compteur du pied de carte le résume).
   */
  actions: ActionItem[]
}

/**
 * USD mesurés → la chaîne à l'écran. Sous le centime on garde quatre décimales
 * pour qu'une dépense réelle de 0,0031 $ ne soit jamais aplatie en un « 0,00 $ »
 * qui se lirait « gratuit ».
 */
function formatUsd(amount: number): string {
  const fractionDigits = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

/** Largeur d'un segment, en % du total mesuré. Pure géométrie. */
function sharePercent(count: number, total: number): number {
  return Math.round((count / total) * 10000) / 100
}

/**
 * La bande segmentée + sa légende chiffrée.
 *
 * Reçoit une répartition NON nulle : le cas absent est tranché par l'appelant,
 * qui affiche le mot à la place. La bande est décorative (`aria-hidden`) — ce
 * sont les comptes de la légende qui portent l'information, jamais la géométrie.
 */
function DistributionStrip({ distribution }: { distribution: CommandDistribution }) {
  const { total, shares } = distribution

  return (
    <>
      <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-sunken">
        {total > 0
          ? shares.map((share) =>
              share.count > 0 ? (
                <span
                  key={share.key}
                  className={cn('h-full', SHARE_STYLES[share.tone].bar)}
                  style={{ width: `${sharePercent(share.count, total)}%` }}
                />
              ) : null
            )
          : null}
      </div>

      <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        {shares.map((share) => (
          <li key={share.key} className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={cn('size-1.5 shrink-0 rounded-full', SHARE_STYLES[share.tone].dot)}
            />
            <span className="truncate text-xs text-zinc-500">{share.label}</span>
            <span className={cn('shrink-0 font-mono text-xs tabular-nums', SHARE_STYLES[share.tone].text)}>
              {share.count}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Une entrée de la liste compacte : cliquable seulement si sa route existe. */
function SecondaryAction({ item }: { item: ActionItem }) {
  const statusLabel = RUN_STATUS_LABEL_BY_KEY.get(item.status)
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-medium text-zinc-200">{item.title}</span>
        <span className="truncate text-xs text-zinc-500">{item.meta}</span>
      </span>
      {statusLabel ? (
        <Badge color={KIND_BADGE_COLOR[item.kind]} className="shrink-0">
          {statusLabel}
        </Badge>
      ) : null}
    </>
  )

  const shared = 'flex min-w-0 items-center gap-3 rounded-lg px-2 py-1.5'

  return isInternalRoute(item.href) ? (
    <Link href={item.href} className={cn(shared, '-mx-2 hover:bg-white/5')}>
      {body}
    </Link>
  ) : (
    <div className={cn(shared, '-mx-2')}>{body}</div>
  )
}

export function CommandCard({
  success24h,
  runs24h,
  cost24h,
  needsAction,
  distribution,
  actions,
}: CommandCardProps) {
  // `.at()` rather than `actions[0]`: without `noUncheckedIndexedAccess` an
  // index access is typed non-optional, and the empty-queue branch below would
  // be a comparison the compiler calls impossible.
  const primary: ActionItem | undefined = actions.at(0)
  const secondary = actions.slice(1, 3)

  return (
    <Card>
      <CardBody className="gap-6 pt-5">
        {/* Jauge et colonne de commande. Côte à côte à partir de `sm`, empilées
            en dessous — la jauge fait 150 px fixes et écraserait les chiffres
            sur un téléphone. */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex shrink-0 justify-center sm:justify-start">
            <RingGauge
              value={success24h}
              max={100}
              size={150}
              label="Taux de réussite"
              caption="24 h"
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <CardTitle icon={<BoltIcon />}>Actions prioritaires</CardTitle>

            <div className="flex flex-col gap-3">
              <div className="min-w-0">
                <p className="font-mono text-2xl/8 tabular-nums text-white">{runs24h}</p>
                <p className="text-xs text-zinc-500">Exécutions lancées sur les 24 dernières heures</p>
              </div>

              <div className="min-w-0">
                {cost24h === null ? (
                  // Le mot, pas un nombre. Voir la règle 1 en tête de fichier.
                  <p className="text-sm/8 text-zinc-500">{UNAVAILABLE_LABEL}</p>
                ) : (
                  <p className="font-mono text-2xl/8 tabular-nums text-white">{formatUsd(cost24h)}</p>
                )}
                <p className="text-xs text-zinc-500">Coût mesuré sur la même fenêtre</p>
              </div>
            </div>
          </div>
        </div>

        {/* Répartition — « la répartition des agents ou des exécutions » du cadre
            de référence, bâtie sur des comptes déjà mesurés. */}
        <div className="flex min-w-0 flex-col gap-2">
          <p className="truncate text-xs text-zinc-500">
            {distribution === null ? 'Répartition' : distribution.caption}
          </p>

          {distribution === null ? (
            <p className="text-xs text-zinc-500">{UNAVAILABLE_LABEL}</p>
          ) : (
            <DistributionStrip distribution={distribution} />
          )}
        </div>

        {/* Actions prioritaires. Une seule action porte un bouton : deux appels
            à l'action pour une même file diluent la priorité. */}
        <div className="flex min-w-0 flex-col gap-3">
          {primary === undefined ? (
            <Text className="text-xs">File d&apos;attente vide — aucune action prioritaire en attente.</Text>
          ) : isInternalRoute(primary.href) ? (
            <Button color="accent" href={primary.href} className="w-full">
              {primary.buttonLabel}
              <ArrowRightIcon />
            </Button>
          ) : (
            // Route absente de ce build : l'action reste LISIBLE, mais inerte.
            <div className="min-w-0 rounded-lg border border-line bg-sunken px-3 py-2">
              <p className="truncate text-sm font-medium text-white">{primary.title}</p>
              <p className="truncate text-xs text-zinc-500">{primary.meta}</p>
            </div>
          )}

          {secondary.length > 0 ? (
            <ul className="flex min-w-0 flex-col gap-1">
              {secondary.map((item) => (
                <li key={item.id} className="min-w-0">
                  <SecondaryAction item={item} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Divider className="border-line" />

          <Link
            href="/admin/runs"
            className="-mx-2 flex min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
          >
            <span className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
              <InboxStackIcon className="size-4 shrink-0 text-zinc-600" />
              <span className="truncate">File d&apos;actions en attente</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-xs tabular-nums text-accent-300">{needsAction}</span>
              <ArrowRightIcon className="size-4 text-zinc-600" />
            </span>
          </Link>
        </div>
      </CardBody>
    </Card>
  )
}
