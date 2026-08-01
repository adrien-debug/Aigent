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
    // Le padding est porté par le conteneur EXTÉRIEUR, et la boîte du tracé est
    // `relative` sans marge : les surcouches (points, colonnes de survol,
    // libellés) sont positionnées en pourcentage de CETTE boîte, donc tout
    // décalage de padding les désalignerait de la courbe.
    <div className="px-2 pt-2 pb-1" onPointerLeave={() => setHovered(null)}>
      <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        // Hauteur FIXE, et `none` pour que le tracé REMPLISSE sa boîte : au
        // défaut (`meet`), le SVG conserve son ratio 600×220 et se réduit pour
        // tenir dans la hauteur imposée — le dessin devenait minuscule, centré
        // dans une bande vide.
        //
        // Conséquence assumée : l'axe X est étiré. Deux compensations, et
        // deux seulement : `vector-effect` sur la COURBE (les lignes de grille
        // sont horizontales, l'étirement horizontal ne les épaissit pas), et
        // les points/libellés sortis du SVG en HTML — un `<circle>` dans un
        // viewBox étiré deviendrait un ovale.
        preserveAspectRatio="none"
        // Le graphe est l'ÉLÉMENT VISUEL MAJEUR de l'Aperçu, pas une vignette
        // dans un panneau parmi d'autres : il monte de 160 px à 224/288 px
        // selon la largeur disponible. À `h-40` sur une scène pleine largeur,
        // 24 heures de données tenaient dans une bande écrasée où les creux et
        // les pics se distinguaient à peine.
        className="h-56 w-full overflow-visible xl:h-72"
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

        {/* `non-scaling-stroke` : sans lui, l'étirement horizontal du viewBox
            épaissirait le trait de façon inégale selon la pente. */}
        <motion.path
          d={linePath}
          fill="none"
          stroke={SEVERITY.good}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, ease: 'easeInOut' }}
        />
      </svg>

      {/* Les POINTS vivent hors du SVG, positionnés en pourcentage : dans un
          viewBox étiré (`preserveAspectRatio="none"`), un `<circle>` devient un
          ovale. En HTML ils restent ronds quelle que soit la largeur. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { delayChildren: 0.2, staggerChildren: 1.2 / 24 } },
        }}
      >
        {points.map((point, index) => (
          <motion.span
            key={point.bucket.hourMs}
            // Le coeur du point reprend le FOND du panneau (`--aig-base`), pas un
            // noir absolu : c'est un trou dans la courbe, cercle par le halo de
            // severite ci-dessous. Code en dur, il se detachait d'un cran sur le
            // graphite et se lisait comme une pastille noire posee dessus.
            className="aig-base absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
            // Les deux axes sont exprimés dans le repère du SVG puis convertis
            // en pourcentage de la boîte : c'est la seule façon que le point
            // tombe sur la courbe quelle que soit la largeur rendue.
            style={{
              left: `${(point.x / WIDTH) * 100}%`,
              top: `${(point.y / HEIGHT) * 100}%`,
              boxShadow: `0 0 0 1.5px ${SEVERITY.good}`,
            }}
            animate={{ scale: hovered === index ? 1.6 : 1 }}
            variants={{ hidden: { scale: 0, opacity: 0 }, visible: { scale: 1, opacity: 1 } }}
          />
        ))}
      </motion.div>

      {/* Colonnes de survol — viser un point de 8 px au pointeur est
          impossible, la colonne entière déclenche. `inset-0` et non
          `bottom-7` : la réserve de 28 px servait aux libellés quand ils
          vivaient DANS cette boîte ; ils sont sortis dessous, donc cette bande
          n'était plus qu'une zone morte où le survol décrochait. */}
      <div className="absolute inset-0 flex">
        {points.map((point, index) => (
          <button
            key={point.bucket.hourMs}
            type="button"
            aria-label={`${point.bucket.label} — ${point.bucket.total} run(s)`}
            className="h-full flex-1 cursor-pointer"
            onPointerEnter={() => setHovered(index)}
            onFocus={() => setHovered(index)}
          />
        ))}
      </div>

      </div>

      {/* L'AXE EST SOUS LE TRACÉ, PAS DESSUS
          -----------------------------------
          Les libellés étaient `absolute … bottom-1` DANS la boîte du tracé :
          le plancher du plot (`y=192` sur 220, soit ~139 px sur 160) tombe
          plus bas qu'eux, donc la courbe et ses points passaient PAR-DESSUS
          « 06:00 », « 12:00 », « 18:00 », « 00:00 » — illisibles dès que la
          fenêtre est calme, c'est-à-dire exactement quand l'axe sert encore.
          En flux normal, sous le SVG, plus aucun recouvrement possible.

          Un libellé toutes les six heures : les vingt-quatre se
          chevaucheraient. Les cases vides gardent leur `flex-1` pour que les
          libellés restent alignés sur leur colonne. */}
      <div aria-hidden className="mt-1 flex">
        {points.map((point, i) => (
          <span
            key={point.bucket.hourMs}
            className="aig-text-faint flex-1 text-center font-mono text-3xs"
          >
            {i % 6 === 0 ? point.bucket.label : ''}
          </span>
        ))}
      </div>

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
            <div className="aig-panel-raised flex items-baseline gap-1.5 rounded-full px-3 py-1.5">
              <AnimateNumber
                className="text-lg font-semibold text-white tabular-nums"
                transition={{ type: 'spring', visualDuration: 0.4, bounce: 0.15 }}
              >
                {active.bucket.total}
              </AnimateNumber>
              <span className="aig-text-muted text-xs">
                run{active.bucket.total > 1 ? 's' : ''} · {active.bucket.label}
              </span>
            </div>
          </Cursor>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
