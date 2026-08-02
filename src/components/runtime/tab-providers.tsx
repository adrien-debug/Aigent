/**
 * Onglet Providers — ce qui est câblé, ce qui est opt-in, ce qui ne l'est pas.
 *
 * C'EST L'ÉCRAN QUI DOIT LE PLUS RÉSISTER À LA BROCHURE.
 *
 * Quatre distinctions, jamais aplaties :
 *  · `openai` et `google` sont CÂBLÉS, tool-use compris. Gemini n'est pas un
 *    provider dégradé : ses functionDeclarations, son functionCallingConfig et
 *    ses functionResponse sont réellement branchés.
 *  · Le parc `local`/vLLM est un OPT-IN EXPLICITE. Même tous endpoints déclarés,
 *    il ne se présente pas comme « disponible » au même titre que les deux
 *    précédents : l'absence de configuration y est l'état normal d'un poste hors
 *    du parc, pas une panne à réparer.
 *  · `mistral` n'est PAS CÂBLÉ. Ce n'est pas une clé manquante : il n'y a pas de
 *    code. Un appel lève une erreur typée, et il n'y a jamais de repli silencieux
 *    vers un autre provider. Aucune variable d'environnement ne l'activera.
 *
 * Et une distinction de plus, côté runtimes : LangGraph est le SEUL runtime
 * produit exécutable. Les trois autres identifiants du registre existent pour
 * des raisons historiques ou de typage et n'ont AUCUN moteur.
 *
 * Aucun appel LLM n'est émis par cet écran. `providerAvailable` est une lecture
 * d'environnement pure, et seule la PRÉSENCE d'une clé est lue — jamais sa
 * valeur, qui n'est ni transportée ni affichée.
 */
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { RUNTIME_IDS, RUNTIME_REGISTRY } from '@/lib/agent-mission-control/registry'
import type { ProviderRow, ProvidersTabData } from './server-reads'
import { Fact, FactValue, LoadedBlock, ProvenEmpty, ProviderWiringBadge } from './atoms'

function ProviderCard({ row, usedBy }: Readonly<{ row: ProviderRow; usedBy: number | null }>) {
  return (
    <li className="px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Strong className="truncate">{row.label}</Strong>
        <code className="aig-text-muted text-xs">{row.id}</code>
        <ProviderWiringBadge wiring={row.wiring} />
        <Text className="aig-text-faint text-xs">
          {row.toolUse ? 'tool-use câblé' : 'tool-use sans objet'}
        </Text>
        {usedBy === null ? (
          <Badge color="zinc" title="Le catalogue d’agents n’a pas pu être lu : le nombre d’agents sur ce provider est inconnu, pas nul.">
            usage inconnu
          </Badge>
        ) : (
          <Badge color="zinc">{usedBy} agent(s)</Badge>
        )}
      </div>

      <Text className="mt-1">{row.note}</Text>

      {row.envVars.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Text className="text-xs">Variables consultées :</Text>
          {row.envVars.map((name) => (
            <code
              key={name}
              className="aig-text-muted text-xs"
              title="Seule la PRÉSENCE de cette variable est lue. Sa valeur n’est jamais affichée, loggée ni transportée jusqu’à cet écran."
            >
              {name}
            </code>
          ))}
        </div>
      ) : (
        <Text className="mt-1.5 text-xs">
          Aucune variable d’environnement — il n’y a rien à configurer, il faudrait du code.
        </Text>
      )}
    </li>
  )
}

