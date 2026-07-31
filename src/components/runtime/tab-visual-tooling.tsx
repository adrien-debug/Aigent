/**
 * Onglet « Outillage visuel » — l'état réel des outils périphériques.
 *
 * CE QUE CET ÉCRAN DIT, ET CE QU'IL REFUSE DE DIRE
 * -----------------------------------------------
 * Il affiche trois états seulement — `RUNNING`, `CONFIGURED`, `UNAVAILABLE` —
 * et jamais « VERIFIED ». Une sonde HTTP prouve qu'un service répond, pas qu'il
 * fait son travail : Langfuse qui répond n'a pas pour autant reçu une trace,
 * Grafana qui répond n'a pas pour autant une datasource. Afficher un vert
 * « vérifié » depuis un 200 serait exactement le faux vert que la gouvernance
 * interdit.
 *
 * TABLEAU DENSE, PAS UNE GRILLE DE CARTES. Sept outils tiennent dans une lecture
 * verticale ; une grille de grosses cards décoratives coûterait trois fois la
 * hauteur pour la même information.
 */
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import type { ToolProbe, ToolStatus, VisualToolingData } from './visual-tooling'

/** Une couleur par état — mais l'état est TOUJOURS écrit en toutes lettres. */
const STATUS_COLOR: Record<ToolStatus, 'lime' | 'amber' | 'zinc'> = {
  RUNNING: 'lime',
  CONFIGURED: 'amber',
  UNAVAILABLE: 'zinc',
}

/** Ce que chaque état signifie, dit à l'écran plutôt que supposé connu. */
const STATUS_MEANING: Record<ToolStatus, string> = {
  RUNNING: 'a répondu',
  CONFIGURED: 'adresse connue, sans réponse',
  UNAVAILABLE: 'non configuré',
}

function ToolRow({ tool }: Readonly<{ tool: ToolProbe }>) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-zinc-200 py-2.5 last:border-0 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{tool.name}</span>
        <Badge color={STATUS_COLOR[tool.status]}>{tool.status}</Badge>
        <Text className="text-2xs text-zinc-500">{STATUS_MEANING[tool.status]}</Text>
        {tool.version ? <Badge color="zinc">v{tool.version}</Badge> : null}
      </div>

      <Text className="text-xs text-zinc-600 dark:text-zinc-400">{tool.purpose}</Text>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-zinc-500">
        {tool.url ? (
          // `noreferrer` : l'URL d'Aigent ne part pas dans le Referer d'un outil tiers.
          <Link href={tool.url} target="_blank" rel="noreferrer noopener" className="font-medium">
            Ouvrir ↗
          </Link>
        ) : null}
        {tool.url ? <code className="truncate font-mono">{tool.url}</code> : null}
        {tool.latencyMs !== null ? <span>{tool.latencyMs} ms</span> : null}
        {/*
          Jamais de « 0 ms » ni de date fabriquée quand rien n'a été sondé :
          l'absence de sonde est dite, pas coercée en zéro.
        */}
        {tool.checkedAt === null ? <span>jamais sondé</span> : null}
      </div>

      <Text className="text-2xs text-zinc-500">{tool.detail}</Text>

      {tool.remediation ? (
        <Text className="text-2xs text-amber-600 dark:text-amber-500">
          Pour l’activer : {tool.remediation}
        </Text>
      ) : null}
    </li>
  )
}

export default function VisualToolingTab({ data }: Readonly<{ data: VisualToolingData }>) {
  return (
    <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto" data-testid="visual-tooling">
      <Panel
        title="Outillage visuel"
        hint={`${data.runningCount} sur ${data.tools.length} joignable(s) au dernier passage`}
      >
        <Text className="mb-2 text-2xs text-zinc-500">
          Une sonde prouve qu’un service répond — pas qu’il fait son travail.
          Aucun état « vérifié » n’est affiché ici : Langfuse qui répond n’a pas
          pour autant reçu une trace.
        </Text>
        <ul className="flex flex-col">
          {data.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </ul>
      </Panel>
    </div>
  )
}
