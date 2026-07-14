'use client'

import { motion, useSpring, useTransform } from 'motion/react'
import { useEffect, useState } from 'react'

export function AnimatedNumber({ value }: { value: string }) {
  // Extract all non-numeric prefix/suffix (like '$' or '%') and the numeric value
  const numMatch = value.match(/[\d.,]+/)
  const numStr = numMatch ? numMatch[0] : ''
  const rawNum = numMatch ? parseFloat(numStr.replace(/,/g, '')) : NaN

  const prefix = numMatch ? value.slice(0, numMatch.index) : ''
  const suffix = numMatch ? value.slice(numMatch.index! + numStr.length) : ''
  const hasDecimals = numStr.includes('.')
  
  const spring = useSpring(0, {
    bounce: 0,
    duration: 1500, // 1.5 seconds smooth roll-up
  })

  const display = useTransform(spring, (current) => {
    if (hasDecimals) {
      return current.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }
    return Math.round(current).toLocaleString('en-US')
  })

  useEffect(() => {
    if (!isNaN(rawNum)) {
      spring.set(rawNum)
    }
  }, [rawNum, spring])

  if (!numMatch || isNaN(rawNum)) return <>{value}</>

  return (
    <span className="inline-flex">
      {prefix && <span>{prefix}</span>}
      <motion.span>{display}</motion.span>
      {suffix && <span>{suffix}</span>}
    </span>
  )
}
