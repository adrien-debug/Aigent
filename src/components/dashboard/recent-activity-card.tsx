import {
  ArrowPathIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/dashboard/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/components/ui/cn'
import { Divider } from '@/components/ui/divider'
import { Link } from '@/components/ui/link'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import {
  AGENT_RUN_STATUS_LABELS,
  AVAILABLE_AGENT_STATUS_LABELS,
  UNAVAILABLE_LABEL,
} from '@/lib/agent-mission-control/labels'
import type { HomeRecentRun } from '@/lib/dashboard/home-data'

/**
 * COLONNE DROITE de /admin (3/12) — le panneau d'activité : les derniers
 * événements de la fenêtre, puis l'état runtime des agents du catalogue.
 *
 * Composant SERVEUR : des props entrent, du markup sort. Quatre règles qu'il
 * applique plutôt que de les contourner :
 *
 * 1. AUCUNE HEURE RELATIVE. « il y a 2 min » se calcule contre l'instant du
 *    rendu, et un rendu serveur est mis en cache, streamé, lu plus tard : la
 *    phrase est périmée avant d'être vue, et elle l'est SILENCIEUSEMENT. Une
 *    horloge absolue UTC dans un `<time dateTime>` reste vraie indéfiniment.
 *    `toLocaleString` est proscrit pour la même raison : sa sortie dépend de la
 *    locale de la machine qui rend la page.
 *
 * 2. AUCUN CHAMP DE RECHERCHE MORT. Le cadre de référence pose une barre de
 *    recherche ici. Un champ qui ne filtre rien est un contrôle qui ment sur ce
 *    qu'il fait : l'emplacement est un vrai `<Link>` vers la console des runs,
 *    habillé comme la recherche du cadre — il en a la forme, et il mène quelque
 *    part. `/admin/runs` est, avec cette page, la seule route qui existe.
 *
 * 3. LE MOT DE STATUT VIENT DE `labels.ts`, JAMAIS D'ICI (AIGENT-UI-TRUTH-026).
 *    Deux vocabulaires distincts se croisent dans cette carte et ne doivent
 *    jamais fusionner en un seul badge ambigu : le statut d'un RUN
 *    (`AGENT_RUN_STATUS_LABELS`) et le statut RUNTIME d'un agent
 *    (`AVAILABLE_AGENT_STATUS_LABELS`).
 *
 * 4. ABSENT ≠ VIDE. `availableAgentTotal === null` signifie que la lecture du
 *    catalogue A ÉCHOUÉ ; le bloc affiche alors `UNAVAILABLE_LABEL`, pas une
 *    liste vide. Un total de 0 est un catalogue prouvé vide, et reçoit une
 *    phrase. Les deux cas restent visiblement différents.
 */

/**
 * Statut d'un run → ton de la pastille et glyphe.
 *
 * Deux statuts seulement ont droit à une teinte. `completed` porte l'accent,
 * `failed` porte le seul rôle non-accent du système (danger). Tout le reste —
 * bloqué, en attente d'un humain, encore en cours — est zinc neutre : aucun
 * n'est encore une issue, et leur donner une couleur les classerait face aux
 * deux qui en sont une. Une erreur ne porte JAMAIS la teinte du succès ; le
 * glyphe suffit à distinguer les trois cas neutres sans inventer une 4e teinte.
 */
const RUN_TONES: Record<
  HomeRecentRun['status'],
  { tile: string; icon: React.ComponentType<{ className?: string }> }
> = {
  completed: {
    tile: 'bg-(--accent-surface) text-accent-300 ring-1 ring-(color:--accent-line)',
    icon: CheckIcon,
  },
  failed: {
    tile: 'bg-[color-mix(in_oklab,var(--state-danger-solid)_18%,transparent)] text-[var(--state-danger-text)] ring-1 ring-(color:--state-danger-solid-line)',
    icon: XMarkIcon,
  },
  blocked: { tile: 'bg-white/5 text-zinc-400 ring-1 ring-white/10', icon: NoSymbolIcon },
  'needs-confirmation': {
    tile: 'bg-white/5 text-zinc-400 ring-1 ring-white/10',
    icon: QuestionMarkCircleIcon,
  },
  running: { tile: 'bg-white/5 text-zinc-400 ring-1 ring-white/10', icon: ArrowPathIcon },
}

/**
 * Statut RUNTIME d'un agent → couleur du badge.
 *
 * `active` est le seul état prouvé sain : lui seul porte l'accent. `degraded`
 * et `unavailable` sont des pannes réelles (outils non résolus, chemin
 * d'exécution absent) et portent le rôle danger. `inactive` est une décision
 * d'opérateur, pas une panne : zinc.
 */
const AGENT_BADGE_COLOR: Record<AvailableAgent['status'], 'accent' | 'danger' | 'zinc'> = {
  active: 'accent',
  degraded: 'danger',
  unavailable: 'danger',
  inactive: 'zinc',
}

/**
 * `HH:mm` en UTC, ou `null` quand l'horodatage stocké est illisible.
 *
 * Pure présentation : lit une chaîne que le collecteur a déjà fournie et n'en
 * dérive aucune mesure. Renvoie `null` plutôt qu'une horloge de repli, pour que
 * l'appelant montre la valeur brute stockée au lieu d'une valeur fabriquée.
 *
 * Dupliqué à l'identique dans `fleet-card.tsx` : les deux cartes sont les deux
 * seules surfaces à afficher une heure, et un module partagé pour cinq lignes
 * coûterait un fichier de plus qu'aucune des deux ne possède.
 */
function utcClock(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export type RecentActivityCardProps = {
  /**
   * Les 6 runs les plus récents, du plus récent au plus ancien, déjà plafonnés
   * en amont (`AdminHomeData.recentRuns`). VIDE ⇒ aucun run sur la fenêtre.
   */
  recentRuns: HomeRecentRun[]
  /**
   * Le catalogue runtime, plafonné à 6 (`AdminHomeData.availableAgents`).
   * Vide ET `availableAgentTotal === null` ⇒ la lecture a échoué ; vide avec un
   * total de 0 ⇒ catalogue prouvé vide.
   */
  availableAgents: Pick<AvailableAgent, 'copilotId' | 'name' | 'status'>[]
  /**
   * Taille du catalogue AVANT plafonnement (`AdminHomeData.availableAgentTotal`).
   * `null` = la lecture a échoué — ABSENT ≠ ZÉRO.
   */
  availableAgentTotal: number | null
  className?: string
}

export function RecentActivityCard({
  recentRuns,
  availableAgents,
  availableAgentTotal,
  className,
}: RecentActivityCardProps) {
  // `null` (lecture en échec) n'est PAS « rien à montrer » : l'échec lui-même
  // est une information que le panneau doit afficher. Le vide total, c'est
  // aucun run ET un catalogue prouvé vide.
  const nothingToShow = recentRuns.length === 0 && availableAgentTotal === 0

  return (
    <Card className={cn('flex h-full flex-col', className)}>
      <CardHeader>
        <CardTitle icon={<ClockIcon />}>Activité récente</CardTitle>
      </CardHeader>

      <CardBody className="min-h-0 flex-1">
        {/* Forme de recherche, vraie destination. Voir la règle 2 en tête. */}
        <Link
          href="/admin/runs"
          className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-sunken px-3 py-1.5 text-xs text-zinc-500 data-hover:border-line-strong data-hover:text-zinc-300"
        >
          <MagnifyingGlassIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Rechercher dans les runs</span>
          <ArrowUpRightIcon className="size-3 shrink-0" />
        </Link>

        {nothingToShow ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
            <p className="text-xs text-zinc-400">Aucune activité à afficher.</p>
            <p className="text-xs text-zinc-500">
              Aucun run sur cette période, et aucun agent enregistré.
            </p>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-xs font-medium text-zinc-400">Derniers événements</h3>

              {recentRuns.length === 0 ? (
                <p className="text-xs text-zinc-500">Aucun run démarré sur cette période.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {recentRuns.map((run) => {
                    const tone = RUN_TONES[run.status]
                    const Icon = tone.icon
                    const clock = utcClock(run.startedAt)
                    return (
                      <li key={run.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-full',
                            tone.tile
                          )}
                        >
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            title={run.agentName}
                            className="block truncate text-xs font-medium text-zinc-100"
                          >
                            {run.agentName}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {AGENT_RUN_STATUS_LABELS[run.status]}
                            <span aria-hidden="true"> · </span>
                            {clock === null ? (
                              // Illisible : on montre ce qui est stocké plutôt
                              // qu'une horloge fabriquée, et on retire le
                              // `<time>` dont le `dateTime` serait invalide.
                              <span className="font-mono">{run.startedAt}</span>
                            ) : (
                              <time dateTime={run.startedAt} className="font-mono tabular-nums">
                                {clock} UTC
                              </time>
                            )}
                          </span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <Divider soft className="border-line" />

            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                {/* « Agents du runtime » et non « Agents actifs » : la liste
                    porte aussi les inactifs, les dégradés et les indisponibles,
                    chacun avec son mot. Un titre qui promettrait « actifs »
                    serait démenti par les badges juste en dessous. */}
                <h3 className="min-w-0 truncate text-xs font-medium text-zinc-400">
                  Agents du runtime
                </h3>
                {availableAgentTotal !== null && availableAgents.length > 0 ? (
                  <span className="shrink-0 font-mono text-xs text-zinc-500 tabular-nums">
                    {availableAgents.length} / {availableAgentTotal}
                  </span>
                ) : null}
              </div>

              {availableAgentTotal === null ? (
                // La lecture du catalogue a échoué. Une pastille, pas une liste
                // vide : « vide » serait une mesure, et il n'y en a pas eu.
                <Badge className="self-start text-xs">{UNAVAILABLE_LABEL}</Badge>
              ) : availableAgents.length === 0 ? (
                <p className="text-xs text-zinc-500">Aucun agent enregistré.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {availableAgents.map((agent) => (
                    <li key={agent.copilotId} className="flex items-center gap-2">
                      <span
                        title={agent.name}
                        className="min-w-0 flex-1 truncate text-xs text-zinc-300"
                      >
                        {agent.name}
                      </span>
                      <Badge color={AGENT_BADGE_COLOR[agent.status]} className="shrink-0 text-xs">
                        {AVAILABLE_AGENT_STATUS_LABELS[agent.status]}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  )
}
