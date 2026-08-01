/**
 * Aperçu — la surface d'arrivée : instruments, activité, rosters.
 *
 * Hiérarchie : en-tête commun → bandeau KPI → activité (histogramme) → rosters
 * (flux d'exécution, projets). Du global au particulier, comme `/runs`.
 *
 * L'écran rendait autrefois sur fond CLAIR avec son propre en-tête noir ; il
 * suit désormais la grammaire du produit (`globals.css`) et l'en-tête commun du
 * shell. Il n'a plus de langage à lui.
 *
 * Server Component : l'histogramme est le seul module client (Recharts).
 */
import type { ReactNode } from 'react'
import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Link } from '@/components/ui/link'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import { buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { NamedRun, ProjectCard } from '@/lib/cockpit/named-runs'
import ActivityGraph from './activity-graph'
import { StatusLegend } from './charts'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import ProjectCarousel from './project-carousel'
import { Panel, Unavailable } from './primitives'

const ENTRY = navEntry('/')

/**
 * Le corps du panneau d'activité — trois états, jamais confondus.
 *
 * LE TROISIÈME ÉTAT EST LA CORRECTION D'UN MENSONGE
 * ------------------------------------------------
 * Une fenêtre lue et VIDE produisait un tracé : 24 points alignés au fond du
 * plot, reliés par une ligne verte continue. Constaté sur l'écran réel, DOM à
 * l'appui — `aria-label="… — 0 runs"`, les 24 points à `top: 87.2727%`, le path
 * entier à `y=192` — pendant que le KPI disait « Runs 24 h : 0 » et que le flux
 * juste en dessous disait « Aucun run sur les dernières 24 heures ».
 *
 * Le plancher d'échelle (`Math.max(2, …)`) pose le zéro sur la ligne de grille
 * du bas : RIEN ne distingue visuellement « 0 partout » de « 1 run/h partout ».
 * Une courbe continue se lit comme une activité régulière — l'exact contraire
 * de ce que la fenêtre mesure. Sur un écran dont toute la doctrine est « une
 * absence n'est pas un zéro » (AGENTS.md § Vérité des données), c'était le
 * mensonge le plus visible du cockpit.
 *
 * On rend donc l'ABSENCE, comme le fait le flux d'exécution sur la même donnée.
 * `no-data` et non `unread` : la lecture a réussi, la flotte est réellement au
 * repos, et c'est une mesure — pas une panne.
 */
function renderActivityPanel(buckets: HourlyBucket[] | null): ReactNode {
  if (buckets === null) {
    return (
      <Unavailable
        reason="unread"
        detail="La fenêtre de runs n'a pas pu être lue — aucune courbe n'est tracée."
      />
    )
  }
  if (buckets.every((bucket) => bucket.total === 0)) {
    return (
      <Unavailable
        reason="no-data"
        detail="Aucun run sur les dernières 24 heures. La fenêtre a bien été lue — une courbe à plat se lirait comme une activité régulière."
      />
    )
  }
  return <ActivityGraph buckets={buckets} />
}

function renderRunStreamPanel(runs: NamedRun[] | null, nowMs: number): ReactNode {
  if (runs === null) {
    return <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (runs.length === 0) {
    return <Unavailable reason="no-data" detail="Aucun run sur les dernières 24 heures." />
  }
  return <RunStream runs={runs} nowMs={nowMs} />
}

export default function CockpitOverview({
  overview,
  nowMs,
}: Readonly<{
  overview: DashboardOverview
  nowMs: number
}>) {
  const buckets = buildHourlyBuckets(overview.windowRuns, nowMs)
  const slices = buildStatusBreakdown(overview.windowRuns)
  const runs = buildNamedRuns(overview.windowRuns, overview.copilots, overview.projectRows)
  const unread = overview.windowRuns === null

  const projectCards: ProjectCard[] = overview.projects.map((p) => ({
    id: p.id,
    name: p.name,
    repoFullName: p.repoFullName,
    copilotCount: p.copilotCount,
    activeCount: p.activeCount,
    runs24h: p.runsLast24h,
    costLast24hUsd: p.costLast24hUsd,
    passRate: p.passRate,
  }))
  const rankedProjects = projectCards

  return (
    <>
      {/*
       * L'en-tête est celui du SHELL, plus une bannière propre à cet écran.
       *
       * Ce qui vivait ici — une boîte noire de 16 unités de haut, une marque en
       * médaillon, un bouton indigo — était le seul en-tête de ce genre du
       * produit : les dix autres surfaces posaient un `Heading` nu. L'indigo,
       * lui, était le seul accent non-cuivre de tout Aigent. Deux singularités
       * pour une page d'accueil, c'est ainsi qu'un produit cesse de se
       * ressembler à lui-même.
       *
       * Les deux actions restent : ce sont de vrais liens vers de vraies routes.
       * Elles montent simplement dans l'en-tête commun.
       */}
      <PageHeader
        title={ENTRY.name}
        description={ENTRY.purpose}
        actions={
          <>
            <Link
              href="/runs"
              className="aig-panel aig-text-muted inline-flex items-center justify-center px-3 py-2 text-sm font-semibold no-underline transition hover:text-white"
            >
              Voir les runs
            </Link>
            <Link
              href="/actions"
              className="aig-panel-raised aig-accent inline-flex items-center justify-center px-3 py-2 text-sm font-semibold no-underline transition hover:text-white"
            >
              File d’action
            </Link>
          </>
        }
      />

      <PageBody>
        <KpiStrip kpis={overview.kpis} unread={unread} />

        <Panel
          title="Activité 24 h"
          className="min-w-0"
          padded={false}
          bodyClassName="px-2 pt-3 pb-1"
          actions={slices ? <StatusLegend slices={slices} /> : undefined}
          hint={slices ? undefined : 'fenêtre non lue'}
        >
          {renderActivityPanel(buckets)}
        </Panel>

        {/* 60 / 40 : le flux se lit ligne à ligne et garde la majorité, mais les
          projets portent DES CARTES — à 30 % la colonne n'en montrait que deux
          sur dix et coupait la troisième au bord. 40 % en fait une vraie
          seconde colonne au lieu d'un appoint tassé. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[6fr_4fr] [&>*]:min-w-0">
          <Panel
            title="Flux d'exécution"
            hint={runs ? `${runs.length} sur la fenêtre` : undefined}
            className="min-w-0"
            padded={false}
          >
            {renderRunStreamPanel(runs, nowMs)}
          </Panel>

          <Panel
            title="Projets"
            hint={`${projectCards.length} au catalogue`}
            className="min-w-0"
            padded={false}
          >
            {projectCards.length === 0 ? (
              <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
            ) : (
              <ProjectCarousel cards={rankedProjects} />
            )}
          </Panel>
        </div>

        {overview.dataWarnings.length > 0 ? (
          <p className="aig-panel-raised aig-accent truncate px-3 py-2 font-mono text-2xs">
            {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
          </p>
        ) : null}
      </PageBody>
    </>
  )
}
