'use client'

/**
 * Pattern « dossier » — une grappe qui s'ouvre depuis sa vignette.
 *
 * DEUX POPULATIONS, DEUX TRAITEMENTS
 * ----------------------------------
 * · Les items VISIBLES sur la vignette fermée portent un `layoutId` : ils
 *   morphent de leur mini-case vers leur place dans la grille ouverte.
 * · Les autres n'existent pas dans l'état fermé. Ils ne peuvent donc pas
 *   morpher — ils JAILLISSENT du centre de la vignette, en cascade.
 *
 * La distinction n'est pas cosmétique : donner un `layoutId` à un élément
 * absent du premier état le ferait apparaître depuis une position vide, ce qui
 * produit un saut. C'est la raison du champ `shared` dans les fixtures.
 *
 * L'ORIGINE EST MESURÉE, PAS DEVINÉE
 * ----------------------------------
 * Le point d'où jaillissent les items non partagés est le centre RÉEL de la
 * vignette, lu au clic (`getBoundingClientRect`). Une origine codée en dur
 * casserait dès que la vignette change de place — et elle change, puisque la
 * page est responsive.
 */
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useCallback, useRef, useState } from 'react'

import { Strong, Text } from '@/components/ui/text'
import { LAB_CLUSTER } from './fixtures'

const SPRING = { type: 'spring', stiffness: 200, damping: 24, bounce: 0 } as const

const SHARED = LAB_CLUSTER.filter((a) => a.shared)
const REST = LAB_CLUSTER.filter((a) => !a.shared)

function Tile({ initials, size }: Readonly<{ initials: string; size: 'mini' | 'full' }>) {
  return (
    <span
      className={
        size === 'mini'
          ? 'aig-raised flex size-full items-center justify-center rounded-[5px] text-[8px] font-semibold'
          : 'aig-panel-raised flex size-14 items-center justify-center rounded-xl text-sm font-semibold'
      }
    >
      {initials}
    </span>
  )
}

export default function PatternCluster() {
  const [isOpen, setIsOpen] = useState(false)
  const thumbRef = useRef<HTMLButtonElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null)

  const openCluster = useCallback(() => {
    const thumb = thumbRef.current?.getBoundingClientRect()
    const grid = gridRef.current?.getBoundingClientRect()
    // L'origine est exprimée dans le repère de la GRILLE, parce que c'est elle
    // qui porte les items animés — la convertir ici évite de la recalculer
    // pour chaque item au rendu.
    if (thumb && grid) {
      setOrigin({
        x: thumb.left + thumb.width / 2 - (grid.left + grid.width / 2),
        y: thumb.top + thumb.height / 2 - (grid.top + grid.height / 2),
      })
    }
    setIsOpen(true)
  }, [])

  return (
    <MotionConfig transition={SPRING}>
      <div className="relative flex min-h-64 items-center justify-center">
        {!isOpen ? (
          <button
            ref={thumbRef}
            type="button"
            onClick={openCluster}
            className="flex flex-col items-center gap-2 rounded-2xl p-3 transition hover:bg-white/5 focus-visible:outline-hidden"
          >
            <span className="aig-panel grid grid-cols-2 grid-rows-2 gap-1.5 rounded-2xl p-2.5">
              {SHARED.map((agent) => (
                <motion.span key={agent.id} layoutId={`cluster-${agent.id}`} className="size-6">
                  <Tile initials={agent.initials} size="mini" />
                </motion.span>
              ))}
            </span>
            <Text className="text-xs">Équipe Dropship · {LAB_CLUSTER.length}</Text>
          </button>
        ) : null}

        <AnimatePresence>
          {isOpen ? (
            <motion.div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-black/60 p-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { delay: 0.05 } }}
              onClick={() => setIsOpen(false)}
            >
              <div ref={gridRef} className="flex flex-col items-center gap-4">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                >
                  <Strong className="text-white">Équipe Dropship</Strong>
                </motion.div>

                <div className="grid grid-cols-4 gap-x-5 gap-y-4">
                  {LAB_CLUSTER.map((agent) => {
                    const restIndex = REST.findIndex((r) => r.id === agent.id)
                    return (
                      <motion.div
                        key={agent.id}
                        className="flex flex-col items-center gap-1.5"
                        // Un item partagé morphe : il ne porte donc AUCUNE
                        // animation d'entrée, sinon les deux se combattent.
                        layoutId={agent.shared ? `cluster-${agent.id}` : undefined}
                        initial={
                          agent.shared
                            ? undefined
                            : { opacity: 0, scale: 0.3, x: origin?.x ?? 0, y: origin?.y ?? 0 }
                        }
                        animate={agent.shared ? undefined : { opacity: 1, scale: 1, x: 0, y: 0 }}
                        exit={
                          agent.shared
                            ? undefined
                            : {
                                opacity: 0,
                                scale: 0.3,
                                x: origin?.x ?? 0,
                                y: origin?.y ?? 0,
                                transition: { ...SPRING, delay: (REST.length - 1 - restIndex) * 0.02 },
                              }
                        }
                        transition={
                          agent.shared ? undefined : { ...SPRING, delay: restIndex * 0.025 }
                        }
                      >
                        <Tile initials={agent.initials} size="full" />
                        <span className="text-xs text-white/80">{agent.name}</span>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