export default function ProvidersTab({ data }: Readonly<{ data: ProvidersTabData }>) {
  const agents = data.agents.ok ? data.agents.data : null
  const runtimes = RUNTIME_IDS.map((id) => RUNTIME_REGISTRY[id])
  const executable = runtimes.filter((rt) => rt.engine !== 'none')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <section className="min-h-0 shrink-0">
        <h3 className="text-sm font-semibold">Runtimes</h3>
        <p className="aig-text-faint text-xs">registre canonique</p>
        <div className="aig-hairline my-2" />
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Runtimes déclarés" value={<FactValue>{runtimes.length}</FactValue>} />
            <Fact
              label="Avec un moteur réel"
              value={<FactValue>{executable.length}</FactValue>}
              hint="les seuls exécutables"
            />
            <Fact
              label="Sélectionnables à la création"
              value={<FactValue>{runtimes.filter((rt) => rt.creatable).length}</FactValue>}
            />
          </div>
          <ul className="flex flex-col gap-2">
            {runtimes.map((runtime) => (
              <li key={runtime.id} className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Strong className="truncate">{runtime.label}</Strong>
                  <code className="aig-text-muted text-xs">{runtime.id}</code>
                  <Badge
                    color={runtime.engine === 'none' ? 'zinc' : 'emerald'}
                    title={
                      runtime.engine === 'none'
                        ? 'Aucun moteur derrière cet identifiant : il ne peut pas être exécuté, ni sélectionné à la création.'
                        : 'Moteur réel — ce runtime exécute vraiment.'
                    }
                  >
                    {runtime.engine === 'none' ? 'aucun moteur' : `moteur ${runtime.engine}`}
                  </Badge>
                  <Text className="aig-text-faint text-xs">
                    {runtime.creatable ? 'sélectionnable' : 'non sélectionnable'}
                  </Text>
                </div>
                <Text className="text-xs">{runtime.note}</Text>
              </li>
            ))}
          </ul>
          {/* Un rappel de contrainte, pas une alerte : liseré discret de la
              grammaire, aucun palier d'attention. */}
          <div className="aig-line border-l pl-3">
            <Text>
              LangGraph est le seul runtime produit exécutable, et cette contrainte est imposée à
              quatre endroits indépendants : le schéma de création, la garde d’exécution, le contrat
              canonique et ce registre. Les trois autres identifiants existent pour des raisons
              historiques ou de typage.
            </Text>
          </div>
        </div>
      </section>

      <section className="min-h-64 min-w-0 xl:flex-1">
        <h3 className="text-sm font-semibold">Providers de modèle</h3>
        <p className="aig-text-faint text-xs">câblage réel, pas catalogue commercial</p>
        <div className="aig-hairline my-2" />
        <ul className="scroll-thin divide-y divide-[color:var(--aig-line-soft)] overflow-y-auto">
          {data.providers.map((row) => (
            <ProviderCard
              key={row.id}
              row={row}
              usedBy={agents === null ? null : agents.filter((a) => a.provider === row.id).length}
            />
          ))}
        </ul>
      </section>

      <section className="min-h-0 shrink-0">
        <h3 className="text-sm font-semibold">Providers observés sur le catalogue</h3>
        <div className="aig-hairline my-2" />
        <LoadedBlock loaded={data.agents} what="Le catalogue d’agents">
          {(rows) => {
            // `provider` est `null`-able au contrat et le reste : aucun provider
            // par défaut n'est fabriqué. Les agents non résolus sont comptés à
            // part, jamais versés d'office dans « openai ».
            const unresolved = rows.filter((a) => a.provider === null).length
            const observed = new Map<string, number>()
            for (const agent of rows) {
              if (agent.provider === null) continue
              observed.set(agent.provider, (observed.get(agent.provider) ?? 0) + 1)
            }

            if (rows.length === 0) {
              return <ProvenEmpty detail="Le catalogue est vide : aucun agent ne déclare de provider." />
            }

            return (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Text className="aig-text-faint text-xs">
                    {[...observed.entries()].map(([provider, count]) => `${provider} · ${count}`).join(' | ') || 'aucun provider observé'}
                  </Text>
                  {unresolved > 0 ? (
                    <Badge
                      color="amber"
                      title="Le provider de ces agents n’a pas pu être résolu depuis la vérité persistée. Il reste null : aucun provider par défaut n’est inventé, parce qu’un provider inventé produirait un coût faux."
                    >
                      non résolu · {unresolved}
                    </Badge>
                  ) : null}
                </div>
                {observed.size === 0 ? (
                  <Text>
                    Aucun agent du catalogue n’a de provider résolu. Ce n’est pas « zéro agent
                    OpenAI » : c’est une information absente de la vérité persistée.
                  </Text>
                ) : null}
              </div>
            )
          }}
        </LoadedBlock>
      </section>
    </div>
  )
}
