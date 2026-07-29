import { SignalIcon } from '@heroicons/react/24/outline'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/dashboard/card'
import { ActivityBars } from '@/components/dashboard/charts/activity-bars'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/components/ui/cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AGENT_RUN_STATUS_LABELS, UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/labels'
import type { HomeChartBucket, HomeRunRow } from '@/lib/dashboard/home-data'

/**
 * COLONNE CENTRALE de /admin (5/12) — le volume de runs de la flotte sur la
 * fenêtre 24 h, puis le tableau dense des derniers runs.
 *
 * Composant SERVEUR : des props entrent, du markup sort. Aucun fetch, aucun
 * état, aucun calcul de métrique — chaque chiffre affiché ici a été calculé une
 * seule fois dans `src/lib/dashboard/home-data.ts`, sur LA MÊME fenêtre que les
 * KPI, si bien que le graphe et le tableau ne peuvent pas se contredire sur un
 * même instant.
 *
 * TROIS DÉCISIONS QUI NE SONT PAS DU STYLE
 *
 * 1. LA PÉRIODE EST UN MARQUEUR, PAS UN SÉLECTEUR. Le cadre de référence pose
 *    ici un segmented control 1 h / 6 h / 24 h. Cette page n'a QU'UNE fenêtre —
 *    le collecteur reçoit un seul `nowMs` et renvoie une seule tranche de 24 h.
 *    Un segment « 1 h » serait donc un contrôle inopérable ET une affirmation
 *    sur des données jamais lues. On rend une pastille statique, pas un contrôle
 *    aux alternatives grisées : ce qui n'existe pas est absent, pas désactivé.
 *
 * 2. AUCUNE HEURE RELATIVE. « il y a 2 min » se calcule contre l'instant du
 *    rendu ; un rendu serveur est mis en cache, streamé, lu plus tard — la
 *    phrase est périmée avant d'être vue, et elle l'est SILENCIEUSEMENT. Une
 *    horloge absolue UTC dans un `<time dateTime>` reste vraie indéfiniment, et
 *    UTC (la même zone que les libellés de buckets de `home-data.ts`) donne la
 *    même colonne sur toutes les machines. `toLocaleString` est proscrit pour la
 *    même raison : il dépend de la locale du serveur.
 *
 * 3. LE MOT DE STATUT VIENT DE `labels.ts`, JAMAIS D'ICI. La légende du graphe
 *    affiche donc `AGENT_RUN_STATUS_LABELS.completed` (« Terminé »), et non un
 *    pluriel écrit à la main : `labels.ts` est la seule orthographe légale d'un
 *    statut (AIGENT-UI-TRUTH-026). « Autres issues » n'est pas un statut mais
 *    une catégorie — le complément de `completed` — donc il s'écrit ici.
 */

/** Période couverte par la page entière. Fixe : voir la décision 1 ci-dessus. */
const PERIOD_LABEL = 'Dernières 24 h'

/**
 * Couleur du badge de statut d'un run.
 *
 * Deux statuts seulement ont droit à une teinte. `completed` porte l'accent,
 * `failed` porte le seul rôle non-accent du système (danger). Tout le reste —
 * bloqué, en attente d'un humain, encore en cours — est zinc neutre : aucun de
 * ces trois n'est encore une issue, et leur donner une couleur les classerait
 * face aux deux qui en sont une. Un échec ne porte JAMAIS le vert.
 */
const STATUS_BADGE_COLOR: Record<HomeRunRow['status'], 'accent' | 'danger' | 'zinc'> = {
  completed: 'accent',
  failed: 'danger',
  blocked: 'zinc',
  'needs-confirmation': 'zinc',
  running: 'zinc',
}

/**
 * `latencyMs` → durée française compacte : « 840 ms », « 1,2 s », « 2 min 05 s ».
 *
 * Formatage pur, sans `Intl` : la virgule décimale et l'unité sont écrites
 * directement, donc la cellule ne change pas de forme avec le `LANG` de la
 * machine qui rend la page.
 *
 * Une valeur non finie (ou négative) renvoie `UNAVAILABLE_LABEL` : ce n'est pas
 * une valeur de repli inventée, c'est le refus d'écrire un chiffre là où la
 * mesure n'en est pas une. Une durée mesurée à 0 ms reste « 0 ms ».
 */
function formatDuration(latencyMs: number): string {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return UNAVAILABLE_LABEL

  const ms = Math.round(latencyMs)
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`

  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`
}

/**
 * `HH:mm` en UTC, ou `null` quand l'horodatage stocké est illisible.
 *
 * Pure présentation : lit une chaîne que le collecteur a déjà fournie et n'en
 * dérive aucune mesure. Renvoie `null` plutôt qu'une horloge de repli, pour que
 * l'appelant montre la valeur brute stockée au lieu d'une valeur fabriquée — et
 * qu'il puisse retirer le `<time>` dont le `dateTime` serait invalide.
 *
 * Dupliqué à l'identique dans `recent-activity-card.tsx` : les deux cartes sont
 * les deux seules surfaces à afficher une heure, et un module partagé pour cinq
 * lignes coûterait un fichier de plus qu'aucune des deux ne possède.
 */
