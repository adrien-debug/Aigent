/**
 * Onglet LangGraph — l'Agent Server, et le piège qu'il ne signale pas lui-même.
 *
 * DEUX FAITS QUE CET ÉCRAN EXISTE POUR DIRE
 * -----------------------------------------
 * 1. LE SERVEUR EST-IL JOIGNABLE ? Il n'existe aucune fonction de ping dans le
 *    lib : la seule preuve honnête qu'un serveur répond est une lecture qui a
 *    abouti. Un Agent Server éteint est donc un ÉTAT AFFICHÉ — l'endpoint
 *    configuré, plus l'échec exact de la lecture — et non une page en erreur.
 *    En dev, l'endpoint attendu est `http://127.0.0.1:2024` ; le résolveur
 *    REFUSE un endpoint distant hors production, et cette levée est elle-même
 *    une information à montrer.
 *
 * 2. LE PIÈGE DE L'ASSISTANT. Un copilote `langgraph` SANS assistant provisionné
 *    ne tombe pas en erreur : il tourne contre le graphe nu, hérite des outils
 *    génériques hérités, et répond « pas de données » avec zéro appel d'outil,
 *    EN PARAISSANT SAIN partout ailleurs. Aucune gate ne le détecte. Cet écran
 *    est l'endroit où il se voit, croisé dans les deux sens : ce que la base
 *    prétend avoir provisionné, et ce que le serveur porte réellement en
 *    mémoire — `langgraphjs dev` garde ses assistants en RAM, donc un
 *    redémarrage les efface pendant que la base conserve son `assistant_id`.
 */
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { LangGraphTabData } from './server-reads'
import { Fact, FactValue, LoadedBlock, ProvenEmpty, ProvisioningBadge } from './atoms'
import { provisioningState } from './model'

/* ──────────────────────────── L'endpoint ────────────────────────────── */

