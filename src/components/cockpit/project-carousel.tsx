'use client'

/**
 * Le catalogue de projets en carrousel — `Carousel` de Motion+.
 *
 * Le paquet vit sur le registre privé de Motion (`@motionplus/core`, scope
 * `@motionplus` sur `api.motion.dev/npm/`) et non sur npmjs.org : la version
 * publique `motion-plus@1.5.1` n'expose PAS `Carousel`, et le paquet du
 * monorepo est marqué `"private": true`, donc jamais publié tel quel. Le nom
 * scopé réel est `@motionplus/core` — c'est la seule façon de l'installer.
 *
 * `Carousel` porte le défilement, l'inertie, le snap par page et le clavier ;
 * `useCarousel` rend l'état de pagination aux commandes. On ne réimplémente
 * rien de tout ça.
 */
import { Carousel, useCarousel } from '@motionplus/core/react'
import { motion } from 'motion/react'

import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { ProjectCard } from '@/lib/cockpit/named-runs'
import { AbsentMark, initialsOf } from './primitives'

function ChevronLeftIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  )
}

/**
 * Les deux flèches de page.
 *
 * Elles s'estompent en bout de course au lieu d'être `disabled` : un bouton
 * désactivé sort du parcours clavier et disparaît des lecteurs d'écran, alors
 * que « on est au bout » est une information qui vaut d'être annoncée.
 * `aria-disabled` la porte sans retirer le bouton.
 */
function Navigation() {
  const { nextPage, prevPage, isNextActive, isPrevActive } = useCarousel()

  return (
    /* Les flèches vivent DANS la boîte du carrousel, en bas à droite.
       Elles étaient en `-top-8`, c'est-à-dire 32 px AU-DESSUS de leur
       conteneur : elles atterrissaient dans l'en-tête du `Panel` et
       recouvraient le hint « n au catalogue » (constaté à l'écran, le chevron
       droit chevauchait le mot). On ne peut pas les passer en `actions` du
       `Panel` : `useCarousel` n'existe que sous `<Carousel>`. */
    <nav
      aria-label="Pagination du catalogue"
      className="absolute right-0 -bottom-1 z-10 flex items-center gap-1"
    >
      <motion.button
        type="button"
        aria-label="Projets précédents"
        aria-disabled={!isPrevActive}
        onClick={prevPage}
        animate={{ opacity: isPrevActive ? 1 : 0.3 }}
        transition={{ duration: 0.3 }}
        className="aig-raised flex size-7 items-center justify-center rounded-md transition hover:text-white"
      >
        <ChevronLeftIcon />
      </motion.button>

      <motion.button
        type="button"
        aria-label="Projets suivants"
        aria-disabled={!isNextActive}
        onClick={nextPage}
        animate={{ opacity: isNextActive ? 1 : 0.3 }}
        transition={{ duration: 0.3 }}
        className="aig-raised flex size-7 items-center justify-center rounded-md transition hover:text-white"
      >
        <ChevronRightIcon />
      </motion.button>
    </nav>
  )
}

/**
 * Une carte projet.
 *
 * Le carrousel n'a de sens que si la carte porte PLUS que la ligne de liste
 * qu'elle remplace — sinon on a rendu la même information moins accessible.
 * Elle montre donc l'équipe, le dépôt et les trois mesures ensemble.
 *
 * Une mesure absente reste absente : `runs24h === null` n'est pas `0`, et un
 * projet sans agent n'affiche pas « 0 run pour $0.00 » — il n'a rien à mesurer,
 * ce qui est un troisième état.
 */
function ProjectSlide({ card }: Readonly<{ card: ProjectCard }>) {
  const empty = card.copilotCount === 0

  return (
    /* `w-40` fixe : le `Carousel` mesure ses slides pour paginer, donc une
       carte fluide (`flex-1`, `%`) casserait le snap par page. On resserre de
       176 à 160 px pour qu'une colonne à 40 % en montre trois entières au lieu
       de deux et un moignon coupé au bord. */
    <article className="aig-panel flex h-full w-40 flex-col divide-y divide-[color:var(--aig-line-soft)]">
      <div className="flex flex-1 flex-col items-center px-3 py-4 text-center">
        {/* La MARQUE du projet — initiales pour l'instant. Le jour où un projet
            porte un logo, c'est ici qu'il se substitue, sans toucher au reste
            de la carte. */}
        <span className="aig-raised flex size-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {initialsOf(card.name)}
        </span>

        <Strong className="mt-2.5 block w-full truncate text-sm">{card.name}</Strong>
        <Text className="mt-0.5 block w-full truncate text-2xs">
          {card.repoFullName ?? 'aucun dépôt lié'}
        </Text>

        {/* L'équipe est un CHIFFRE parmi les autres, pas une pastille : un
            badge coloré sur chaque carte devient un motif décoratif, et une
            couleur qui apparaît partout ne signale plus rien. */}

        {/* Un projet SANS agent n'a pas « 0 run pour $0.00 » : il n'a rien à
            mesurer. Troisième état, distinct d'une mesure à zéro. */}
        {/* DEUX mesures, pas quatre : dans 11 rem de large, quatre colonnes
            tronquent leurs libellés et « Coût » finit à « Co… ». L'équipe et
            le volume suffisent à décider si on ouvre le projet ; le détail est
            derrière le clic. */}
        {empty ? (
          <Text className="mt-3 text-2xs">aucun agent</Text>
        ) : (
          <dl className="mt-3 grid w-full grid-cols-2 gap-1">
            <div className="min-w-0">
              <dt className="aig-text-muted truncate text-2xs">Agents</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
                {card.activeCount}/{card.copilotCount}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="aig-text-muted truncate text-2xs">Runs</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
                {card.runs24h === null ? <AbsentMark /> : card.runs24h}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {/* Pied d'actions — des liens RÉELS vers des routes qui existent, jamais
          un bouton décoratif. */}
      <div className="grid shrink-0 grid-cols-2 divide-x divide-white/10">
        <Link
          href={`/projects/${card.id}`}
          className="aig-text-muted flex items-center justify-center gap-1.5 py-3 text-xs font-medium no-underline transition hover:bg-white/5 hover:text-white"
        >
          <FolderIcon />
          Ouvrir
        </Link>
        <Link
          href={`/runs?project=${card.id}`}
          className="aig-text-muted flex items-center justify-center gap-1.5 py-3 text-xs font-medium no-underline transition hover:bg-white/5 hover:text-white"
        >
          <BoltIcon />
          Runs
        </Link>
      </div>
    </article>
  )
}

export default function ProjectCarousel({ cards }: Readonly<{ cards: ProjectCard[] }>) {
  return (
    /* `pb-10` réserve la bande où les flèches se sont réinstallées (elles
       débordaient dans l'en-tête du `Panel`). */
    <div className="relative px-4 pt-2 pb-10">
      <Carousel
        gap={12}
        snap="page"
        loop={false}
        items={cards.map((card) => (
          <ProjectSlide key={card.id} card={card} />
        ))}
      >
        <Navigation />
      </Carousel>
    </div>
  )
}
