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
import { formatUsd } from '@/lib/agent-mission-control/format'
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
    <nav
      aria-label="Pagination du catalogue"
      className="absolute -top-8 right-4 z-10 flex items-center gap-1"
    >
      <motion.button
        type="button"
        aria-label="Projets précédents"
        aria-disabled={!isPrevActive}
        onClick={prevPage}
        animate={{ opacity: isPrevActive ? 1 : 0.3 }}
        transition={{ duration: 0.3 }}
        className="flex size-7 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
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
        className="flex size-7 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
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
    <article className="flex h-full w-60 flex-col divide-y divide-white/10 rounded-xl bg-white/5 ring-1 ring-white/10">
      <div className="flex flex-1 flex-col items-center px-5 py-6 text-center">
        {/* La MARQUE du projet — initiales pour l'instant. Le jour où un projet
            porte un logo, c'est ici qu'il se substitue, sans toucher au reste
            de la carte. */}
        <span className="flex size-20 shrink-0 items-center justify-center rounded-full bg-white/10 text-xl font-semibold text-white ring-1 ring-white/10">
          {initialsOf(card.name)}
        </span>

        <Strong className="mt-4 block w-full truncate">{card.name}</Strong>
        <Text className="mt-1 block w-full truncate text-xs">
          {card.repoFullName ?? 'aucun dépôt lié'}
        </Text>

        {/* L'équipe est un CHIFFRE parmi les autres, pas une pastille : un
            badge coloré sur chaque carte devient un motif décoratif, et une
            couleur qui apparaît partout ne signale plus rien. */}

        {/* Un projet SANS agent n'a pas « 0 run pour $0.00 » : il n'a rien à
            mesurer. Troisième état, distinct d'une mesure à zéro. */}
        {empty ? (
          <Text className="mt-4 text-xs">aucun agent · rien à mesurer</Text>
        ) : (
          <dl className="mt-4 grid w-full grid-cols-4 gap-1">
            <div className="min-w-0">
              <dt className="truncate text-2xs text-zinc-400">Agents</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
                {card.activeCount}/{card.copilotCount}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-2xs text-zinc-400">Runs</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
                {card.runs24h === null ? <AbsentMark /> : card.runs24h}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-2xs text-zinc-400">Coût</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
                {card.costLast24hUsd === null ? <AbsentMark /> : formatUsd(card.costLast24hUsd)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="truncate text-2xs text-zinc-400">Succès</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
                {card.passRate === null ? <AbsentMark /> : `${Math.round(card.passRate * 100)} %`}
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
          className="flex items-center justify-center gap-1.5 py-3 text-xs font-medium text-white no-underline hover:bg-white/5"
        >
          <FolderIcon />
          Ouvrir
        </Link>
        <Link
          href={`/runs?project=${card.id}`}
          className="flex items-center justify-center gap-1.5 py-3 text-xs font-medium text-white no-underline hover:bg-white/5"
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
    <div className="relative px-4 pt-2 pb-4">
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
