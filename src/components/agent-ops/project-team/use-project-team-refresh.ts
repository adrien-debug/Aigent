'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { ProjectTeamGraph } from '@/lib/agent-mission-control/project-team/types'
import { readGraphEdges, readGraphNodes, toTeamAgentView, toTeamEdgeView } from './project-team-panel'

/** Poll cadence. Plain HTTP polling on purpose: no WebSocket, no SSE, no fake stream. */
const REFRESH_INTERVAL_MS = 10_000

/**
 * Signature of everything the UI actually reacts to (status, activity, edge
 * liveness). Two graphs with the same signature are the same picture, so the
 * state is NOT replaced — no re-render, no re-layout, no animation fired for
 * an identical payload.
 */
function graphSignature(graph: ProjectTeamGraph | null): string {
  if (!graph) return ''
  const nodes = readGraphNodes(graph)
    .map(toTeamAgentView)
    .map((n) => `${n.id}:${n.status ?? ''}:${n.lastActivityAt ?? ''}:${n.latestRunStatus ?? ''}`)
    .sort()
  const edges = readGraphEdges(graph)
    .map(toTeamEdgeView)
    .map((e) => `${e.id}:${e.active ? '1' : '0'}:${e.lastActivityAt ?? ''}`)
    .sort()
  return `${nodes.join('|')}#${edges.join('|')}`
}

export interface ProjectTeamRefreshState {
  graph: ProjectTeamGraph | null
  /** True once a poll failed and the last successful graph is therefore stale. */
  stale: boolean
  /** ISO timestamp of the last SUCCESSFUL poll, or null before the first one. */
  lastSyncedAt: string | null
  /** Bumped only when the payload really changed — drives the "updated" animation. */
  changeToken: number
  refreshNow: () => void
}

/**
 * Keeps the team graph fresh without ever inventing data.
 *
 * - polls every 10s, PAUSED while `document.hidden` (a backgrounded tab costs
 *   the backend nothing) and resumed with an immediate fetch on focus;
 * - one AbortController per in-flight request, aborted on unmount AND before
 *   each new request, so a slow response can never resolve into an unmounted
 *   component or overwrite a newer one;
 * - differential: state is only replaced when the signature moves, so an
 *   unchanged backend produces zero re-render and zero motion;
 * - a failed poll does NOT wipe the last good graph — it flags it `stale`.
 */
export function useProjectTeamRefresh(
  projectId: string,
  initialGraph: ProjectTeamGraph | null
): ProjectTeamRefreshState {
  const [graph, setGraph] = useState<ProjectTeamGraph | null>(initialGraph)
  const [stale, setStale] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [changeToken, setChangeToken] = useState(0)

  // LAZY init. `useRef(expr)` evaluates `expr` on EVERY render and throws the
  // result away after mount — and `graphSignature` is a full map→map→sort over
  // every node AND edge. The filter state lives in the consumer, so a plain
  // `useRef(graphSignature(initialGraph))` re-ran that O(n log n) pass on every
  // keystroke in the search box for nothing. Null is not a valid signature
  // (the empty graph signature is `''`), so it is an unambiguous "not computed".
  const signatureRef = useRef<string | null>(null)
  if (signatureRef.current === null) signatureRef.current = graphSignature(initialGraph)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  const poll = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const response = await fetch(`/api/agent-ops/projects/${encodeURIComponent(projectId)}/team`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`status ${response.status}`)
      const next = (await response.json()) as ProjectTeamGraph
      if (!mountedRef.current || controller.signal.aborted) return

      const nextSignature = graphSignature(next)
      setStale(false)
      setLastSyncedAt(new Date().toISOString())
      if (nextSignature !== signatureRef.current) {
        signatureRef.current = nextSignature
        setGraph(next)
        setChangeToken((token) => token + 1)
      }
    } catch {
      if (controller.signal.aborted || !mountedRef.current) return
      // Keep showing the last good graph, flagged stale. Never blank the canvas
      // and never substitute a fabricated one.
      setStale(true)
    }
  }, [projectId])

  useEffect(() => {
    mountedRef.current = true
    let timer: ReturnType<typeof setInterval> | null = null

    const start = () => {
      if (timer !== null) return
      timer = setInterval(() => {
        if (!document.hidden) void poll()
      }, REFRESH_INTERVAL_MS)
    }
    const stop = () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop()
        controllerRef.current?.abort()
      } else {
        void poll()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stop()
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [poll])

  const refreshNow = useCallback(() => {
    void poll()
  }, [poll])

  return { graph, stale, lastSyncedAt, changeToken, refreshNow }
}
