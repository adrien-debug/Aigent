import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Avatar } from '@/components/ui/avatar'
import { Link } from '@/components/ui/link'
import { NotMeasured, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { SeverityChip } from '@/components/surface-primitives'
import type { ActionItem, DashboardOverview, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import ActivityGraph, { GhostActivityGraph } from './activity-graph'
import { actionItemChip, sortOverviewProjects } from './model'
import RunStream from './run-stream'
import { OverviewSection } from './section'
import { BarMeter } from './meters'

/**
 * L'APERÇU N'EST PAS LE CATALOGUE. Il montre une tête de liste et renvoie à la
 * surface qui porte l'inventaire complet. Dix projets rendaient ici 620 px de
 * liste — la zone basse était dominée par des projets vides pendant que les
 * signaux, eux, tenaient en deux lignes. Le compte total reste affiché dans
 * l'indice de section : rien n'est caché, tout est à un clic.
 */
const OVERVIEW_PROJECT_LIMIT = 5
const OVERVIEW_EVENT_LIMIT = 5

/** La valeur transite par un `style` inline dans `BarMeter`. */
const ACCENT = 'var(--aig-accent)'

export function hasWindowActivity(buckets: HourlyBucket[] | null): boolean {
  return buckets !== null && buckets.some((bucket) => bucket.total > 0)
}

/**
 * Action de section — un lien, pas un bouton. Une section ne porte qu'UNE
 * action, et elle est secondaire par nature : la remplir d'un bouton la mettait
 * au même rang visuel que le CTA de la page.
 */
function SectionAction({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Link
      href={href}
      className="aig-link-accent whitespace-nowrap text-2xs uppercase tracking-[0.1em] no-underline"
    >
      {children}
    </Link>
  )
}

function EmptyOverviewLine({ detail }: Readonly<{ detail: string }>) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 py-1">
      <NotMeasured label="—" why={detail} />
      <span className="aig-text-muted min-w-0 text-xs">{detail}</span>
    </div>
  )
}

export function ActivityPanel({ buckets }: Readonly<{ buckets: HourlyBucket[] | null }>) {
  if (buckets === null) {
    return (
      <Unavailable reason="unread" detail="La courbe d'activité n'a pas pu être lue sur la fenêtre." />
    )
  }
  if (!hasWindowActivity(buckets)) return <GhostActivityGraph />
  return <ActivityGraph buckets={buckets} />
}

export function FluxAbsentLine() {
  return <GhostActivityGraph />
}

/**
 * CARTE DE PROJET — AIGENT-UX-IA-001 remplace la ligne de liste par une carte.
 *
 * POURQUOI UNE CARTE ICI, alors que #94 a chassé les cartes du bandeau de
 * mesures. Ce n'est pas contradictoire : #94 interdit la carte comme EMBALLAGE
 * d'un chiffre nu — six boîtes pour six nombres. Une carte de projet porte, elle,
 * un OBJET composite qu'on peut ouvrir : identité, activité, progression,
 * alerte. C'est le critère que l'issue pose elle-même — « cartes uniquement
 * lorsqu'elles portent une vraie fonction ».
 *
 * CHAQUE CHAMP EST MESURÉ, AUCUN N'EST INVENTÉ. `runsLast24h` distingue trois
 * états (`0` mesuré, `n` mesuré, `null` non mesurable) et la carte les rend
 * différemment : un projet dont aucun agent n'a prouvé son compte affiche
 * l'absence, jamais « 0 run ». Même règle pour `passRate`.
 */
function ProjectCard({ project }: Readonly<{ project: ProjectOverviewItem }>) {
  const empty = project.copilotCount === 0
  const ratio = empty ? 0 : project.activeCount / project.copilotCount
  // Une alerte n'est levée que sur une mesure PROUVÉE : un `passRate` non lu
  // n'est pas un mauvais taux, et signaler l'inconnu comme un incident userait
  // le signal jusqu'à ce que l'opérateur l'ignore.
  const alert = project.passRate !== null && project.passRate < 0.5

  return (
    <li className="min-w-0">
      <Link
        href={`/projects/${project.id}`}
        className="overview-row aig-surface-elevated flex min-w-0 flex-col gap-3 rounded-lg p-3.5 no-underline"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {/*
            MONOGRAMME, PAS `logoUrl`. L'issue demande « logo réel OU monogramme
            propre » — j'ai d'abord câblé `logoUrl`/`imageUrl`, et les trois
            projets qui en portent un ont produit trois 404 :
            `/projects/tradeagent/logo.svg`, `/projects/aigent-builder/cover.png`,
            `/projects/bull21/cover.png`. Le dossier `public/projects/` n'existe
            pas — ces chemins sont déclarés en base sans fichier en face, et
            AUCUN autre écran ne les consommait, ce qui explique que le trou
            n'ait jamais été visible.
            Un logo cassé dégrade plus qu'un monogramme ne manque : on rend donc
            le monogramme jusqu'à ce que les assets existent réellement. Les
            champs restent dans le contrat, prêts à être rebranchés.
          */}
          <Avatar
            square
            initials={initialsOf(project.name)}
            className={clsx('size-8 shrink-0', empty && 'opacity-50')}
          />
          <div className="min-w-0 flex-1">
            <span
              className={clsx(
                'block truncate text-sm',
                empty ? 'aig-text-muted' : 'aig-text font-medium',
              )}
            >
              {project.name}
            </span>
            <span className="aig-text-muted block truncate text-2xs uppercase tracking-[0.08em]">
              {project.repoFullName ?? 'aucun dépôt lié'}
            </span>
          </div>
          {alert ? (
            <SeverityChip tone="warn" className="shrink-0 text-3xs uppercase tracking-[0.1em]">
              À revoir
            </SeverityChip>
          ) : null}
        </div>

        <div className="flex min-w-0 items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="aig-text-muted text-2xs uppercase tracking-[0.08em]">Runs 24 h</p>
            <div className="mt-0.5 min-h-5">
              {project.runsLast24h === null ? (
                <NotMeasured
                  label="—"
                  why="Aucun agent de ce projet n'a prouvé son compte de runs."
                />
              ) : (
                <span className="aig-text text-base font-semibold tabular-nums">
                  {project.runsLast24h}
                </span>
              )}
            </div>
          </div>

          <div className="w-20 shrink-0 text-right">
            {empty ? (
              <NotMeasured label="—" why="Aucun agent dans ce projet." />
            ) : (
              <>
                <div className="aig-text text-2xs font-medium tabular-nums">
                  {project.activeCount}
                  <span className="aig-text-muted"> / {project.copilotCount}</span>
                </div>
                <BarMeter ratio={ratio} color={ACCENT} className="mt-1.5" />
              </>
            )}
          </div>
        </div>
      </Link>
    </li>
  )
}

