'use client'

import { AnimateNumber, Cursor } from '@motionplus/core/react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'

import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import { SEVERITY } from '@/lib/cockpit/status'

const WIDTH = 600
const HEIGHT = 220
const PAD_X = 12
const PAD_TOP = 16
const PAD_BOTTOM = 28

function buildPath(points: readonly { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ')
}

export function GhostActivityGraph() {
  return (
    <div className="relative px-1 pt-1 pb-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-48 w-full overflow-visible xl:h-56"
        role="img"
        aria-label="Aucune activité sur la fenêtre"
      >
        <defs>
          <pattern id="millimeter-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--aig-line)" strokeWidth="0.5" strokeOpacity="0.3" />
          </pattern>
          <linearGradient id="ghost-fade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--aig-line)" stopOpacity="0.15" />
            <stop offset="100%" stopColor="var(--aig-line)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width={WIDTH} height={HEIGHT - PAD_BOTTOM} fill="url(#millimeter-grid)" />
        <rect x="0" y="0" width={WIDTH} height={HEIGHT - PAD_BOTTOM} fill="url(#ghost-fade)" />

        <path
          d={`M ${PAD_X},${HEIGHT - PAD_BOTTOM} Q ${WIDTH / 2},${HEIGHT - PAD_BOTTOM - 20} ${WIDTH - PAD_X},${HEIGHT - PAD_BOTTOM}`}
          fill="none"
          stroke="var(--aig-line)"
          strokeWidth="1"
          strokeOpacity="0.5"
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-zinc-400 text-xs uppercase tracking-wider bg-[#0a0a0a]/80 backdrop-blur-sm px-4 py-1.5 rounded-full border border-white/5 shadow-sm">
          Ready to monitor — Aucun run sur les dernières 24 h
        </span>
      </div>
    </div>
  )
}

export default function ActivityGraph({ buckets }: Readonly<{ buckets: HourlyBucket[] }>) {
  const [hovered, setHovered] = useState<number | null>(null)

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
    <div className="px-1 pt-1 pb-0" onPointerLeave={() => setHovered(null)}>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-48 w-full overflow-visible xl:h-56"
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
                stroke="var(--aig-line-soft)"
                strokeWidth="1"
                strokeDasharray="4,6"
              />
            )
          })}

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
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.4, ease: 'easeInOut' }}
          />
        </svg>

        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { delayChildren: 0.2, staggerChildren: 1.2 / 24 } } }}
        >
          {points.map((point, index) => (
            <motion.span
              key={point.bucket.hourMs}
              className="aig-base absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
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

      <div aria-hidden className="mt-1 flex">
        {points.map((point, i) => (
          <span
            key={point.bucket.hourMs}
            className="text-zinc-400 flex-1 text-center font-mono text-3xs"
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
                className="aig-display text-lg font-semibold tabular-nums"
                transition={{ type: 'spring', visualDuration: 0.4, bounce: 0.15 }}
              >
                {active.bucket.total}
              </AnimateNumber>
              <span className="text-zinc-400 text-xs">
                run{active.bucket.total > 1 ? 's' : ''} · {active.bucket.label}
              </span>
            </div>
          </Cursor>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