function EndpointPanel({ data }: Readonly<{ data: LangGraphTabData }>) {
  // Le serveur est réputé joignable UNIQUEMENT si une lecture a abouti. On ne
  // déduit rien de la seule présence d'une URL : une URL est une intention.
  const reachable = data.assistants.ok

  return (
    <Panel title="Agent Server" hint="joignabilité déduite d’une lecture réelle" className="min-h-0 shrink-0">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {data.endpoint.ok ? (
            <Badge
              color={reachable ? 'emerald' : 'red'}
              title={
                reachable
                  ? 'Une lecture a abouti sur cet endpoint : le serveur répond réellement.'
                  : 'L’endpoint est configuré mais aucune lecture n’a abouti. Le serveur ne répond pas — ce n’est pas un catalogue vide.'
              }
            >
              {reachable ? 'serveur joignable' : 'serveur injoignable'}
            </Badge>
          ) : (
            <Badge
              color="red"
              title="Le résolveur d’endpoint a REFUSÉ la configuration : il interdit un endpoint distant hors production et un endpoint local en production."
            >
              endpoint refusé
            </Badge>
          )}
          <Badge
            color={data.secretConfigured ? 'emerald' : 'amber'}
            title="Présence de LANGGRAPH_SERVER_SECRET dans cet environnement. Seule sa PRÉSENCE est lue — jamais sa valeur, qui n’est ni affichée ni transportée jusqu’ici."
          >
            {data.secretConfigured ? 'secret de service présent' : 'secret de service absent'}
          </Badge>
          <Badge color="zinc" title="Le graphe interrogé par cette surface.">
            graphe {data.graphId}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact
            label="Endpoint configuré"
            value={
              data.endpoint.ok ? (
                <code className="text-sm">{data.endpoint.data}</code>
              ) : null
            }
            why="La résolution de l’endpoint a levé : la configuration est refusée, il n’y a donc pas d’URL à afficher."
            hint={data.endpoint.ok ? undefined : data.endpoint.reason}
          />
          <Fact
            label="Dernière lecture"
            value={
              // `reachable` EST `data.assistants.ok` (l. 37) : le ternaire
              // portait une troisième branche inatteignable, qui laissait
              // croire à un état intermédiaire inexistant.
              reachable ? (
                <FactValue>aboutie</FactValue>
              ) : (
                <Text className="truncate text-xs" title={data.assistants.reason}>
                  {data.assistants.reason}
                </Text>
              )
            }
          />
        </div>

        {data.endpoint.ok && !reachable ? (
          <div className="rounded-md border border-red-400/25 bg-red-400/5 px-3 py-2">
            <Strong className="block">L’Agent Server ne répond pas</Strong>
            <Text className="mt-0.5">
              L’endpoint est configuré et accepté, mais aucune lecture n’a abouti. Les panneaux
              ci-dessous ne montrent donc rien — non parce que le serveur est vide, mais parce qu’il
              n’a pas pu être interrogé. Tout run produit passe par ce serveur : tant qu’il est
              muet, aucun agent LangGraph ne s’exécute.
            </Text>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

/* ────────────────────── Le piège de l'assistant ─────────────────────── */

/**
 * Le croisement base ↔ serveur, en trois populations distinctes.
 *
 * `bareGraph` est la population qui compte : runtime LangGraph, aucun
 * `assistant_id` persisté. Elle est calculée sur le strict `=== false` du
 * contrat canonique — jamais sur un `!truthy`, qui absorberait le `null`
 * « non applicable » et accuserait des agents parfaitement sains.
 *
 * `staleAssistant` est le second piège, celui de la liveness : la base porte un
 * `assistant_id` que le serveur ne connaît pas. Il n'est calculable QUE si la
 * liste des assistants a été lue ; sinon la question reste ouverte et on ne
 * l'affiche pas, plutôt que de compter tout le monde comme périmé.
 */
function crossReference(agents: AvailableAgent[], serverAssistantIds: Set<string> | null) {
  const langgraph = agents.filter((a) => a.runtime === 'langgraph')
  const bareGraph = langgraph.filter((a) => a.runtimeProvisioned === false)
  const provisioned = langgraph.filter((a) => a.runtimeProvisioned === true)
  const staleAssistant =
    serverAssistantIds === null
      ? null
      : provisioned.filter((a) => a.assistantId !== null && !serverAssistantIds.has(a.assistantId))
  return { langgraph, bareGraph, provisioned, staleAssistant }
}

function ProvisioningPanel({ data }: Readonly<{ data: LangGraphTabData }>) {
  const serverIds = data.assistants.ok
    ? new Set(data.assistants.data.map((a) => a.assistantId))
    : null

  return (
    <Panel
      title="Provisioning des assistants"
      hint="le défaut qu’aucune gate ne détecte"
      className="min-h-0 shrink-0"
    >
      <LoadedBlock loaded={data.agents} what="Le catalogue d’agents">
        {(agents) => {
          const { langgraph, bareGraph, provisioned, staleAssistant } = crossReference(agents, serverIds)

          if (langgraph.length === 0) {
            return (
              <ProvenEmpty detail="Aucun agent du catalogue n’est en runtime LangGraph. La question du provisioning ne se pose donc pour personne." />
            )
          }

          return (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Fact label="Agents LangGraph" value={<FactValue>{langgraph.length}</FactValue>} />
                <Fact
                  label="Assistant persisté"
                  value={<FactValue>{provisioned.length}</FactValue>}
                  hint="assistant_id présent en base"
                />
                <Fact
                  label="Graphe nu"
                  value={<FactValue>{bareGraph.length}</FactValue>}
                  hint="assistant_id vide — le piège"
                />
                <Fact
                  label="Assistant périmé"
                  value={staleAssistant === null ? null : <FactValue>{staleAssistant.length}</FactValue>}
                  why="La liste des assistants du serveur n’a pas pu être lue : on ne peut pas savoir lesquels ont disparu de sa mémoire."
                  hint={staleAssistant === null ? undefined : 'en base, inconnu du serveur'}
                />
              </div>

              {bareGraph.length > 0 ? (
                <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2">
                  <Strong className="block">
                    {bareGraph.length} agent(s) LangGraph tournent contre le graphe nu
                  </Strong>
                  <Text className="mt-0.5">
                    Leur runtime est LangGraph mais <code>assistant_id</code> est vide. Un run
                    n’échouera pas pour autant : il s’exécutera contre le graphe nu, héritera des
                    outils génériques hérités, et répondra « pas de données » avec zéro appel
                    d’outil — en paraissant parfaitement sain dans le roster comme dans les runs.
                    L’ordre de réparation est obligatoire : provisionner l’assistant D’ABORD, basculer
                    le runtime ENSUITE. Basculer le runtime seul recrée le défaut.
                  </Text>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {bareGraph.map((agent) => (
                      <li key={agent.copilotId}>
                        <Link href={`/agents/${agent.copilotId}`} className="text-sm">
                          {agent.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {staleAssistant !== null && staleAssistant.length > 0 ? (
                <div className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2">
                  <Strong className="block">
                    {staleAssistant.length} assistant(s) persisté(s) que le serveur ne connaît pas
                  </Strong>
                  <Text className="mt-0.5">
                    La base porte un <code>assistant_id</code> absent de l’Agent Server. C’est l’état
                    normal après un redémarrage de <code>langgraphjs dev</code>, qui garde ses
                    assistants en mémoire pendant que la base conserve l’identifiant. La résolution
                    au lancement re-provisionne à la volée ; ce panneau dit simplement que
                    l’identifiant persisté n’est, à cet instant, adossé à rien côté serveur.
                  </Text>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {staleAssistant.map((agent) => (
                      <li key={agent.copilotId}>
                        <Link href={`/agents/${agent.copilotId}`} className="text-sm">
                          {agent.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <ul className="flex flex-col gap-1.5">
                {langgraph.map((agent) => (
                  <li key={agent.copilotId} className="flex min-w-0 items-center gap-2">
                    <Link href={`/agents/${agent.copilotId}`} className="min-w-0 flex-1 truncate text-sm">
                      {agent.name}
                    </Link>
                    <ProvisioningBadge runtimeProvisioned={agent.runtimeProvisioned} />
                    {provisioningState(agent.runtimeProvisioned) === 'provisioned' &&
                    serverIds !== null &&
                    agent.assistantId !== null &&
                    !serverIds.has(agent.assistantId) ? (
                      <Badge color="amber" title="L’identifiant persisté n’existe pas sur le serveur à cet instant.">
                        inconnu du serveur
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )
        }}
      </LoadedBlock>
    </Panel>
  )
}

/* ─────────────────────── Assistants & threads ───────────────────────── */

/**
 * `min-h-[24rem]` sur la grille, PAS `min-h-0` : dans une colonne flex dont les
 * panneaux précédents ont déjà pris la hauteur, un `min-height: 0` laissait
 * cette grille à h=0 — mesuré dans le navigateur, pas déduit. Ses deux panneaux
 * étaient alors invisibles et leur contenu inatteignable, sans aucun signal à
 * l'écran. Le plancher les rend lisibles ; le débordement est absorbé par le
 * défilement de la colonne.
 */
function ServerStatePanel({ data }: Readonly<{ data: LangGraphTabData }>) {
  return (
    <div className="grid min-h-[24rem] shrink-0 grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel
        title="Assistants du serveur"
        hint="en mémoire, pas en base"
        className="min-h-[12rem] min-w-0"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        <LoadedBlock loaded={data.assistants} what="La liste des assistants">
          {(rows) =>
            rows.length === 0 ? (
              <div className="p-4">
                <ProvenEmpty detail="Le serveur répond et ne porte aucun assistant. Tout run partirait donc sur le graphe nu." />
              </div>
            ) : (
              <ul>
                {rows.map((assistant) => (
                  <li
                    key={assistant.assistantId}
                    className="border-b border-zinc-950/5 px-4 py-2 last:border-b-0 dark:border-white/5"
                  >
                    <Strong className="block truncate">{assistant.name ?? assistant.assistantId}</Strong>
                    <Text className="truncate text-xs">
                      {assistant.graphId ? `${assistant.graphId} · ` : ''}
                      <code>{assistant.assistantId}</code>
                    </Text>
                  </li>
                ))}
              </ul>
            )
          }
        </LoadedBlock>
      </Panel>

      <Panel
        title="Threads récents"
        hint="50 plus récents"
        className="min-h-[12rem] min-w-0"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        <LoadedBlock loaded={data.threads} what="La liste des threads">
          {(rows) =>
            rows.length === 0 ? (
              <div className="p-4">
                <ProvenEmpty detail="Le serveur répond et ne porte aucun thread : aucune conversation n’est en cours ni conservée." />
              </div>
            ) : (
              <ul>
                {rows.map((thread) => (
                  <li
                    key={thread.threadId}
                    className="flex items-center gap-2 border-b border-zinc-950/5 px-4 py-2 last:border-b-0 dark:border-white/5"
                  >
                    <Badge
                      color={
                        thread.status === 'interrupted'
                          ? 'amber'
                          : thread.status === 'error'
                            ? 'red'
                            : 'zinc'
                      }
                      title={
                        thread.status === 'interrupted'
                          ? 'Le run est en pause sur un interrupt et attend une confirmation humaine.'
                          : undefined
                      }
                    >
                      {thread.status}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <Text className="truncate text-xs">
                        <code>{thread.threadId}</code>
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

/* ──────────────────────────── Topologie ─────────────────────────────── */

function TopologyPanel({ data }: Readonly<{ data: LangGraphTabData }>) {
  return (
    <Panel title={`Topologie · ${data.graphId}`} className="min-h-0 shrink-0">
      <LoadedBlock loaded={data.topology} what="La topologie du graphe">
        {(topology) =>
          // Le serveur peut répondre SANS exposer sa topologie : c'est une
          // absence de capacité, pas un graphe vide.
          !topology.topologyAvailable ? (
            <ProvenEmpty detail="Le serveur ne publie pas la topologie de ce graphe. Ce n’est pas un graphe sans nœuds — c’est une information que l’API ne rend pas." />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color="zinc">{topology.nodes.length} nœud(s)</Badge>
                <Badge color="zinc">{topology.edges.length} arête(s)</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {topology.nodes.map((node) => (
                  <Badge key={node.id} color="sky" title={node.type}>
                    {node.label || node.id}
                  </Badge>
                ))}
              </div>
            </div>
          )
        }
      </LoadedBlock>
    </Panel>
  )
}

/**
 * PAS de `xl:overflow-hidden` sur la colonne : au-delà de 1280 il cessait de
 * défiler et COUPAIT — « Assistants du serveur » et « Threads récents »
 * mesuraient 0 px, contenu inatteignable, sans qu'aucun signal ne l'indique.
 * Un onglet à six panneaux ne tient pas dans un viewport, et le nier ne le fait
 * pas rentrer : il défile ici, dans une zone bornée. Le zéro-scroll de la PAGE
 * reste tenu par le `h-full overflow-hidden` de `runtime-screen`.
 */
export default function LangGraphTab({ data }: Readonly<{ data: LangGraphTabData }>) {
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <EndpointPanel data={data} />
      <ProvisioningPanel data={data} />
      <ServerStatePanel data={data} />
      <TopologyPanel data={data} />
    </div>
  )
}