function utcClock(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/** Styles partagés des cellules : `--gutter: 0px` sur le wrapper aligne les bords. */
const HEAD_CELL = 'border-line text-xs font-medium text-zinc-500'
const CELL = 'border-line text-xs'
const NUMERIC = 'text-right font-mono tabular-nums text-zinc-300'

export type FleetCardProps = {
  /**
   * Buckets chronologiques du graphe empilé, tels que renvoyés par
   * `AdminHomeData.hourlyBuckets`. VIDE ⇒ la fenêtre n'a contenu aucun run.
   */
  hourlyBuckets: HomeChartBucket[]
  /**
   * Les 8 runs les plus récents, du plus récent au plus ancien, déjà plafonnés
   * en amont (`AdminHomeData.recentRunRows`). VIDE ⇒ aucun run sur la fenêtre.
   */
  recentRunRows: HomeRunRow[]
  className?: string
}

export function FleetCard({ hourlyBuckets, recentRunRows, className }: FleetCardProps) {
  const hasBuckets = hourlyBuckets.length > 0

  return (
    // `h-full` + flux en colonne : cette carte occupe toute la hauteur du
    // contenu à côté des colonnes voisines, et c'est le tableau qui absorbe le
    // jeu restant.
    <Card className={cn('flex h-full flex-col', className)}>
      <CardHeader
        actions={
          // La pastille de période. Statique par construction — voir la
          // décision 1 en tête de fichier.
          <span className="rounded-full bg-accent-500 px-2.5 py-0.5 text-xs font-medium text-zinc-950">
            {PERIOD_LABEL}
          </span>
        }
      >
        <CardTitle icon={<SignalIcon />}>Activité de la flotte</CardTitle>
      </CardHeader>

      <CardBody className="min-h-0 flex-1">
        <div className="flex flex-col gap-3">
          <div className="rounded-lg bg-sunken p-4">
            {hasBuckets ? (
              // `height` reste à la proportion réglée par le graphe : le SVG
              // s'adapte à la largeur de la colonne, donc un nombre passé
              // d'ici ne ferait que déformer le ratio de la plaque.
              <ActivityBars buckets={hourlyBuckets} />
            ) : (
              // Le graphe sait dessiner sa plaque vide, mais il l'annote en
              // anglais ; cette interface est en français, et le fichier du
              // graphe n'appartient pas à cette carte. On dit donc le même fait
              // ici, dans la seule langue de l'écran.
              <p className="py-6 text-center text-xs text-zinc-500">
                Aucun run démarré sur cette période.
              </p>
            )}
          </div>

          {/* Légende — les deux tons dont les barres sont réellement empilées,
              lus sur les mêmes variables `--chart-*` que le SVG. Masquée quand
              il n'y a pas de barre : une légende sans série est décorative. */}
          {hasBuckets ? (
            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-(--chart-bar)"
                />
                <span className="truncate">{AGENT_RUN_STATUS_LABELS.completed}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-(--chart-bar-muted)"
                />
                <span className="truncate">Autres issues</span>
              </span>
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-medium text-zinc-400">Derniers runs</h3>

          {/* `--gutter: 0px` est la façon dont la table Catalyst affleure ses
              bords : elle annule le padding des première/dernière cellules et
              la marge négative, donc les colonnes s'alignent sur le `px-5` de
              la carte. `Table` fournit elle-même le conteneur
              `overflow-x-auto whitespace-nowrap` — le tableau défile donc dans
              sa propre boîte au lieu de casser la mise en page à 375 px. */}
          <div className="min-w-0 [--gutter:0px]">
            <Table bleed dense className="[&_tbody_tr:last-child_td]:border-b-0">
              <TableHead>
                <TableRow>
                  <TableHeader className={HEAD_CELL}>Statut</TableHeader>
                  <TableHeader className={HEAD_CELL}>Agent</TableHeader>
                  <TableHeader className={HEAD_CELL}>Projet</TableHeader>
                  <TableHeader className={`${HEAD_CELL} text-right`}>Durée</TableHeader>
                  <TableHeader className={`${HEAD_CELL} text-right`}>Heure UTC</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {recentRunRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className={`${CELL} text-zinc-500`}>
                      Aucun run démarré sur cette période.
                    </TableCell>
                  </TableRow>
                ) : (
                  recentRunRows.map((row) => {
                    const clock = utcClock(row.startedAt)
                    return (
                      <TableRow key={row.id}>
                        <TableCell className={CELL}>
                          <Badge color={STATUS_BADGE_COLOR[row.status]} className="text-xs">
                            {AGENT_RUN_STATUS_LABELS[row.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className={CELL}>
                          <span
                            title={row.agentName}
                            className="block max-w-36 truncate text-zinc-100"
                          >
                            {row.agentName}
                          </span>
                        </TableCell>
                        <TableCell className={CELL}>
                          <span
                            title={row.projectName}
                            className="block max-w-32 truncate text-zinc-400"
                          >
                            {row.projectName}
                          </span>
                        </TableCell>
                        <TableCell className={`${CELL} ${NUMERIC}`}>
                          {formatDuration(row.latencyMs)}
                        </TableCell>
                        <TableCell className={`${CELL} ${NUMERIC}`}>
                          {clock === null ? (
                            // Horodatage illisible : on montre ce qui est
                            // stocké plutôt qu'une horloge fabriquée, et on
                            // retire le `<time>` dont le `dateTime` serait
                            // invalide.
                            <span title={row.startedAt} className="block max-w-32 truncate">
                              {row.startedAt}
                            </span>
                          ) : (
                            <time dateTime={row.startedAt}>{clock}</time>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}
