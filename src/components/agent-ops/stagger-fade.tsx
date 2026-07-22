'use client'

import { motion } from 'motion/react'
import { ReactNode } from 'react'
import clsx from 'clsx'

export function StaggerFade({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: delay * 0.1,
        ease: [0.21, 0.47, 0.32, 0.98], // Linear-esque smooth curve
      }}
      className={clsx(className)}
    >
      {children}
    </motion.div>
  )
}
