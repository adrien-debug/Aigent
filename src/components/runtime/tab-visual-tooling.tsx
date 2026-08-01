/**
 * Onglet « Outillage visuel » — l'état réel des sept outils.
 *
 * CE QUE CET ÉCRAN REFUSE DE DIRE. Le vocabulaire complet est disponible
 * (`INSTALLED` → `VERIFIED`), mais rien n'est promu au-delà de ce qui est
 * mesuré : une sonde HTTP mène au mieux à `CONNECTED`. Le seul `VERIFIED` de la
 * console est le Canvas, dont la preuve est produite dans la même application et
 * gardée par un harnais qui échoue si le graphe manque.
 *
 * DENSE, PAS DÉCORATIF. Une ligne par outil, sur une grille alignée : statut,
 * nom, fonction, endpoint, dernier contrôle, action. Les sept tiennent dans le
 * premier viewport à 1440×900. Ce qui est long — détail de l'erreur, marche à
 * suivre — vit dans un `<details>` et n'occupe la place que si on le demande.
 */
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Panel } from '@/components/cockpit/primitives'
import type { ToolProbe, ToolStatus, VisualToolingData } from './visual-tooling'

/**
 * Une couleur par état — mais l'état est TOUJOURS écrit en toutes lettres à
 * côté : la couleur seule n'est pas une information accessible.
 */
const STATUS_COLOR: Record<ToolStatus, 'lime' | 'emerald' | 'amber' | 'sky' | 'zinc' | 'red'> = {
  VERIFIED: 'emerald',
  CONNECTED: 'lime',
  RUNNING: 'lime',
  CONFIGURED: 'amber',
  INSTALLED: 'sky',
  NOT_CONFIGURED: 'zinc',
  UNAVAILABLE: 'zinc',
  ERROR: 'red',
}

/** Ce que chaque état signifie, dit à l'écran plutôt que supposé connu. */
const STATUS_MEANING: Record<ToolStatus, string> = {
  VERIFIED: 'fait démontrablement son travail',
  CONNECTED: 'a répondu et accepté l’appel',
  RUNNING: 'a répondu',
  CONFIGURED: 'adresse connue, sans réponse',
  INSTALLED: 'présent, non contacté',
  // Deux absences DIFFÉRENTES, que la couleur seule confondrait : rien à
  // sonder (personne ne l'a installé) vs sondé et muet (il est cassé).
  NOT_CONFIGURED: 'aucune adresse — jamais sondé',
  UNAVAILABLE: 'non mesurable depuis le serveur',
  ERROR: 'adresse connue, sonde en échec',
}

/** Un lien externe s'ouvre dans un onglet neuf ; un lien interne, non. */
function isExternal(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

function ToolRow({ tool }: Readonly<{ tool: ToolProbe }>) {
  return (
    <li
      className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-zinc-200 py-1.5 last:border-0 dark:border-zinc-800"
      data-testid="visual-tool-row"
      data-tool={tool.id}
      data-status={tool.status}
    >
      <Badge color={STATUS_COLOR[tool.status]} className="justify-self-start">
        {tool.status}
      </Badge>

      {/*
        DEUX LIGNES PAR OUTIL, PAS QUATRE. La première porte l'identité (nom,
        version, sens du statut) ; la seconde, la fonction puis les faits de
        sonde sur la MÊME ligne. Le détail complet reste accessible en
        disclosure. Cette compression est ce qui fait tenir les sept outils dans
        le premier viewport à 1440×900 — l'E2E le vérifie et échoue sinon.
      */}
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{tool.name}</span>
          {tool.version ? <Badge color="zinc">v{tool.version}</Badge> : null}
          <Text className="text-[11px] text-zinc-500">{STATUS_MEANING[tool.status]}</Text>
          {tool.url ? <code className="truncate font-mono text-[11px] text-zinc-500">{tool.url}</code> : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Text className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
            {tool.purpose}
          </Text>
          <span className="shrink-0 text-[11px] text-zinc-500">
            {tool.latencyMs !== null ? `${tool.latencyMs} ms · ` : ''}
            {/*
              Jamais de « 0 ms » ni de date fabriquée quand rien n'a été sondé :
              l'absence de contrôle est dite, pas coercée en zéro.
            */}
            {tool.checkedAt === null ? 'jamais sondé' : `contrôlé ${tool.checkedAt.slice(11, 19)} UTC`}
          </span>
          <details className="group shrink-0">
            <summary className="cursor-pointer list-none text-[11px] text-zinc-500 select-none hover:text-zinc-900 dark:hover:text-zinc-100">
              <span className="inline-block transition-transform group-open:rotate-90">▸</span> Détail
            </summary>
            <div className="mt-1 flex flex-col gap-1 border-l border-zinc-200 pl-2 dark:border-zinc-800">
              <Text className="text-[11px] text-zinc-500">{tool.detail}</Text>
              {tool.remediation ? (
                <Text className="text-[11px] text-amber-600 dark:text-amber-500">
                  Pour l’activer : {tool.remediation}
                </Text>
              ) : null}
            </div>
          </details>
        </div>
      </div>

      <div className="flex items-center gap-1.5 justify-self-end">
        {tool.url ? (
          <Button
            href={tool.url}
            plain
            className="!text-xs"
            {...(isExternal(tool.url)
              ? // `noreferrer` : l'URL d'Aigent ne part pas dans le Referer d'un tiers.
                { target: '_blank', rel: 'noreferrer noopener' }
              : {})}
          >
            Ouvrir
          </Button>
        ) : null}
        {tool.remediation ? (
          /*
            Pas de faux bouton d'action : configurer un service se fait hors de
            cette page (variable d'environnement, docker compose). Le bouton
            PORTE la marche à suivre dans son `title` et pointe vers le détail
            déplié — il ne prétend pas exécuter quoi que ce soit.
          */
          <Button plain disabled className="!text-xs" title={tool.remediation}>
            Configurer
          </Button>
        ) : null}
      </div>
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
        <Text className="mb-1 text-[11px] text-zinc-500">
          Une sonde prouve qu’un service répond — pas qu’il fait son travail. Le
          seul « VERIFIED » est le Canvas, prouvé par un harnais qui échoue si le
          graphe manque.
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
