/**
 * Onglet Dépôts — les dépôts liés aux projets, et leur LISIBILITÉ.
 *
 * LA SEULE QUESTION HONNÊTE QU'ON PEUT POSER ICI.
 * Sans cloner quoi que ce soit, la seule chose vérifiable sur un dépôt est :
 * apparaît-il dans ce que le jeton GitHub configuré peut voir ? Un dépôt qu'un
 * projet référence mais qui n'apparaît pas n'est PAS un dépôt vide — c'est un
 * dépôt qu'on ne voit pas, ce qui est le plus souvent une question de droits ou
 * de nom obsolète. Les deux se rendent différemment, toujours.
 *
 * RÉSERVE CONNUE, DITE PLUTÔT QUE MASQUÉE.
 * `getRepoTree` demande bien `truncated` à l'API GitHub puis ne le lit jamais,
 * et son type de retour n'a aucun moyen de le transporter. Un arbre tronqué par
 * l'API est donc aujourd'hui indiscernable d'un arbre complet. Conséquence tenue
 * ici : cet écran N'AFFICHE AUCUN ARBRE et AUCUN COMPTE DE FICHIERS. Afficher
 * « 412 fichiers » sur une lecture qui peut être silencieusement partielle serait
 * précisément le chiffre faux que cette surface existe pour ne pas produire. La
 * réserve est affichée en toutes lettres, pour que personne n'ajoute cette
 * colonne en croyant qu'elle serait fiable.
 *
 * AUCUNE ÉCRITURE. Cet onglet ne pousse rien. Une écriture GitHub réelle exige
 * deux verrous indépendants, et ils n'existent nulle part sur cette surface.
 */
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import type { GithubRepoSummary } from '@/lib/agent-mission-control/github'
import type { Project } from '@/lib/agent-mission-control/types'
import type { RepositoriesTabData } from './server-reads'
import { Fact, FactValue, LoadedBlock, NotMeasured, ProvenEmpty } from './atoms'

/**
 * La lisibilité d'un dépôt référencé, en TROIS états.
 *
 * `unknown` n'est pas `unreadable` : si la liste des dépôts visibles n'a pas pu
 * être lue, on ne peut rien conclure sur AUCUN dépôt. Les marquer tous
 * illisibles serait transformer une panne du côté Aigent en accusation portée
 * sur des dépôts consommateurs parfaitement sains.
 */
type Readability = 'readable' | 'unreadable' | 'unknown'

function readabilityOf(repoFullName: string, visible: Set<string> | null): Readability {
  if (visible === null) return 'unknown'
  return visible.has(repoFullName) ? 'readable' : 'unreadable'
}

const READABILITY_LABEL: Record<Readability, string> = {
  readable: 'lisible',
  unreadable: 'non lisible',
  unknown: 'lisibilité inconnue',
}

const READABILITY_MEANING: Record<Readability, string> = {
  readable: 'Ce dépôt apparaît dans ce que le jeton GitHub configuré peut voir.',
  unreadable:
    'Ce dépôt est référencé par un projet mais n’apparaît pas dans ce que le jeton peut voir. Ce n’est pas un dépôt vide : c’est un dépôt invisible d’ici — droits insuffisants, ou nom devenu obsolète.',
  unknown:
    'La liste des dépôts visibles n’a pas pu être lue. Aucune conclusion n’est possible sur ce dépôt : ni lisible, ni illisible.',
}

function readabilityBadgeColor(readability: Readability): 'emerald' | 'amber' | 'zinc' {
  if (readability === 'readable') return 'emerald'
  if (readability === 'unreadable') return 'amber'
  return 'zinc'
}

function ProjectRow({
  project,
  visible,
}: Readonly<{ project: Project; visible: Set<string> | null }>) {
  const repoFullName = project.repoFullName ?? null
  const readability = repoFullName === null ? null : readabilityOf(repoFullName, visible)

  return (
    <li className="flex min-w-0 items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <Link href={`/projects/${project.id}`} className="block min-w-0 truncate">
          <Strong className="truncate">{project.name}</Strong>
        </Link>
        <div className="min-w-0 truncate">
          {repoFullName === null ? (
            // Un projet sans dépôt est un FAIT du contrat (`repoFullName` est
            // optionnel), pas une lecture manquée.
            <Text className="text-xs">aucun dépôt référencé</Text>
          ) : (
            <code className="text-xs text-zinc-500 dark:text-zinc-400">{repoFullName}</code>
          )}
        </div>
      </div>
      <div className="shrink-0">
        {readability === null ? null : (
          <Badge color={readabilityBadgeColor(readability)} title={READABILITY_MEANING[readability]}>
            {READABILITY_LABEL[readability]}
          </Badge>
        )}
      </div>
    </li>
  )
}

