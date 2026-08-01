'use client'

/**
 * L'activité horaire en courbe — tracé animé, curseur qui suit le pointeur.
 *
 * CE QUE CE GRAPHE DIT, ET CE QU'IL REFUSE DE DIRE
 * ------------------------------------------------
 * Une heure sans run vaut ZÉRO, et c'est une mesure : la fenêtre a bien été
 * lue, il ne s'est rien passé. La courbe descend donc à zéro, elle ne
 * s'interrompt pas. En revanche une fenêtre NON LUE ne descend pas ici du tout
 * — l'appelant rend une absence à la place, parce qu'un axe plat sur un backend
 * muet peindrait une flotte sereine par-dessus une panne.
 *
 * Le curseur montre le NOMBRE DE RUNS de l'heure survolée, pas une variation en
 * pourcentage : sur un volume horaire qui passe de 1 à 3 runs, « +200 % » est
 * vrai et parfaitement trompeur.
 *
 * `AnimateNumber` et `Cursor` viennent de `@motionplus/core` (Motion+).
 */
import { AnimateNumber, Cursor } from '@motionplus/core/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import { SEVERITY } from '@/lib/cockpit/status'

/** Repère du tracé — coordonnées internes, indépendantes de la taille rendue. */
const WIDTH = 600
const HEIGHT = 220
const PAD_X = 12
const PAD_TOP = 16
const PAD_BOTTOM = 28

function buildPath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
}

export default function ActivityGraph({ buckets }: Readonly<{ buckets: HourlyBucket[] }>) {
  const [hovered, setHovered] = useState<number | null>(null)

  // L'échelle part TOUJOURS de zéro et garde deux crans minimum : sans le
  // plancher, une fenêtre à un seul run remplirait toute la hauteur et se
  // lirait comme un pic d'activité.
  const max = Math.max(2, ...buckets.map((b) => b.total))
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const step = (WIDTH - PAD_X * 2) / Math.max(buckets.length - 1, 1)

  const points = buckets.map((bucket, i) => ({
    x: PAD_X + i * step,
    y: PAD_TOP + plotH - (bucket.total / max) * plotH,
    bucket,
  }))

  const linePath = buildPath(points)
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? PAD_X},${PAD_TOP + plotH} L ${PAD_X},${PAD_TOP + plotH} Z`
  const active = hovered === null ? null : points[hovered]

  return (
    <div className="relative px-2 pt-2 pb-1" onPointerLeave={() => setHovered(null)}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        // Hauteur FIXE : sans elle, le SVG garde son ratio 600×220 et grandit
        // en hauteur avec la largeur de l'écran — une ligne plate occupait
        // 600 px de haut. La hauteur d'un graphe ne dépend pas de la taille de
        // la fenêtre, elle dépend de ce qu'il y a à lire.
        //
        // `preserveAspectRatio` reste au défaut (`meet`) : le passer à `none`
        // étirerait la géométrie, et les points ronds deviendraient des ovales.
        className="h-40 w-full overflow-visible"
        role="img"
        aria-label={`Activité par heure sur la fenêtre — ${buckets.reduce((n, b) => n + b.total, 0)} runs`}
      >
        <defs>
          <linearGradient id="activity-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={SEVERITY.good} stopOpacity="0.22" />
            <stop offset="100%" stopColor={SEVERITY.good} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((ratio) => {
          const y = PAD_TOP + plotH * ratio
          return (
            <line
              key={ratio}
              x1={PAD_X}
              y1={y}
              x2={WIDTH - PAD_X}
              y2={y}
              stroke="currentColor"
              className="text-white/8"
              strokeWidth="1"
              strokeDasharray="4,6"
            />
          )
        })}

        {/* L'aire n'apparaît qu'APRÈS le tracé : la remplir pendant que la
            ligne se dessine donnerait une surface qui grandit toute seule. */}
        <motion.path
          d={areaPath}
          fill="url(#activity-area)"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.9 }}
        />

        <motion.path
          d={linePath}
          fill="none"
          stroke={SEVERITY.good}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, ease: 'easeInOut' }}
        />

        <motion.g
          initial="hidden"
          animate="visible"
          variants={{
            visible: { transition: { delayChildren: 0.2, staggerChildren: 1.2 / 24 } },
          }}
        >
          {points.map((point, index) => (
            <g key={point.bucket.hourMs}>
              {/* Zone de capture large : viser un point de 4 px au pointeur est
                  impossible, la colonne entière déclenche le survol. */}
              <rect
                x={point.x - step / 2}
                y={0}
                width={step}
                height={HEIGHT}
                fill="transparent"
                onPointerEnter={() => setHovered(index)}
                className="cursor-pointer"
              />
              <motion.circle
                cx={point.x}
                cy={point.y}
                r="4"
                fill="#000"
                stroke={SEVERITY.good}
                strokeWidth="1.5"
                animate={{ scale: hovered === index ? 1.6 : 1 }}
                variants={{
                  hidden: { scale: 0, opacity: 0 },
                  visible: { scale: 1, opacity: 1 },
                }}
              />
            </g>
          ))}
        </motion.g>

        {/* Un libellé toutes les six heures : les vingt-quatre se chevaucheraient. */}
        {points.map((point, i) =>
          i % 6 === 0 ? (
            <text
              key={point.bucket.hourMs}
              x={point.x}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-zinc-500 font-mono text-[9px]"
            >
              {point.bucket.label}
            </text>
          ) : null,
        )}
      </svg>

      <AnimatePresence>
        {active ? (
          <Cursor
            follow
            key="activity-cursor"
            offset={{ x: 18, y: 18 }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
          >
            <div className="flex items-baseline gap-1.5 rounded-full border border-white/10 bg-black px-3 py-1.5">
              <AnimateNumber
                className="text-lg font-semibold text-white tabular-nums"
                transition={{ type: 'spring', visualDuration: 0.4, bounce: 0.15 }}
              >
                {active.bucket.total}
              </AnimateNumber>
              <span className="text-xs text-zinc-400">
                run{active.bucket.total > 1 ? 's' : ''} · {active.bucket.label}
              </span>
            </div>
          </Cursor>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
