/**
 * Écran « /projects/[id] » — le détail, moitié droite du maître-détail.
 *
 * Server Component. Il reçoit ce que la page a lu et le rend ; il ne lit rien.
 *
 * ZÉRO-SCROLL : `h-full overflow-hidden` de haut en bas, chaque panneau borné
 * par la grille, et seules les LISTES défilent dans leur box. Aucun panneau ne
 * grandit avec sa donnée.
 *
 * LA DISCIPLINE DE CET ÉCRAN
 * --------------------------
 * Chaque bloc n'est rendu que si la donnée qui le porte EXISTE, et l'absence
 * est toujours qualifiée :
 *  · pas de dépôt lié          → « aucun dépôt » (fait structurel).
 *  · dépôt lié mais illisible  → UNAVAILABLE_LABEL + la raison (échec de
 *                                lecture ; surtout pas un dépôt vide).
 *  · lecture réussie, 0 entrée → « dépôt vide » (une vraie mesure).
 * Ces trois-là ne partagent jamais le même rendu.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Divider } from '@/components/ui/divider'
import { Heading, Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { AbsentMark, Panel, Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { UNAVAILABLE_LABEL, formatUsd } from '@/lib/agent-mission-control/format'
import type {
  ProjectTeamEdge,
  ProjectTeamGraph,
  ProjectTeamNode,
} from '@/lib/agent-mission-control/project-team/types'
import type { RepoIntelligence } from '@/lib/agent-mission-control/repo-intelligence'
import type { DeliveryCapability, RepoReadState, RepoTreeNode } from './model'

/* ──────────────────────────── Vocabulaire ──────────────────────────── */

const NODE_STATUS_LABEL: Record<ProjectTeamNode['status'], string> = {
  active: 'En cours',
  waiting: 'En attente',
  blocked: 'Bloqué',
  failed: 'Échoué',
  idle: 'Au repos',
  draft: 'Brouillon',
  // LE mot d'absence du produit, pris à sa source unique : le réécrire ici
  // ferait deux orthographes pour un seul concept (tests/unit/cost-truth).
  unavailable: UNAVAILABLE_LABEL,
}

const NODE_STATUS_BADGE: Record<ProjectTeamNode['status'], 'emerald' | 'amber' | 'purple' | 'red' | 'zinc'> = {
  active: 'emerald',
  waiting: 'amber',
  blocked: 'purple',
  failed: 'red',
  idle: 'zinc',
  draft: 'zinc',
  unavailable: 'zinc',
}

const RELATION_LABEL: Record<ProjectTeamEdge['relation'], string> = {
  'project-membership': 'rattaché au projet',
  'team-membership': "membre de l'équipe",
  orchestrates: 'orchestre',
  'depends-on': 'dépend de',
  'sends-output-to': 'transmet à',
  reviews: 'relit',
  triggers: 'déclenche',
  'shares-tool': 'partage un outil',
}

/**
 * Pourquoi un agent n'a pas de dernier run. Les quatre cas de
 * `ProjectTeamRunHistoryState` disent des choses différentes et l'écran les
 * garde séparés : « jamais tourné » est une mesure, « illisible » n'en est pas
 * une, et « hors fenêtre » n'autorise à conclure ni l'un ni l'autre.
 */
const RUN_HISTORY_NOTE: Record<ProjectTeamNode['runHistory'], string | null> = {
  known: null,
  unreadable: 'runs illisibles',
  'outside-window': 'hors fenêtre lue',
  'not-applicable': null,
}

function agentTeamHint(agentCount: number, unavailableAgents: number): string {
  if (unavailableAgents > 0) {
    return `${unavailableAgents} statut(s) illisible(s)`
  }
  const suffix = agentCount > 1 ? 's' : ''
  return `${agentCount} agent${suffix}`
}

function relationCountHint(count: number): string {
  const suffix = count > 1 ? 's' : ''
  return `${count} arête${suffix}`
}

function severityBadgeColor(severity: string): 'red' | 'amber' | 'zinc' {
  if (severity === 'high') return 'red'
  if (severity === 'medium') return 'amber'
  return 'zinc'
}

function yesNoBadge(ok: boolean): { color: 'emerald' | 'zinc'; label: string } {
  return ok ? { color: 'emerald', label: 'oui' } : { color: 'zinc', label: 'non' }
}

