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
 * Ligne de projet. Un projet vide ne répète PAS « aucun agent dans ce
 * projet » : la phrase revenait à l'identique ligne après ligne et devenait le
 * texte le plus présent de la page. L'absence se dit une fois, dans la colonne
 * de droite, avec le libellé d'absence du produit.
 */
function ProjectRow({ project }: Readonly<{ project: ProjectOverviewItem }>) {
  const empty = project.copilotCount === 0

  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="overview-row -mx-2 flex min-w-0 items-center gap-3 px-2 py-2.5 no-underline"
      >
        <Avatar
          square
          initials={initialsOf(project.name)}
          className={clsx('size-7 shrink-0', empty && 'opacity-50')}
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

        <div className="w-16 shrink-0 text-right">
          {empty ? (
            <NotMeasured label="—" why="Aucun agent dans ce projet." />
          ) : (
            <>
              <div className="aig-text text-2xs font-medium tabular-nums">
                {project.activeCount}
                <span className="aig-text-muted"> / {project.copilotCount}</span>
              </div>
              <BarMeter
                ratio={project.activeCount / project.copilotCount}
                color={ACCENT}
                className="mt-1.5"
              />
            </>
          )}
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
          <ul className="min-w-0">
            {shown.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="aig-text-muted mt-2 text-2xs uppercase tracking-[0.08em]">
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
