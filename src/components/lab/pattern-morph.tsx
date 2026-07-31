'use client'

/**
 * Pattern « ligne → fiche » — un morph d'élément partagé, en `layoutId`.
 *
 * COMMENT ÇA MARCHE
 * -----------------
 * Deux composants React DISTINCTS (la ligne, la fiche) portent le même
 * `layoutId` sur leurs éléments correspondants. Motion mesure les deux
 * positions et interpole entre elles — on ne calcule aucune coordonnée à la
 * main, contrairement à un morph écrit avec l'API View Transitions.
 *
 * POURQUOI CHAQUE ÉLÉMENT A SON PROPRE `layoutId`
 * -----------------------------------------------
 * Un seul `layoutId` sur le conteneur suffirait à faire voyager la boîte — mais
 * son contenu serait ÉTIRÉ par le changement d'échelle : le nom passerait de
 * 14 px à 19 px en étant déformé au passage. En donnant son propre calque à
 * l'avatar, au nom et à la pastille, chacun se déplace et se redimensionne
 * proprement, sur sa propre trajectoire. C'est la seule raison de la
 * démultiplication des `layoutId` ici.
 *
 * `'use client'` : Motion mesure le DOM. Aucune prop fonction ne traverse la
 * frontière — la page serveur ne passe que des données (`check:rsc-boundary`).
 */
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { Fact, FactValue, Rail, SEVERITY, initialsOf } from '@/components/cockpit/primitives'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { LAB_AGENTS, type LabAgent } from './fixtures'

const RAIL_COLOR: Record<LabAgent['status'], string> = {
  active: SEVERITY.good,
  degraded: SEVERITY.bad,
  inactive: SEVERITY.muted,
}

const STATUS_BADGE: Record<LabAgent['status'], 'emerald' | 'red' | 'zinc'> = {
  active: 'emerald',
  degraded: 'red',
  inactive: 'zinc',
}

const STATUS_LABEL: Record<LabAgent['status'], string> = {
  active: 'Actif',
  degraded: 'Dégradé',
  inactive: 'Inactif',
}

/**
 * Le ressort commun aux deux sens de la transition.
 *
 * `bounce: 0` : un rebond sur une fiche de données donne un mouvement joueur
 * qui contredit ce que l'écran dit. Le ressort sert ici à la CONTINUITÉ du
 * mouvement, pas à l'amuser.
 */
const SPRING = { type: 'spring', stiffness: 220, damping: 26, bounce: 0 } as const

function successLabel(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)} %`
}

export default function PatternMorph() {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = LAB_AGENTS.find((a) => a.id === openId) ?? null

  return (
    <MotionConfig transition={SPRING}>
      <div className="relative">
        <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
          {LAB_AGENTS.map((agent) => (
            <li key={agent.id} className="relative">
              <Rail color={RAIL_COLOR[agent.status]} />
              <button
                type="button"
                onClick={() => setOpenId(agent.id)}
                className="flex w-full items-center gap-3 py-2.5 pr-4 pl-4 text-left hover:bg-zinc-950/2.5 focus-visible:bg-zinc-950/2.5 focus-visible:outline-hidden dark:hover:bg-white/2.5"
              >
                {/* `layoutId` absent quand la fiche est ouverte SUR CET agent :
                    deux éléments ne peuvent pas partager un calque au même
                    instant, sinon Motion interpole entre deux positions dont
                    l'une est en train de disparaître. */}
                <motion.span
                  layoutId={openId === agent.id ? undefined : `avatar-${agent.id}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-950/3 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
                >
                  {initialsOf(agent.name)}
                </motion.span>

                <span className="min-w-0 flex-1">
                  <motion.span
                    layoutId={openId === agent.id ? undefined : `name-${agent.id}`}
                    className="block"
                  >
                    <Strong className="truncate">{agent.name}</Strong>
                  </motion.span>
                  <Text className="truncate text-xs">{agent.project}</Text>
                </span>

                <motion.span
                  layoutId={openId === agent.id ? undefined : `badge-${agent.id}`}
                  className="shrink-0"
                >
                  <Badge color={STATUS_BADGE[agent.status]}>{STATUS_LABEL[agent.status]}</Badge>
                </motion.span>
              </button>
            </li>
          ))}
        </ul>

        <AnimatePresence>
          {open ? (
            <>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setOpenId(null)}
                className="absolute inset-0 z-10 rounded-lg bg-zinc-950/45"
              />

              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
                <motion.div
                  key={`sheet-${open.id}`}
                  className="pointer-events-auto w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                >
                  <div className="flex items-center gap-3">
                    <motion.span
                      layoutId={`avatar-${open.id}`}
                      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-950/3 text-base font-semibold text-zinc-700 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
                    >
                      {initialsOf(open.name)}
                    </motion.span>

                    <div className="min-w-0 flex-1">
                      <motion.div layoutId={`name-${open.id}`}>
                        <Strong className="truncate text-base">{open.name}</Strong>
                      </motion.div>
                      <Text className="truncate text-xs">{open.project}</Text>
                    </div>

                    <motion.span layoutId={`badge-${open.id}`} className="shrink-0">
                      <Badge color={STATUS_BADGE[open.status]}>{STATUS_LABEL[open.status]}</Badge>
                    </motion.span>
                  </div>

                  {/* Le contenu propre à la fiche n'a pas d'équivalent dans la
                      ligne : il ne morphe pas, il apparaît — légèrement après,
                      pour ne pas concurrencer le mouvement des calques partagés. */}
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 0.08, duration: 0.22 }}
                  >
                    <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-zinc-950/2.5 p-3 dark:bg-white/5">
                      <Fact label="Runs 24 h" value={<FactValue>{open.runs24h}</FactValue>} />
                      <Fact
                        label="Succès"
                        value={
                          successLabel(open.successRate) === null ? null : (
                            <FactValue>{successLabel(open.successRate)}</FactValue>
                          )
                        }
                        why="Aucun run terminal sur la fenêtre : le taux n’existe pas, il ne vaut pas 0 %."
                      />
                      <Fact
                        label="Coût"
                        value={
                          open.costUsd === null ? null : <FactValue>{formatUsd(open.costUsd)}</FactValue>
                        }
                        why="Aucun run de cet agent n’a porté de coût mesurable."
                      />
                    </div>

                    {open.runBlockers.length > 0 ? (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {open.runBlockers.map((blocker) => (
                          <li
                            key={blocker}
                            className="rounded-lg border border-red-500/25 bg-red-50/60 px-3 py-2 dark:bg-red-950/20"
                          >
                            <Text className="text-xs">{blocker}</Text>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => setOpenId(null)}
                      className="mt-4 w-full rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-zinc-950"
                    >
                      Fermer
                    </button>
                  </motion.div>
                </motion.div>
              </div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