function nodeRailColor(status: ProjectTeamNode['status']): string {
  if (status === 'active') return SEVERITY.good
  if (status === 'failed') return SEVERITY.bad
  // Violet et non SEVERITY.warn : un noeud « bloqué » n'est ni un échec ni une
  // simple attente, distinction que la palette à 4 teintes ne porte pas.
  if (status === 'blocked') return '#8e63ee'
  return SEVERITY.muted
}

function repoPanelBody(repo: RepoView): ReactNode {
  if (repo.state === 'unlinked') {
    return (
      <Unavailable
        reason="no-data"
        detail="Aucun dépôt n'est rattaché à ce projet : il n'y a pas d'arbre à lire."
      />
    )
  }
  if (repo.state === 'unreadable') {
    return (
      <div>
        <Unavailable
          reason="unread"
          detail="Le dépôt est rattaché mais n'a pas pu être lu (jeton absent, API injoignable ou dépôt inaccessible). Ce n'est PAS un dépôt vide — son contenu est inconnu."
        />
        {repo.failure ? (
          <Text className="mt-3 text-center font-mono text-xs">{repo.failure}</Text>
        ) : null}
      </div>
    )
  }
  if (repo.roots.length === 0) {
    return (
      <Unavailable
        reason="no-data"
        detail="La lecture du dépôt a réussi et l'arbre est réellement vide."
      />
    )
  }
  return <TreeBranch nodes={repo.roots} />
}

