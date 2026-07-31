/**
 * Onglet Outils — le registre canonique, et l'écart entre déclaré et monté.
 *
 * LA DESCRIPTION EST AFFICHÉE, TOUJOURS.
 * Sur le chemin LangGraph, chaque outil est bâti avec un vrai schéma Zod : la
 * FORME des arguments parvient au modèle. Mais tout ce que la forme n'exprime
 * pas — quand appeler l'outil, ce que fait un appel sans argument, ce que
 * signifie un champ — ne vit QUE dans la description. Cas réel : une description
 * muette a fait refuser au modèle un « liste les projets » que l'appel sans
 * argument satisfaisait déjà. Un écran qui listerait des identifiants d'outils
 * sans leur texte cacherait précisément la partie du contrat qui casse.
 *
 * NATURE FAIL-CLOSED. `mutates` est déjà fail-closed en base — un outil dont le
 * handler n'a pas été PROUVÉ en lecture seule reste mutant. L'écran ne rattrape
 * pas ça en douceur : le doute s'affiche comme une mutation, avec le mot.
 *
 * NE RECOPIE AUCUN COMPTE. Le nombre d'outils est dérivé de `TOOL_IDS` à chaque
 * rendu. Deux gates recalculent ce registre et cassent si la déclaration et
 * l'exécutable divergent ; un nombre écrit à la main dans une UI, lui, ne casse
 * jamais — il ment simplement.
 */
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { TOOL_IDS, TOOL_REGISTRY, type ToolDefinition } from '@/lib/agent-mission-control/registry'
import type { ToolsTabData } from './server-reads'
import { ConfirmationBadge, Fact, FactValue, MutationBadge, RiskBadge } from './atoms'

/**
 * L'usage réel d'un outil, croisé depuis le roster.
 *
 * `mountedOn` compte les agents qui le déclarent ET le résolvent. `unresolvedOn`
 * compte ceux qui le déclarent SANS qu'il résolve vers un handler enregistré —
 * c'est ce qui rend un agent dégradé, et c'est invisible depuis le seul registre.
 */
function usageOf(toolId: string, agents: AvailableAgent[]) {
  let mountedOn = 0
  let unresolvedOn = 0
  for (const agent of agents) {
    if (agent.unresolvedToolIds.includes(toolId)) unresolvedOn += 1
    else if (agent.tools.some((tool) => tool.id === toolId)) mountedOn += 1
  }
  return { mountedOn, unresolvedOn }
}

function ToolRow({
  tool,
  usage,
}: {
  tool: ToolDefinition
  usage: { mountedOn: number; unresolvedOn: number } | null
}) {
  return (
    <li className="border-b border-zinc-950/5 px-4 py-3 last:border-b-0 dark:border-white/5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Strong className="truncate">{tool.label}</Strong>
        <code className="truncate text-xs text-zinc-500 dark:text-zinc-400">{tool.id}</code>
        <MutationBadge mutates={tool.mutates} />
        <RiskBadge risk={tool.risk} />
        <ConfirmationBadge required={tool.requiresConfirmation} />
        {tool.certification !== 'certified' ? (
          <Badge
            color={tool.certification === 'deprecated' ? 'red' : 'amber'}
            title="État de la DÉFINITION au registre — distinct de l’état d’un appel à l’exécution."
          >
            {tool.certification}
          </Badge>
        ) : null}
      </div>

      {/*
        LA DESCRIPTION. Elle porte le contrat que le schéma ne peut pas dire, et
        c'est pour ça qu'elle n'est jamais tronquée à une ligne ici.
      */}
      <Text className="mt-1">{tool.summary}</Text>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Badge color="zinc" title="La forme d’intégration de l’outil.">
          {tool.kind}
        </Badge>
        <Badge color="zinc">{tool.provenance}</Badge>
        <Badge color="zinc" title="Les runtimes qui peuvent monter cet outil.">
          {tool.runtimes.join(', ')}
        </Badge>
        {tool.secretRefs.length > 0 ? (
          <Badge
            color="amber"
            title="Les secrets que cet outil consulte, désignés par leur NOM. Aucune valeur n’est lue ni affichée ici."
          >
            secrets : {tool.secretRefs.join(', ')}
          </Badge>
        ) : null}
        {usage === null ? (
          <Badge color="zinc" title="Le catalogue d’agents n’a pas pu être lu : l’usage réel de cet outil est inconnu, pas nul.">
            usage inconnu
          </Badge>
        ) : (
          <>
            <Badge color={usage.mountedOn > 0 ? 'emerald' : 'zinc'}>
              monté sur {usage.mountedOn} agent(s)
            </Badge>
            {usage.unresolvedOn > 0 ? (
              <Badge
                color="red"
                title="Ces agents DÉCLARENT cet outil sans qu’il résolve vers un handler enregistré : ils ne peuvent pas faire ce qu’ils annoncent."
              >
                non résolu sur {usage.unresolvedOn}
              </Badge>
            ) : null}
          </>
        )}
      </div>
    </li>
  )
}