export default function RepositoriesTab({ data }: Readonly<{ data: RepositoriesTabData }>) {
  const visible: Set<string> | null = data.repos.ok
    ? new Set(data.repos.data.map((repo) => repo.fullName))
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <Panel title="Lisibilité des dépôts" hint="ce que le jeton configuré voit" className="min-h-0 shrink-0">
        <LoadedBlock loaded={data.projects} what="La liste des projets">
          {(projects) => {
            const withRepo = projects.filter((p) => p.repoFullName)
            const readable =
              visible === null
                ? null
                : withRepo.filter((p) => visible.has(p.repoFullName as string)).length

            return (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Fact label="Projets" value={<FactValue>{projects.length}</FactValue>} />
                  <Fact
                    label="Avec un dépôt"
                    value={<FactValue>{withRepo.length}</FactValue>}
                    hint="repoFullName renseigné"
                  />
                  <Fact
                    label="Dépôts lisibles"
                    value={readable === null ? null : <FactValue>{readable}</FactValue>}
                    why="La liste des dépôts visibles n’a pas pu être lue : aucune lisibilité ne peut être établie."
                  />
                  <Fact
                    label="Dépôts visibles du jeton"
                    value={visible === null ? null : <FactValue>{visible.size}</FactValue>}
                    why="La liste des dépôts n’a pas pu être lue. Ce n’est pas zéro dépôt — c’est une lecture échouée."
                  />
                </div>

                {!data.repos.ok ? (
                  <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2">
                    <Strong className="block">La liste des dépôts n’a pas pu être lue</Strong>
                    <Text className="mt-0.5">
                      Aucun dépôt n’est marqué lisible ou illisible : la question reste ouverte pour
                      tous. Marquer l’ensemble « non lisible » à cause d’une panne côté Aigent
                      accuserait des dépôts consommateurs parfaitement sains.
                    </Text>
                    <Text className="mt-1 truncate text-xs" title={data.repos.reason}>
                      {data.repos.reason}
                    </Text>
                  </div>
                ) : null}

                {/*
                  La réserve sur les arbres, affichée. Elle explique une absence
                  volontaire — sans elle, l'omission de la colonne « fichiers »
                  passerait pour un oubli et quelqu'un l'ajouterait.
                */}
                <div className="rounded-md border border-zinc-950/10 px-3 py-2 dark:border-white/10">
                  <Strong className="block">Pourquoi aucun arbre n’est affiché ici</Strong>
                  <Text className="mt-0.5">
                    La lecture d’arbre du produit demande bien à l’API GitHub si le résultat est
                    tronqué, puis ne lit jamais cette réponse, et son type de retour ne peut pas la
                    transporter. Un arbre tronqué est donc aujourd’hui indiscernable d’un arbre
                    complet. Tant que ce signal n’est pas remonté, aucun compte de fichiers ni aucune
                    arborescence n’est affiché : un total possiblement partiel présenté comme total
                    serait un chiffre faux.
                  </Text>
                </div>

                {projects.length === 0 ? (
                  <ProvenEmpty detail="Aucun projet n’est persisté. La lecture a réussi — il n’y a réellement rien." />
                ) : null}
              </div>
            )
          }}
        </LoadedBlock>
      </Panel>

      <Panel
        title="Projets et leurs dépôts"
        className="min-h-56 min-w-0 xl:flex-1"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        <LoadedBlock loaded={data.projects} what="La liste des projets">
          {(projects) =>
            projects.length === 0 ? (
              <div className="p-4">
                <ProvenEmpty detail="Aucun projet n’est persisté. La lecture a réussi et la table est réellement vide." />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
                {projects.map((project) => (
                  <ProjectRow key={project.id} project={project} visible={visible} />
                ))}
              </ul>
            )
          }
        </LoadedBlock>
      </Panel>

      <Panel
        title="Dépôts visibles du jeton"
        hint="non filtrés par projet"
        className="min-h-48 min-w-0 xl:flex-1"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        <LoadedBlock loaded={data.repos} what="La liste des dépôts GitHub">
          {(repos: GithubRepoSummary[]) =>
            repos.length === 0 ? (
              <div className="p-4">
                <ProvenEmpty detail="Le jeton GitHub a répondu et ne voit aucun dépôt. La lecture a réussi : la visibilité est réellement vide, ce n’est pas une panne." />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
                {repos.map((repo) => (
                  <li
                    key={repo.fullName}
                    className="flex min-w-0 items-center gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Strong className="truncate">{repo.fullName}</Strong>
                        {repo.private ? (
                          <Badge color="zinc" title="Dépôt privé — visible uniquement via le jeton configuré.">
                            privé
                          </Badge>
                        ) : null}
                      </div>
                      <div className="min-w-0 truncate">
                        {repo.description === null ? (
                          <NotMeasured why="Ce dépôt n’a pas de description sur GitHub. C’est une absence réelle, pas une lecture manquée." />
                        ) : (
                          <Text className="truncate text-xs">{repo.description}</Text>
                        )}
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <Text className="text-xs">
                        <code>{repo.defaultBranch}</code>
                      </Text>
                      <Text className="text-xs tabular-nums">
                        {new Date(repo.updatedAt).toLocaleDateString('fr-FR')}
                      </Text>
                    </div>
                  </li>
                ))}
              </ul>
            )
          }
        </LoadedBlock>
      </Panel>
    </div>
  )
}
