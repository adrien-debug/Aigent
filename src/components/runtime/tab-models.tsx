/**
 * Onglet Modèles — les modèles adressables, et ceux réellement prouvés.
 *
 * POURQUOI IL N'Y A PAS DE CATALOGUE OPENAI/GOOGLE ICI.
 * Ce repo n'exporte aucun catalogue de modèles OpenAI ou Gemini : leurs
 * identifiants ne vivent que comme clés privées de la table de tarification, qui
 * n'est pas exportée. Recopier cette liste dans une UI produirait un catalogue
 * qui dériverait en silence à la première mise à jour tarifaire — un écran qui
 * proposerait des modèles retirés, ou tairait les nouveaux, sans que rien ne
 * casse. Cet onglet montre donc ce qui est OBSERVÉ sur la vérité persistée :
 * les modèles que les agents déclarent, et ceux que les runs ont réellement
 * prouvés. Le parc local, lui, EST un registre exporté : il se liste en entier.
 *
 * CONFIGURÉ ≠ JOIGNABLE. Un endpoint local « configuré » signifie que ses
 * variables sont présentes ici. Cela ne prouve pas que l'hôte répond : rien dans
 * cet écran ne contacte le parc, et un hôte éteint donnerait exactement le même
 * affichage.
 *
 * MODÈLE CONFIGURÉ ≠ MODÈLE EXÉCUTÉ. Le contrat canonique sépare
 * `configuredModel` (ce qui est déclaré) de `executedModel` (ce qu'un run a
 * prouvé). Un modèle non prouvé n'est pas un modèle faux — c'est un modèle dont
 * l'exécution n'a rien rapporté. Les deux ne se fondent jamais en une colonne.
 */
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { ModelsTabData } from './server-reads'
import { Fact, FactValue, LoadedBlock, NotMeasured, ProvenEmpty } from './atoms'

export default function ModelsTab({ data }: Readonly<{ data: ModelsTabData }>) {
  const configuredLocal = data.local.filter((row) => row.configured)

  return (
    <div className="flex flex-col gap-3">
      <section className="min-h-0 shrink-0">
        <h3 className="text-sm font-semibold">Parc local — vLLM</h3>
        <p className="aig-text-faint text-xs">
          {configuredLocal.length}/{data.local.length} endpoint(s) déclaré(s) ici
        </p>
        <div className="aig-hairline my-2" />
        <div className="flex flex-col gap-3">
          <Text>
            Le parc local est un opt-in explicite. Un endpoint « déclaré » signifie que ses variables
            sont présentes dans cet environnement — rien ici ne contacte le parc, donc cela ne prouve
            pas que l’hôte répond. Un hôte éteint produirait le même affichage ; à l’appel, il lèverait
            une erreur typée plutôt qu’un repli muet.
          </Text>
          <ul className="flex flex-col gap-2">
            {data.local.map((row) => (
              <li key={row.id} className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <code className="truncate text-sm">{row.id}</code>
                  <Badge
                    color={row.configured ? 'sky' : 'zinc'}
                    title={
                      row.configured
                        ? 'Les variables de cet endpoint sont présentes ici. Sa joignabilité réelle n’est pas testée par cet écran.'
                        : 'Les variables de cet endpoint sont absentes de cet environnement — l’état normal d’un poste hors du parc, pas une panne.'
                    }
                  >
                    {row.configured ? 'déclaré ici' : 'non déclaré ici'}
                  </Badge>
                  <Text className="aig-text-faint text-xs">
                    {row.contextTokens.toLocaleString('fr-FR')} jetons
                  </Text>
                </div>
                <Text className="text-xs">{row.description}</Text>
                <div className="mt-0.5 flex flex-wrap gap-2">
                  {[row.urlEnvVar, row.modelEnvVar].map((name) => (
                    <code
                      key={name}
                      className="aig-text-muted text-xs"
                      title="Seule la PRÉSENCE de cette variable est lue — jamais sa valeur."
                    >
                      {name}
                    </code>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="min-h-64 min-w-0 xl:flex-1">
        <h3 className="text-sm font-semibold">Modèles observés sur le catalogue</h3>
        <p className="aig-text-faint text-xs">déclaré vs prouvé</p>
        <div className="aig-hairline my-2" />
        <LoadedBlock loaded={data.agents} what="Le catalogue d’agents">
          {(agents) =>
            agents.length === 0 ? (
              <div className="p-4">
                <ProvenEmpty detail="Le catalogue est vide : aucun agent ne déclare de modèle." />
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Le `dark:border-white/5` qui traînait ici ne posait AUCUNE
                    bordure : sans utilitaire `border`, une couleur de liseré ne
                    dessine rien. Il est retiré plutôt que traduit — la
                    séparation d'avec la liste vient du `divide-y` en dessous. */}
                <div className="grid shrink-0 grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
                  <Fact label="Agents" value={<FactValue>{agents.length}</FactValue>} />
                  <Fact
                    label="Modèle déclaré"
                    value={
                      <FactValue>{agents.filter((a) => a.configuredModel !== null).length}</FactValue>
                    }
                  />
                  <Fact
                    label="Modèle prouvé"
                    value={<FactValue>{agents.filter((a) => a.executedModel !== null).length}</FactValue>}
                    hint="rapporté par un run"
                  />
                  <Fact
                    label="Modèles distincts"
                    value={
                      <FactValue>
                        {
                          new Set(
                            agents
                              .map((a) => a.configuredModel)
                              .filter((m): m is string => m !== null),
                          ).size
                        }
                      </FactValue>
                    }
                  />
                </div>
                <ul className="divide-y divide-[color:var(--aig-line-soft)]">
                  {agents.map((agent) => {
                    // Un écart déclaré/prouvé n'est un écart que si les DEUX
                    // sont connus. Un `executedModel` absent est une absence de
                    // preuve, jamais une contradiction.
                    const mismatch =
                      agent.configuredModel !== null &&
                      agent.executedModel !== null &&
                      agent.configuredModel !== agent.executedModel

                    return (
                      <li
                        key={agent.copilotId}
                        className="flex min-w-0 items-center gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <Link href={`/agents/${agent.copilotId}`} className="block min-w-0 truncate">
                            <Strong className="truncate">{agent.name}</Strong>
                          </Link>
                          <Text className="truncate text-xs">
                            {agent.provider ?? 'provider non résolu'}
                          </Text>
                        </div>
                        <div className="hidden min-w-0 shrink-0 sm:block sm:w-48">
                          <Text className="truncate text-xs">déclaré</Text>
                          <div className="truncate">
                            {agent.configuredModel === null ? (
                              <NotMeasured why="Aucun modèle n’est déclaré dans la vérité persistée. Aucun défaut n’est inventé à la place." />
                            ) : (
                              <code className="text-xs">{agent.configuredModel}</code>
                            )}
                          </div>
                        </div>
                        <div className="hidden min-w-0 shrink-0 sm:block sm:w-48">
                          <Text className="truncate text-xs">prouvé</Text>
                          <div className="truncate">
                            {agent.executedModel === null ? (
                              <NotMeasured why="Aucun run n’a rapporté le modèle réellement servi. Non prouvé n’est pas « faux » : c’est une absence de preuve." />
                            ) : (
                              <code className="text-xs">{agent.executedModel}</code>
                            )}
                          </div>
                        </div>
                        {mismatch ? <Text className="text-(--aig-severity-warn) text-xs">écart</Text> : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          }
        </LoadedBlock>
      </section>
    </div>
  )
}
