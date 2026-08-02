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
import { Strong, Text } from '@/components/ui/text'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { TOOL_IDS, TOOL_REGISTRY, type ToolDefinition } from '@/lib/agent-mission-control/registry'
import type { ToolsTabData } from './server-reads'
import { Fact, FactValue, MutationBadge, RiskBadge } from './atoms'

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
}: Readonly<{
  tool: ToolDefinition
  usage: { mountedOn: number; unresolvedOn: number } | null
}>) {
  return (
    <li className="px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Strong className="truncate">{tool.label}</Strong>
        <code className="aig-text-muted truncate text-xs">{tool.id}</code>
        <MutationBadge mutates={tool.mutates} />
        <RiskBadge risk={tool.risk} />
        <Text className="aig-text-faint text-xs">
          {tool.requiresConfirmation ? 'confirmation requise' : 'confirmation non requise'}
          {tool.certification !== 'certified' ? ` · ${tool.certification}` : ''}
        </Text>
      </div>

      {/*
        LA DESCRIPTION. Elle porte le contrat que le schéma ne peut pas dire, et
        c'est pour ça qu'elle n'est jamais tronquée à une ligne ici.
      */}
      <Text className="mt-1">{tool.summary}</Text>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <Text className="aig-text-faint text-xs">
          {tool.kind} · {tool.provenance} · runtimes: {tool.runtimes.join(', ')}
        </Text>
        {tool.secretRefs.length > 0 ? (
          <Text
            className="aig-text-faint text-xs"
            title="Les secrets que cet outil consulte, désignés par leur NOM. Aucune valeur n’est lue ni affichée ici."
          >
            secrets : {tool.secretRefs.join(', ')}
          </Text>
        ) : null}
        {usage === null ? (
          <Text className="aig-text-faint text-xs" title="Le catalogue d’agents n’a pas pu être lu : l’usage réel de cet outil est inconnu, pas nul.">
            usage inconnu
          </Text>
        ) : (
          <Text
            className={usage.unresolvedOn > 0 ? 'text-(--aig-severity-bad) text-xs' : 'aig-text-faint text-xs'}
            title="Ces agents DÉCLARENT cet outil sans qu’il résolve vers un handler enregistré : ils ne peuvent pas faire ce qu’ils annoncent."
          >
            monté sur {usage.mountedOn} agent(s) · non résolu : {usage.unresolvedOn}
          </Text>
        )}
      </div>
    </li>
  )
}

export default function ToolsTab({ data }: Readonly<{ data: ToolsTabData }>) {
  // Dérivé, jamais écrit à la main.
  const tools = TOOL_IDS.map((id) => TOOL_REGISTRY[id])
  const mutating = tools.filter((tool) => tool.mutates)
  const confirmRequired = tools.filter((tool) => tool.requiresConfirmation)
  const agents = data.agents.ok ? data.agents.data : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <section className="min-h-0 shrink-0">
        <h3 className="text-sm font-semibold">Registre canonique des outils</h3>
        <p className="aig-text-faint text-xs">l’autorité unique</p>
        <div className="aig-hairline my-2" />
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
                  <div className="aig-line border-l pl-3">
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
                        <code key={id} className="aig-text-muted text-xs">
                          {id}
                        </code>
                      ))}
                    </div>
                  </div>
                ) : null
              })()
            : null}
        </div>
      </section>

      <section className="min-h-80 min-w-0 xl:flex-1">
        <h3 className="text-sm font-semibold">Outils</h3>
        <p className="aig-text-faint text-xs">{tools.length} au registre</p>
        <div className="aig-hairline my-2" />
        {/*
          Le registre est PUR : il se rend TOUJOURS, même catalogue muet. Il n'est
          pas enveloppé dans un `LoadedBlock` parce qu'il n'y a rien à charger —
          masquer la déclaration parce que la base ne répond pas rendrait
          indisponible la seule information de cet écran qui ne dépend d'aucun
          backend. Seule la colonne d'usage devient inconnue, et chaque ligne le
          DIT plutôt que d'afficher « monté sur 0 agent », qui serait faux.
        */}
        <ul className="scroll-thin divide-y divide-[color:var(--aig-line-soft)] overflow-y-auto">
          {tools.map((tool) => (
            <ToolRow
              key={tool.id}
              tool={tool}
              usage={agents === null ? null : usageOf(tool.id, agents)}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}
