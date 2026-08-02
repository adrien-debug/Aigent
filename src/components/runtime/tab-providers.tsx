/**
 * Onglet Providers — câblage réel des runtimes et des providers de modèle.
 */
import { RUNTIME_IDS, RUNTIME_REGISTRY } from '@/lib/agent-mission-control/registry'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { Unavailable } from '@/components/cockpit/primitives'
import type { ProviderRow, ProvidersTabData } from './server-reads'
import {
  EnvVarList,
  ProviderWiringChip,
  SeverityChip,
  SurfaceCallout,
  SurfaceLoaded,
  SurfaceMetaRow,
  SurfaceSection,
  SurfaceStat,
} from './surface-primitives'

function ProviderListItem({
  row,
  usedBy,
}: Readonly<{
  row: ProviderRow
  usedBy: number | null
}>) {
  return (
    <li className="px-4 py-3">
      <SurfaceMetaRow
        label={row.label}
        id={row.id}
        meta={row.toolUse ? 'tool-use câblé' : 'tool-use sans objet'}
        chips={
          <>
            <ProviderWiringChip wiring={row.wiring} />
            {usedBy === null ? (
              <SeverityChip
                tone="neutral"
                title="Le catalogue d’agents n’a pas pu être lu : le nombre d’agents sur ce provider est inconnu, pas nul."
              >
                usage inconnu
              </SeverityChip>
            ) : (
              <SeverityChip tone="neutral">{usedBy} agent(s)</SeverityChip>
            )}
          </>
        }
      />
      <p className="aig-text-muted mt-1 text-sm">{row.note}</p>
      <EnvVarList names={row.envVars} />
    </li>
  )
}

function RuntimeRow({
  label,
  id,
  engine,
  creatable,
  note,
}: Readonly<{
  label: string
  id: string
  engine: string
  creatable: boolean
  note: string
}>) {
  const hasEngine = engine !== 'none'
  return (
    <li className="min-w-0">
      <SurfaceMetaRow
        label={label}
        id={id}
        meta={creatable ? 'sélectionnable' : 'non sélectionnable'}
        chips={
          <SeverityChip
            tone={hasEngine ? 'good' : 'neutral'}
            title={
              hasEngine
                ? 'Moteur réel — ce runtime exécute vraiment.'
                : 'Aucun moteur derrière cet identifiant : il ne peut pas être exécuté, ni sélectionné à la création.'
            }
          >
            {hasEngine ? `moteur ${engine}` : 'aucun moteur'}
          </SeverityChip>
        }
      />
      <p className="aig-text-muted mt-0.5 text-xs">{note}</p>
    </li>
  )
}

function CatalogObserved({ rows }: Readonly<{ rows: AvailableAgent[] }>) {
  const unresolved = rows.filter((a) => a.provider === null).length
  const observed = new Map<string, number>()
  for (const agent of rows) {
    if (agent.provider === null) continue
    observed.set(agent.provider, (observed.get(agent.provider) ?? 0) + 1)
  }

  if (rows.length === 0) {
    return (
      <Unavailable
        reason="no-data"
        detail="Le catalogue est vide : aucun agent ne déclare de provider."
      />
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="aig-text-faint text-xs">
          {[...observed.entries()].map(([provider, count]) => `${provider} · ${count}`).join(' | ') ||
            'aucun provider observé'}
        </p>
        {unresolved > 0 ? (
          <SeverityChip
            tone="warn"
            title="Le provider de ces agents n’a pas pu être résolu depuis la vérité persistée. Il reste null : aucun provider par défaut n’est inventé, parce qu’un provider inventé produirait un coût faux."
          >
            non résolu · {unresolved}
          </SeverityChip>
        ) : null}
      </div>
      {observed.size === 0 ? (
        <p className="aig-text-muted text-sm">
          Aucun agent du catalogue n’a de provider résolu. Ce n’est pas « zéro agent OpenAI » : c’est
          une information absente de la vérité persistée.
        </p>
      ) : null}
    </div>
  )
}

export default function ProvidersTab({ data }: Readonly<{ data: ProvidersTabData }>) {
  const agents = data.agents.ok ? data.agents.data : null
  const runtimes = RUNTIME_IDS.map((id) => RUNTIME_REGISTRY[id])
  const executable = runtimes.filter((rt) => rt.engine !== 'none')

  return (
    <div className="flex flex-col gap-3">
      <SurfaceSection title="Runtimes" hint="registre canonique">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <SurfaceStat label="Runtimes déclarés" value={runtimes.length} />
            <SurfaceStat label="Avec un moteur réel" value={executable.length} hint="les seuls exécutables" />
            <SurfaceStat
              label="Sélectionnables à la création"
              value={runtimes.filter((rt) => rt.creatable).length}
            />
          </div>
          <ul className="flex flex-col gap-2">
            {runtimes.map((runtime) => (
              <RuntimeRow
                key={runtime.id}
                label={runtime.label}
                id={runtime.id}
                engine={runtime.engine}
                creatable={runtime.creatable}
                note={runtime.note}
              />
            ))}
          </ul>
          <SurfaceCallout>
            LangGraph est le seul runtime produit exécutable, et cette contrainte est imposée à quatre
            endroits indépendants : le schéma de création, la garde d’exécution, le contrat canonique et
            ce registre. Les trois autres identifiants existent pour des raisons historiques ou de typage.
          </SurfaceCallout>
        </div>
      </SurfaceSection>

      <SurfaceSection
        title="Providers de modèle"
        hint="câblage réel, pas catalogue commercial"
        className="min-h-64 min-w-0 xl:flex-1"
      >
        <ul className="divide-y divide-(--aig-line-soft)">
          {data.providers.map((row) => (
            <ProviderListItem
              key={row.id}
              row={row}
              usedBy={agents === null ? null : agents.filter((a) => a.provider === row.id).length}
            />
          ))}
        </ul>
      </SurfaceSection>

      <SurfaceSection title="Providers observés sur le catalogue">
        <SurfaceLoaded loaded={data.agents} what="Le catalogue d’agents">
          {(rows) => <CatalogObserved rows={rows} />}
        </SurfaceLoaded>
      </SurfaceSection>
    </div>
  )
}
