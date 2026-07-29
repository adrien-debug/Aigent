import { ExclamationTriangleIcon, LightBulbIcon, SparklesIcon } from '@heroicons/react/24/outline'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/dashboard/card'
import { cn } from '@/components/ui/cn'
import { Text } from '@/components/ui/text'
import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/labels'

/**
 * A2 — « Recommandations ».
 *
 * Composant SERVEUR : aucun état, aucune arithmétique de mesure. Deux blocs :
 *
 *  - la ligne MISE EN AVANT, qui est l'action la plus prioritaire rendue comme
 *    une PHRASE et non comme un bouton (le bouton de cette même entrée vit une
 *    seule fois, dans la carte de commande — un second serait un deuxième appel
 *    à l'action pour une seule entrée de file) ;
 *  - jusqu'à trois barres de progression dont la largeur EST le taux de réussite
 *    des tests du projet, en pourcentage entier, calculé une fois dans
 *    `getAdminHomeData()`.
 *
 * LA BARRE ENCODE LE NOMBRE. Une piste sans remplissage avec « 0 % » à côté est
 * exactement le mensonge que ce dépôt réapprend sans cesse : un taux NON MESURÉ
 * ne dessine AUCUN remplissage et affiche `UNAVAILABLE_LABEL`. Un remplissage de
 * largeur nulle et un remplissage absent sont identiques à l'œil, donc c'est la
 * colonne de valeur qui porte la distinction — et elle ne dit jamais « zéro »
 * de ce que personne n'a mesuré.
 *
 * PAS DE VERT SUR UN ÉCHEC. La tuile mise en avant prend le rôle rouge quand la
 * recommandation porte sur une défaillance (`kind`), l'accent sinon.
 */

/**
 * Le rôle visuel se déduit du `kind` — union typée et exhaustive — jamais d'une
 * comparaison de chaînes. Le compilateur refuse d'oublier un cas.
 */
const FEATURED_TONE_BY_KIND: Record<ActionItemKind, 'accent' | 'danger'> = {
  ready_manual: 'accent',
  sandbox_failed: 'danger',
  release_gate_red: 'danger',
  pr_open: 'accent',
  mission_blocked: 'danger',
  data_unavailable: 'accent',
}

/**
 * Surfaces teintées, sur les rôles de `theme.css`. L'anneau plutôt qu'une
 * bordure : c'est le motif déjà employé par la carte d'activité récente, et il
 * évite d'avoir à arbitrer largeur et couleur de bordure dans un même `cn()`.
 */
const FEATURED_STYLES = {
  accent: {
    frame: 'bg-(--accent-surface) ring-1 ring-(color:--accent-line)',
    tile: 'bg-(--accent-surface) text-accent-300 ring-1 ring-(color:--accent-line)',
  },
  danger: {
    frame:
      'bg-[color-mix(in_oklab,var(--state-danger-solid)_14%,transparent)] ring-1 ring-(color:--state-danger-solid-line)',
    tile: 'bg-[color-mix(in_oklab,var(--state-danger-solid)_18%,transparent)] text-[var(--state-danger-text)] ring-1 ring-(color:--state-danger-solid-line)',
  },
} as const

/** Une barre de projet : le taux mesuré, ou l'aveu qu'il ne l'est pas. */
type ProjectRate = {
  id: string
  name: string
  /**
   * 0..100, DÉJÀ un pourcentage entier (`HomeProjectBar.passRatePercent`).
   * `null` = aucune preuve adossée à un run — pas de remplissage, et le mot.
   */
  passRatePercent: number | null
}

type RecommendationsCardProps = {
  /**
   * `actionItems[0]` — déjà trié par priorité en amont — ou `null` quand la file
   * est vide, auquel cas la ligne mise en avant DISPARAÎT proprement (pas de
   * tuile vide). Structurel : un `ActionItem` complet entre tel quel. Aucun
   * `href` n'est pris, volontairement : cette ligne est un constat, pas une
   * destination, et les `href` amont visent des routes absentes de ce build.
   */
  featured: Pick<ActionItem, 'kind' | 'title' | 'meta'> | null
  /**
   * `topProjects` — au plus trois sont rendues. `passRatePercent` est DÉJÀ un
   * pourcentage entier ou `null` : ce composant ne convertit rien, la largeur
   * est le nombre qu'on lui a remis.
   */
  projects: ProjectRate[]
}

const PROJECT_ROW_LIMIT = 3

export function RecommendationsCard({ featured, projects }: RecommendationsCardProps) {
  const rows = projects.slice(0, PROJECT_ROW_LIMIT)
  const tone = featured === null ? null : FEATURED_TONE_BY_KIND[featured.kind]

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={<SparklesIcon />}>Recommandations</CardTitle>
      </CardHeader>

      <CardBody>
        {featured !== null && tone !== null ? (
          <div className={cn('flex min-w-0 items-start gap-3 rounded-lg p-4', FEATURED_STYLES[tone].frame)}>
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full',
                FEATURED_STYLES[tone].tile
              )}
            >
              {tone === 'danger' ? (
                <ExclamationTriangleIcon className="size-4" />
              ) : (
                <LightBulbIcon className="size-4" />
              )}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-white">{featured.title}</span>
              <span className="truncate text-xs text-zinc-400">{featured.meta}</span>
            </span>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-xs font-medium text-zinc-400">Taux de réussite des tests par projet</h3>

          {rows.length > 0 ? (
            rows.map((project) => (
              <div key={project.id} className="flex min-w-0 items-center gap-3">
                <span className="w-20 shrink-0 truncate text-xs text-zinc-400 sm:w-24">{project.name}</span>

                {/* Piste de 6 px. L'élément de remplissage n'EXISTE que si le taux
                    a été mesuré : un taux absent ne dessine rien, l'œil ne peut
                    donc pas le lire comme « mesuré à zéro ». */}
                <span className="h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-sunken">
                  {project.passRatePercent === null ? null : (
                    <span
                      className="block h-full rounded-full bg-accent-500"
                      style={{ width: `${project.passRatePercent}%` }}
                    />
                  )}
                </span>

                {project.passRatePercent === null ? (
                  <span className="shrink-0 text-xs text-zinc-500">{UNAVAILABLE_LABEL}</span>
                ) : (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-200">
                    {project.passRatePercent}&nbsp;%
                  </span>
                )}
              </div>
            ))
          ) : (
            <Text className="text-xs">Aucun projet enregistré : les taux apparaîtront dès qu&apos;il y en aura un.</Text>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
