'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/catalyst/button'

/**
 * UI-only "Run tests" trigger. On click it flips to a disabled "Queued…"
 * state for 2 seconds, then resets. No execution happens (V1 is mock-only).
 */
export function RunTestsButton() {
  const [queued, setQueued] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    }
  }, [])

  function handleClick() {
    if (queued) return
    setQueued(true)
    timeoutRef.current = setTimeout(() => setQueued(false), 2000)
  }

  return (
    <Button color="accent" disabled={queued} onClick={handleClick}>
      {queued ? 'Queued…' : 'Run tests'}
    </Button>
  )
}
