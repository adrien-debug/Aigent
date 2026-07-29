import { ArrowRightIcon, CheckCircleIcon, MinusCircleIcon, RectangleStackIcon } from '@heroicons/react/24/outline'

import { Card, CardBody, CardHeader, CardTitle } from '@/components/dashboard/card'
import { Button } from '@/components/ui/button'
import { Divider } from '@/components/ui/divider'
import { Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/labels'

/**
 * A3 — « Projets actifs ».
 *
 * Composant SERVEUR. Trois blocs empilés : la liste des projets, deux faits
 * runtime, et l'unique sortie de cette colonne.
 *
 * CE QUE CETTE CARTE NE PRÉTEND PAS. Elle rend la liste qu'on lui remet et
 * n'affirme rien de plus que le chiffre attaché à chaque ligne — c'est
 * l'APPELANT qui décide quels projets tombent sous ce titre. La pastille de tête
 * est une puce, marquée `aria-hidden`, pas un statut : ce dépôt n'a qu'un seul
 * endroit d'où un mot de statut peut venir (`labels.ts`), et une pastille colorée
 * nue qui voudrait dire « actif » serait un statut écrit en CSS.
 *
 * Les deux lignes à coche sont des KPI runtime, tous deux nullables. `null` y
 * signifie que le catalogue runtime n'a pas pu être lu — une ABSENCE, qui
 * s'affiche en `UNAVAILABLE_LABEL` à côté d'un glyphe neutre, jamais en zéro à
 * côté d'une coche verte.
 *
 * ROUTES. `/admin/runs` est la SEULE destination qui existe en dehors de cette
 * page : `/admin/projects` n'existe pas et une gate du dépôt interdit de la
 * recréer, donc les lignes de projet ne sont pas des liens.
 */

/** Une ligne de projet. `runsLast24h` est un compte : 0 y est une mesure réelle. */
type ProjectRow = {
  id: string
  name: string
  runsLast24h: number
}

type ProjectsCardProps = {
  /**
   * Les projets à lister, dans l'ordre de l'appelant (`data.projects`). Au plus
   * `PROJECT_ROW_LIMIT` sont rendus — la carte est une colonne latérale dense,
   * pas un tableau.
   */
  projects: ProjectRow[]
  /** `kpis.executableNow` — agents pour lesquels le runtime accepterait un run maintenant. */
  executableNow: number | null
  /** `kpis.executableTotal` — la taille de catalogue dont le compte ci-dessus est extrait. */
  executableTotal: number | null
  /** `kpis.productionAgents` — agents promus en production. */
  productionAgents: number | null
}

const PROJECT_ROW_LIMIT = 5

export function ProjectsCard({ projects, executableNow, executableTotal, productionAgents }: ProjectsCardProps) {
  // Les deux moitiés du ratio viennent de la même lecture : elles sont absentes
  // ensemble, donc la ligne n'est mesurée que si les deux sont présentes.
  const executableMeasured = executableNow !== null && executableTotal !== null
  const rows = projects.slice(0, PROJECT_ROW_LIMIT)

  return (
    <Card>
      <CardHeader actions={<span className="text-xs text-zinc-500">Exéc. 24 h</span>}>
        <CardTitle icon={<RectangleStackIcon />}>Projets actifs</CardTitle>
      </CardHeader>

      <CardBody>
        {rows.length > 0 ? (
          <ul className="flex min-w-0 flex-col gap-2">
            {rows.map((project) => (
              <li key={project.id} className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent-500" />
                <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{project.name}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-400">
                  {project.runsLast24h}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Text className="text-xs">Aucun projet enregistré pour le moment.</Text>
        )}

        <Divider soft className="border-line" />

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {executableMeasured ? (
              <CheckCircleIcon className="size-4 shrink-0 text-accent-500" />
            ) : (
              <MinusCircleIcon className="size-4 shrink-0 text-zinc-600" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">Agents exécutables maintenant</span>
            {executableMeasured ? (
              <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-200">
                {executableNow} / {executableTotal}
              </span>
            ) : (
              <span className="shrink-0 text-xs text-zinc-500">{UNAVAILABLE_LABEL}</span>
            )}
          </div>

          <div className="flex min-w-0 items-center gap-2">
            {productionAgents === null ? (
              <MinusCircleIcon className="size-4 shrink-0 text-zinc-600" />
            ) : (
              <CheckCircleIcon className="size-4 shrink-0 text-accent-500" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">Agents en production</span>
            {productionAgents === null ? (
              <span className="shrink-0 text-xs text-zinc-500">{UNAVAILABLE_LABEL}</span>
            ) : (
              <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-200">{productionAgents}</span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col items-start gap-2">
          <h3 className="text-xs font-medium text-zinc-400">Historique d&apos;exécution</h3>
          <Button color="accent" href="/admin/runs">
            Ouvrir l&apos;historique
            <ArrowRightIcon />
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
