/**
 * Aperçu — la surface d'arrivée. UNE scène, puis deux zones de second rang.
 *
 * LA HIÉRARCHIE EST MAINTENANT ÉDITORIALE, PAS SEULEMENT ORDONNÉE
 * ---------------------------------------------------------------
 * L'écran allait déjà « du global au particulier », mais en empilant trois
 * `Panel` de rang strictement ÉGAL — bandeau KPI, activité, grille rosters.
 * Même fond, même liseré, même rayon, même poids de titre. Un ordre de lecture
 * juste ne suffit pas : sans différence de POIDS, les trois blocs se disputent
 * le regard et l'écran se lit comme une grille de cadres noirs.
 *
 * Trois gestes, donc :
 *  1. L'activité et ses mesures fusionnent en UNE scène (`aig-stage`) : la
 *     courbe et les chiffres qui la qualifient parlent de la même fenêtre, ils
 *     n'ont jamais eu de raison d'être deux boîtes voisines.
 *  2. Les six KPI cessent d'être six cellules égales — deux MÈNENT en
 *     `text-4xl`, quatre QUALIFIENT (voir `kpi-strip.tsx`).
 *  3. Le flux et les projets descendent en second rang (`aig-quiet`) : plus de
 *     liseré fermé, la valeur du fond suffit à les détacher.
 *
 * Server Component : l'histogramme est le seul module client (SVG écrit à la
 * main + Motion pour son entrée).
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
import { Unavailable } from './primitives'

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

/**
 * Une section de SECOND RANG — présente, subordonnée, sans cadre complet.
 *
 * Ce n'est pas un `Panel` allégé : c'est l'autre moitié d'une hiérarchie à deux
 * niveaux. `Panel` porte un liseré fermé sur ses quatre côtés, et trois `Panel`
 * côte à côte se lisent comme trois objets de même importance. Ici la section
 * se détache par la VALEUR de son fond et un filet de lumière sous son titre —
 * elle appartient visiblement à la page plutôt que de flotter dessus.
 *
 * Le lien de l'en-tête est le « détail à la demande » : chaque zone dit où
 * aller pour en voir plus, au lieu d'essayer de tout montrer.
 */
function QuietSection({
  title,
  hint,
  href,
  hrefLabel,
  children,
}: Readonly<{
  title: string
  hint?: string
  href?: string
  hrefLabel?: string
  children: ReactNode
}>) {
  return (
    <section className="aig-quiet flex min-w-0 flex-col overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3.5 pb-2.5">
        <h2 className="aig-display truncate text-sm font-semibold">{title}</h2>
        {hint ? <p className="aig-text-faint truncate text-2xs">{hint}</p> : null}
        {href && hrefLabel ? (
          <Link
            href={href}
            className="aig-accent ml-auto shrink-0 text-2xs font-medium no-underline transition hover:text-white"
          >
            {hrefLabel} →
          </Link>
        ) : null}
      </header>
      {/* Le filet remplace la bordure du header : il articule sans découper. */}
      <div className="aig-hairline mx-4" />
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  )
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
        eyebrow="Plan de contrôle"
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

      <PageBody className="flex-1">
        {/*
         * LA SCÈNE — une seule zone dominante, et tout le reste en dessous.
         *
         * CE QUI A CHANGÉ. L'écran empilait trois `Panel` de rang strictement
         * égal : le bandeau KPI, l'activité, puis la grille flux/projets. Même
         * fond, même liseré, même rayon, même poids typographique — une pile de
         * cadres noirs sans point d'entrée, exactement ce que cette mission
         * doit supprimer.
         *
         * Ici, l'activité et ses mesures ne sont plus deux boîtes voisines :
         * c'est UN objet. Les chiffres qui qualifient la fenêtre vivent dans la
         * même surface que la courbe qui la dessine, parce qu'ils parlent de la
         * même chose. La légende de statut monte dans l'en-tête de la scène.
         */}
        <section className="aig-stage flex min-w-0 flex-col overflow-hidden">
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4 pb-3">
            <div className="min-w-0">
              <p className="aig-text-faint text-3xs font-medium uppercase tracking-[0.2em]">
                Fenêtre 24 heures
              </p>
              <h2 className="aig-display text-base font-semibold">Activité de la flotte</h2>
            </div>
            {slices ? (
              <div className="ml-auto min-w-0">
                <StatusLegend slices={slices} />
              </div>
            ) : (
              <p className="aig-text-faint ml-auto text-2xs">fenêtre non lue</p>
            )}
          </header>

          {/* Le graphe est posé dans un CREUX : il est accueilli par la scène,
              il n'est pas une carte de plus posée dessus. */}
          <div className="aig-inset mx-3 min-w-0">{renderActivityPanel(buckets)}</div>

          {/* Les mesures ferment la scène — elles qualifient la courbe qu'on
              vient de lire, au lieu de la précéder hors contexte. */}
          <div className="px-3 pt-3 pb-3">
            <KpiStrip kpis={overview.kpis} unread={unread} />
          </div>
        </section>

        {/* SECOND RANG — le flux et les projets. Ils ne portent plus de liseré
            complet : `aig-quiet` les détache par la valeur, ce qui retire deux
            cadres identiques de l'écran sans rien perdre de la structure.

            60 / 40 : le flux se lit ligne à ligne et garde la majorité, mais les
            projets portent DES CARTES — à 30 % la colonne n'en montrait que deux
            sur dix et coupait la troisième au bord. */}
        <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[6fr_4fr] [&>*]:min-w-0">
          <QuietSection
            title="Flux d'exécution"
            hint={runs ? `${runs.length} sur la fenêtre` : undefined}
            href="/runs"
            hrefLabel="Tous les runs"
          >
            {renderRunStreamPanel(runs, nowMs)}
          </QuietSection>

          <QuietSection
            title="Projets"
            hint={`${projectCards.length} au catalogue`}
            href="/projects"
            hrefLabel="Catalogue"
          >
            {projectCards.length === 0 ? (
              <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
            ) : (
              <ProjectCarousel cards={rankedProjects} />
            )}
          </QuietSection>
        </div>

        {overview.dataWarnings.length > 0 ? (
          <p className="aig-accent truncate px-1 font-mono text-2xs">
            {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
          </p>
        ) : null}
      </PageBody>
    </>
  )
}