function EventRow({ item }: Readonly<{ item: ActionItem }>) {
  const chip = actionItemChip(item)

  return (
    <li className="overview-row -mx-2 flex min-w-0 items-center gap-3 px-2 py-2.5">
      {/*
        `SeverityChip` et non `Badge` : le ton de sévérité est calculé par
        `actionItemChip` puis était JETÉ au profit d'un badge gris uniforme —
        « PR ouverte » et « Mission bloquée » se rendaient à l'identique. Le
        badge Catalyst appartient au chrome ; la sévérité produit parle
        `--aig-severity-*`.
      */}
      <SeverityChip tone={chip.tone} className="shrink-0 text-3xs uppercase tracking-[0.1em]">
        {chip.label}
      </SeverityChip>

      <div className="min-w-0 flex-1">
        <p className="aig-text truncate text-sm font-medium">{item.title}</p>
        <p className="aig-text-muted truncate text-2xs uppercase tracking-[0.08em]">{item.meta}</p>
      </div>

      <SectionAction href={item.href}>{item.buttonLabel} →</SectionAction>
    </li>
  )
}

export function ProjectsBlock({
  overview,
  className,
}: Readonly<{ overview: DashboardOverview; className?: string }>) {
  // Triés peuplés d'abord (`sortOverviewProjects`), donc la tête de liste porte
  // les projets qui ont réellement des agents.
  const shown = sortOverviewProjects(overview.projects).slice(0, OVERVIEW_PROJECT_LIMIT)
  const hidden = overview.projects.length - shown.length

  return (
    <OverviewSection
      className={className}
      title="Projets"
      hint={`${overview.projects.length} au catalogue`}
      actions={<SectionAction href="/projects">Tous les projets →</SectionAction>}
    >
      {overview.projects.length === 0 ? (
        <EmptyOverviewLine detail="Aucun projet dans le catalogue." />
      ) : (
        <>
          {/* Grille de cartes, plus une liste (AIGENT-UX-IA-001). Deux colonnes
              dès `sm` : à une seule, cinq cartes rendraient la colonne plus
              haute que la zone de signaux d'en face et rouvriraient le besoin
              d'un scroller — précisément ce que l'issue interdit. */}
          <ul className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2">
            {shown.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="aig-text-muted mt-3 text-2xs uppercase tracking-[0.08em]">
              {`+ ${hidden} autre(s) sur /projects`}
            </p>
          ) : null}
        </>
      )}
    </OverviewSection>
  )
}

export function EventsBlock({
  overview,
  className,
}: Readonly<{ overview: DashboardOverview; className?: string }>) {
  // PAS de « + N autre(s) » ici, contrairement aux projets : `actionItems` est
  // DÉJÀ tronqué à 6 en amont (`buildActionItems` → `.slice(0, limit ?? 6)`) et
  // `/` ne passe aucune limite. Un reste calculé sur ce tableau vaudrait au plus
  // 1 alors que la file réelle peut en porter trente — un chiffre qui
  // sous-déclare est pire que pas de chiffre. La file complète est à un clic.
  const shown = overview.actionItems.slice(0, OVERVIEW_EVENT_LIMIT)

  return (
    <OverviewSection
      className={className}
      title="Événements importants"
      hint={`${overview.actionItems.length} signal(aux)`}
      actions={<SectionAction href="/actions">File complète →</SectionAction>}
    >
      {overview.actionItems.length === 0 ? (
        <EmptyOverviewLine detail="Aucun signal bloquant sur la fenêtre actuelle — lecture réussie." />
      ) : (
        <ul className="min-w-0">
          {shown.map((item) => (
            <EventRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </OverviewSection>
  )
}

export function FluxBlock({
  runs,
  className,
}: Readonly<{ runs: NamedRun[]; className?: string }>) {
  return (
    <OverviewSection
      className={className}
      title="Flux d'exécution"
      hint={`${runs.length} sur la fenêtre`}
      actions={<SectionAction href="/runs">Tous les runs →</SectionAction>}
    >
      <RunStream runs={runs} />
    </OverviewSection>
  )
}