function intelPanelBody(intel: IntelligenceView): ReactNode {
  if (intel.unreadable) {
    return (
      <Unavailable
        reason="unread"
        detail="Le cache d'intelligence n'a pas pu être lu. On ne sait pas si ce projet a été scanné."
      />
    )
  }
  if (intel.intelligence === null) {
    return (
      <Unavailable
        reason="no-data"
        detail="Ce dépôt n'a jamais été scanné. Aucun scan n'est déclenché depuis cet écran — il est en lecture seule."
      />
    )
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Stack"
          value={
            intel.intelligence.map.stack.length > 0
              ? intel.intelligence.map.stack.join(' · ')
              : null
          }
          absent="non détectée"
        />
        <Stat
          label="Code agentique"
          value={intel.intelligence.footprint.hasAgenticCode ? 'présent' : 'absent'}
        />
      </div>
      <Divider soft />
      <div>
        <Subheading level={3}>Résidus ({intel.intelligence.residue.length})</Subheading>
        {intel.intelligence.residue.length === 0 ? (
          <Text className="mt-1">Aucun résidu relevé par le dernier scan.</Text>
        ) : (
          <ul className="mt-1 space-y-1">
            {intel.intelligence.residue.slice(0, 8).map((finding, i) => (
              <li key={`${finding.path}-${i}`} className="flex items-center gap-2">
                <Badge color={severityBadgeColor(finding.severity)}>{finding.severity}</Badge>
                <Text className="truncate font-mono text-xs">{finding.path}</Text>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────── Sous-blocs ──────────────────────────── */

/** Une valeur d'en-tête : le chiffre, ou l'absence QUALIFIÉE. */
function Stat({
  label,
  value,
  absent = UNAVAILABLE_LABEL,
}: Readonly<{
  label: string
  value: number | string | null
  /** Le mot exact quand `value === null`. `null` reste `null`, jamais `0`. */
  absent?: string
}>) {
  return (
    <div className="min-w-0">
      <Text className="truncate text-xs">{label}</Text>
      {value === null ? (
        <Text className="mt-0.5 text-xs uppercase">{absent}</Text>
      ) : (
        <Strong className="mt-0.5 block truncate tabular-nums">{value}</Strong>
      )}
    </div>
  )
}

function AgentRow({ node }: Readonly<{ node: ProjectTeamNode }>) {
  const note = RUN_HISTORY_NOTE[node.runHistory]
  const rail = nodeRailColor(node.status)

  return (
    <li className="relative">
      <Rail color={rail} />
      <div className="flex items-center gap-3 py-2.5 pr-4 pl-4">
        <Avatar square initials={initialsOf(node.name)} className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{node.name}</Strong>
            <Badge color={NODE_STATUS_BADGE[node.status]}>{NODE_STATUS_LABEL[node.status]}</Badge>
          </div>
          <Text className="truncate">
            {node.runtime ?? 'runtime inconnu'}
            {node.model ? ` · ${node.model}` : ''}
            {node.team ? ` · ${node.team}` : ''}
          </Text>
        </div>

        <div className="shrink-0 text-right">
          <Text>
            {node.metrics.totalRuns === null ? (
              <AbsentMark />
            ) : (
              <>
                <Strong className="tabular-nums">{node.metrics.totalRuns}</Strong> runs
              </>
            )}
          </Text>
          <Text className="tabular-nums">
            {node.latestRun === null ? (
              // Un `null` ici est AMBIGU seul : `runHistory` lève l'ambiguïté.
              <span className="text-xs">{note ?? 'jamais tourné'}</span>
            ) : (
              <>
                {node.latestRun.costUsd === null ? (
                  <AbsentMark />
                ) : (
                  formatUsd(node.latestRun.costUsd)
                )}
                {' · '}
                {node.metrics.successRate === null
                  ? '—'
                  : `${Math.round(node.metrics.successRate * 100)} %`}
              </>
            )}
          </Text>
        </div>
      </div>
    </li>
  )
}

/** L'arbre du dépôt, rendu récursivement et déjà borné en profondeur. */
function TreeBranch({
  nodes,
  depth = 0,
}: Readonly<{ nodes: readonly RepoTreeNode[]; depth?: number }>) {
  return (
    <ul className={depth === 0 ? '' : 'border-l border-zinc-950/5 pl-3 dark:border-white/5'}>
      {nodes.map((node) => (
        <li key={node.path}>
          <div className="flex items-center gap-2 py-0.5">
            <span aria-hidden className="text-xs text-zinc-500 dark:text-zinc-400">
              {node.type === 'tree' ? '▸' : '·'}
            </span>
            <Text className="truncate font-mono text-xs">{node.name}</Text>
          </div>
          {node.children.length > 0 ? (
            <TreeBranch nodes={node.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/* ──────────────────────────── Écran ──────────────────────────── */

export interface RepoView {
  state: RepoReadState
  fullName: string | null
  roots: readonly RepoTreeNode[]
  deeperEntries: number
  /** Renseigné uniquement quand `state === 'unreadable'`. */
  failure: string | null
}

export interface IntelligenceView {
  /** `null` = jamais scanné. C'est un fait, pas un échec. */
  intelligence: RepoIntelligence | null
  scannedAt: string | null
  /** `true` quand la lecture du cache a ÉCHOUÉ — distinct de « jamais scanné ». */
  unreadable: boolean
}

export default function ProjectDetailScreen({
  name,
  graph,
  repo,
  intel,
  delivery,
}: Readonly<{
  name: string
  /** `null` = la lecture du graphe a échoué. Jamais « projet sans équipe ». */
  graph: ProjectTeamGraph | null
  repo: RepoView
  intel: IntelligenceView
  delivery: DeliveryCapability
}>) {
  const agents = graph?.nodes.filter((node) => node.kind === 'agent') ?? []
  // Les arêtes de simple appartenance sont structurelles et déjà dites par la
  // liste d'agents : les répéter en « relations » gonflerait le compte sans
  // rien apprendre.
  const relations =
    graph?.edges.filter(
      (edge) => edge.relation !== 'project-membership' && edge.relation !== 'team-membership',
    ) ?? []
  const nodeName = new Map(graph?.nodes.map((node) => [node.id, node.name]) ?? [])
  const summary = graph?.summary ?? null

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 max-lg:pl-14">
      {/* ── En-tête ── */}
      <header className="shrink-0 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar square initials={initialsOf(name)} className="size-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <Heading level={1} className="truncate">
              {name}
            </Heading>
            <Text className="truncate">
              {repo.fullName ?? 'aucun dépôt lié'}
              {repo.state === 'unreadable' ? ' · dépôt illisible' : ''}
            </Text>
          </div>
          <Link
            href="/projects"
            className="shrink-0 text-sm/6 text-zinc-500 underline underline-offset-4 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
          >
            Retour au catalogue
          </Link>
        </div>

        {summary ? (
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Stat label="Agents" value={summary.totalAgents} />
            <Stat label="En cours" value={summary.activeAgents} />
            <Stat label="Bloqués" value={summary.blockedAgents} />
            <Stat label="Échoués" value={summary.failedAgents} />
            <Stat label="Runs aujourd'hui" value={summary.runsToday} />
          </div>
        ) : null}
      </header>

      <Divider soft className="shrink-0" />

      {graph === null ? (
        <div className="min-h-0 flex-1">
          <Unavailable
            reason="unread"
            detail="Le graphe d'équipe de ce projet n'a pas pu être lu. Ni les agents, ni les relations, ni les missions ne sont affichés — ce projet n'est pas vide, il est inconnu de cet écran."
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[1.3fr_1fr]">
          {/* ── Colonne gauche : l'équipe et ses relations ── */}
          <div className="grid min-h-0 grid-rows-[1.4fr_1fr] gap-3">
            <Panel
              title="Équipe"
              hint={
                summary
                  ? agentTeamHint(agents.length, summary.unavailableAgents)
                  : agentTeamHint(agents.length, 0)
              }
              className="min-h-0"
              padded={false}
              bodyClassName="overflow-y-auto"
            >
              {agents.length === 0 ? (
                <div className="p-4">
                  <Unavailable
                    reason="no-data"
                    detail="La lecture a réussi : aucun agent n'est rattaché à ce projet. Il n'a donc ni run ni coût à mesurer."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
                  {agents.map((node) => (
                    <AgentRow key={node.id} node={node} />
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Relations"
              hint={relationCountHint(relations.length)}
              className="min-h-0"
              padded={false}
              bodyClassName="overflow-y-auto"
            >
              {relations.length === 0 ? (
                <div className="p-4">
                  <Unavailable
                    reason="no-data"
                    detail="Aucune relation explicite ni dérivée entre les agents de ce projet."
                  />
                </div>
              ) : (
                <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
                  {relations.map((edge) => (
                    <li key={edge.id} className="flex items-center gap-2 px-4 py-2">
                      <div className="min-w-0 flex-1">
                        <Text className="truncate">
                          <Strong>{nodeName.get(edge.source) ?? 'source inconnue'}</Strong>{' '}
                          {RELATION_LABEL[edge.relation]}{' '}
                          <Strong>{nodeName.get(edge.target) ?? 'cible inconnue'}</Strong>
                        </Text>
                      </div>
                      {/* `explicit` = une ligne persistée l'affirme.
                          `derived` = calculé depuis une évidence explicable. */}
                      <Badge color={edge.origin === 'explicit' ? 'blue' : 'zinc'}>
                        {edge.origin === 'explicit' ? 'configurée' : 'dérivée'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* ── Colonne droite : le dépôt et la livraison ── */}
          <div className="grid min-h-0 grid-rows-[1fr_1fr_auto] gap-3">
            <Panel
              title="Dépôt"
              hint={repo.deeperEntries > 0 ? `+${repo.deeperEntries} plus profond` : undefined}
              className="min-h-0"
              padded={false}
              bodyClassName="overflow-auto px-4 py-2"
            >
              {repoPanelBody(repo)}
            </Panel>

            <Panel
              title="Intelligence de dépôt"
              hint={intel.scannedAt ? `scan ${intel.scannedAt.slice(0, 10)}` : undefined}
              className="min-h-0"
              bodyClassName="overflow-y-auto"
            >
              {intelPanelBody(intel)}
            </Panel>

            {/* Capacité de LIVRAISON — un constat, pas un déclencheur. Cette
                surface est en lecture seule : elle n'appelle aucune écriture
                GitHub, pas même un dry-run. */}
            <Panel title="Capacité de livraison" className="shrink-0">
              <div className="space-y-1.5">
                {[
                  { label: 'Backend configuré', ok: delivery.backendConfigured },
                  { label: 'GitHub configuré', ok: delivery.githubConfigured },
                  { label: 'Poussée armée (GITHUB_PUSH_ENABLED)', ok: delivery.pushArmed },
                ].map((lock) => {
                  const badge = yesNoBadge(lock.ok)
                  return (
                  <div key={lock.label} className="flex items-center gap-2">
                    <Badge color={badge.color}>{badge.label}</Badge>
                    <Text className="truncate">{lock.label}</Text>
                  </div>
                  )
                })}
                <Divider soft className="my-2!" />
                <Text className="text-xs">
                  {delivery.realDeliveryEnabled
                    ? "Une livraison réelle est possible : elle exigerait en plus `confirm: true` dans la requête. Aucune écriture n'est déclenchée depuis cet écran."
                    : "Une livraison réelle est impossible en l'état — toute poussée serait un dry-run."}
                </Text>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </div>
  )
}