export default function ToolsTab({ data }: { data: ToolsTabData }) {
  // Dérivé, jamais écrit à la main.
  const tools = TOOL_IDS.map((id) => TOOL_REGISTRY[id])
  const mutating = tools.filter((tool) => tool.mutates)
  const confirmRequired = tools.filter((tool) => tool.requiresConfirmation)
  const agents = data.agents.ok ? data.agents.data : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto xl:overflow-hidden">
      <Panel title="Registre canonique des outils" hint="l’autorité unique" className="min-h-0 shrink-0">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Outils déclarés" value={<FactValue>{tools.length}</FactValue>} />
            <Fact
              label="Mutants"
              value={<FactValue>{mutating.length}</FactValue>}
              hint="doute inclus — fail-closed"
            />
            <Fact
              label="Confirmation requise"
              value={<FactValue>{confirmRequired.length}</FactValue>}
              hint="interrompent le run"
            />
            <Fact
              label="Outils non résolus"
              value={
                agents === null ? null : (
                  <FactValue>
                    {new Set(agents.flatMap((agent) => agent.unresolvedToolIds)).size}
                  </FactValue>
                )
              }
              why="Le catalogue d’agents n’a pas pu être lu : on ne sait pas quels outils déclarés ne résolvent pas."
              hint="déclarés sans handler"
            />
          </div>
          <Text>
            Ce registre est l’autorité canonique : la déclaration, et le contrat que l’exécutable doit
            réaliser. Deux gates recalculent l’ensemble et cassent si les deux divergent — les chiffres
            ci-dessus sont dérivés du registre à chaque rendu, jamais recopiés.
          </Text>
          {/*
            Les outils déclarés par des agents mais ABSENTS du registre : le
            registre seul ne peut pas les voir, puisqu'ils n'y sont pas.
          */}
          {agents !== null
            ? (() => {
                const unknown = [...new Set(agents.flatMap((a) => a.unresolvedToolIds))].filter(
                  (id) => !(id in TOOL_REGISTRY),
                )
                return unknown.length > 0 ? (
                  <div className="rounded-md border border-red-400/25 bg-red-400/5 px-3 py-2">
                    <Strong className="block">
                      {unknown.length} outil(s) déclaré(s) hors du registre
                    </Strong>
                    <Text className="mt-0.5">
                      Des agents déclarent ces identifiants, que le registre canonique ne connaît pas
                      et vers lesquels aucun handler ne résout. Les agents concernés sont dégradés :
                      ils annoncent une capacité qu’ils ne peuvent pas exercer.
                    </Text>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {unknown.map((id) => (
                        <code key={id} className="text-xs text-zinc-500 dark:text-zinc-400">
                          {id}
                        </code>
                      ))}
                    </div>
                  </div>
                ) : null
              })()
            : null}
        </div>
      </Panel>

      <Panel
        title="Outils"
        hint={`${tools.length} au registre`}
        className="min-h-[20rem] min-w-0 xl:min-h-0 xl:flex-1"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        {/*
          Le registre est PUR : il se rend TOUJOURS, même catalogue muet. Il n'est
          pas enveloppé dans un `LoadedBlock` parce qu'il n'y a rien à charger —
          masquer la déclaration parce que la base ne répond pas rendrait
          indisponible la seule information de cet écran qui ne dépend d'aucun
          backend. Seule la colonne d'usage devient inconnue, et chaque ligne le
          DIT plutôt que d'afficher « monté sur 0 agent », qui serait faux.
        */}
        <ul>
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              usage={agents === null ? null : usageOf(tool.id, agents)}
            />
          ))}
        </ul>
      </Panel>
    </div>
  )
}
