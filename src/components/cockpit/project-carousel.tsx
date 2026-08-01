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

import { Badge } from '@/components/ui/badge'
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
  const live = card.activeCount > 0
  const empty = card.copilotCount === 0

  return (
    <article className="flex h-full w-64 flex-col gap-3 rounded-lg bg-white/5 p-4 ring-1 ring-white/10">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-white">
          {initialsOf(card.name)}
        </span>
        <div className="min-w-0 flex-1">
          <Strong className="block truncate">{card.name}</Strong>
          <Text className="block truncate text-xs">{card.repoFullName ?? 'aucun dépôt lié'}</Text>
        </div>
      </div>

      <Badge color={live ? 'emerald' : 'zinc'} className="w-fit">
        {empty ? 'aucun agent' : `${card.activeCount}/${card.copilotCount} actifs`}
      </Badge>

      {empty ? (
        <Text className="text-xs">rien à mesurer</Text>
      ) : (
        <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
          <div className="min-w-0">
            <dt className="truncate text-xs text-zinc-400">Runs</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
              {card.runs24h === null ? <AbsentMark /> : card.runs24h}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="truncate text-xs text-zinc-400">Coût</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
              {card.costLast24hUsd === null ? <AbsentMark /> : formatUsd(card.costLast24hUsd)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="truncate text-xs text-zinc-400">Succès</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-white tabular-nums">
              {card.passRate === null ? <AbsentMark /> : `${Math.round(card.passRate * 100)} %`}
            </dd>
          </div>
        </dl>
      )}
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
