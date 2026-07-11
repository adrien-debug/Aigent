'use client'

import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { useState } from 'react'

import { Badge } from '@/components/catalyst/badge'
import { Switch } from '@/components/catalyst/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import type { ToolDefinition, ToolRiskLevel } from '@/lib/agent-mission-control/types'

const numberFormat = new Intl.NumberFormat('en-US')

const riskLabels: Record<ToolRiskLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

function isConfirmationForced(tool: ToolDefinition): boolean {
  return tool.riskLevel === 'high' || tool.riskLevel === 'critical'
}

/**
 * Tool permission matrix — one row per tool. Optimistic switches persisted via
 * PATCH /api/agent-ops/tools/:id (gpu1) ; revert on failure. High & critical
 * risk tools have confirmation locked on. Designed to sit flush inside an
 * AgentSectionCard with `contentClassName="p-0"`.
 */
export function ToolPermissionMatrix({ tools }: { tools: ToolDefinition[] }) {
  const [enabledState, setEnabledState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tools.map((tool) => [tool.id, tool.enabled]))
  )
  const [confirmationState, setConfirmationState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(tools.map((tool) => [tool.id, tool.requiresConfirmation]))
  )

  function persist(toolId: string, patch: { enabled?: boolean; requiresConfirmation?: boolean }) {
    void fetch(`/api/agent-ops/tools/${encodeURIComponent(toolId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
      })
      .catch(() => {
        // revert optimiste en cas d'échec réseau/serveur
        if (typeof patch.enabled === 'boolean') {
          setEnabledState((prev) => ({ ...prev, [toolId]: !patch.enabled }))
        }
        if (typeof patch.requiresConfirmation === 'boolean') {
          setConfirmationState((prev) => ({ ...prev, [toolId]: !patch.requiresConfirmation }))
        }
      })
  }

  return (
    <div className="px-6 [--gutter:--spacing(6)]">
      <Table striped bleed dense>
        {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
        <caption className="sr-only">Tool permissions</caption>
        <TableHead>
          <TableRow>
            <TableHeader>Tool</TableHeader>
            <TableHeader>Provider</TableHeader>
            <TableHeader>Risk</TableHeader>
            <TableHeader>Enabled</TableHeader>
            <TableHeader>Confirmation</TableHeader>
            <TableHeader>Routes</TableHeader>
            <TableHeader>Last activity</TableHeader>
            <TableHeader className="text-right">Calls</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {tools.map((tool) => {
            const forced = isConfirmationForced(tool)
            const enabled = enabledState[tool.id] ?? tool.enabled
            const requiresConfirmation = forced ? true : (confirmationState[tool.id] ?? tool.requiresConfirmation)
            const visibleRoutes = tool.scopedRoutes.slice(0, 1)
            const hiddenRouteCount = tool.scopedRoutes.length - visibleRoutes.length

            return (
              <TableRow key={tool.id}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-sm text-zinc-950 dark:text-white">{tool.name}</span>
                    <span className="max-w-56 truncate text-xs text-zinc-500" title={tool.description}>
                      {tool.description}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge color="zinc" className="font-mono">
                    {tool.provider}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                    {tool.riskLevel === 'critical' ? (
                      <ExclamationTriangleIcon aria-hidden="true" className="size-3.5 shrink-0" />
                    ) : null}
                    {riskLabels[tool.riskLevel]}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      color="accent"
                      checked={enabled}
                      onChange={(checked) => {
                        setEnabledState((prev) => ({ ...prev, [tool.id]: checked }))
                        persist(tool.id, { enabled: checked })
                      }}
                      aria-label={`Enable ${tool.name}`}
                    />
                    <span className="text-xs text-zinc-500">{enabled ? 'On' : 'Off'}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      color="accent"
                      checked={requiresConfirmation}
                      disabled={forced}
                      onChange={(checked) => {
                        if (!forced) {
                          setConfirmationState((prev) => ({ ...prev, [tool.id]: checked }))
                          persist(tool.id, { requiresConfirmation: checked })
                        }
                      }}
                      // A locked-on switch must LOOK on (doctrine): keep the green track, just dim it.
                      className={
                        forced
                          ? 'cursor-not-allowed! data-disabled:opacity-60! data-disabled:data-checked:bg-(--switch-bg)! data-disabled:data-checked:ring-(--switch-bg-ring)! dark:data-disabled:data-checked:bg-(--switch-bg)! dark:data-disabled:data-checked:ring-(--switch-bg-ring)!'
                          : undefined
                      }
                      aria-label={`Require confirmation for ${tool.name}`}
                      title={
                        forced
                          ? `Locked on: ${tool.riskLevel} risk tools always require confirmation`
                          : undefined
                      }
                    />
                    <span className="text-xs text-zinc-500">
                      {forced ? 'Locked · On' : requiresConfirmation ? 'On' : 'Off'}
                      {forced ? (
                        <span className="sr-only">
                          {' '}
                          — {tool.riskLevel} risk tools always require confirmation
                        </span>
                      ) : null}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {tool.scopedRoutes.length === 0 ? (
                    <span className="text-xs text-zinc-500">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">No scoped routes</span>
                    </span>
                  ) : (
                    <div className="flex items-center gap-1">
                      {visibleRoutes.map((route) => (
                        <span
                          key={route}
                          className="rounded-md bg-zinc-950/5 px-1.5 py-0.5 font-mono text-xs text-zinc-500 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10"
                        >
                          {route}
                        </span>
                      ))}
                      {hiddenRouteCount > 0 ? (
                        <span
                          className="text-xs text-zinc-500 tabular-nums"
                          title={tool.scopedRoutes.join(', ')}
                        >
                          +{hiddenRouteCount}
                          <span className="sr-only"> more scoped routes</span>
                        </span>
                      ) : null}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {tool.lastUsedAt ? formatTimestamp(tool.lastUsedAt) : 'Never used'}
                    </span>
                    {tool.lastErrorMessage ? (
                      <span className="flex items-center gap-1 text-xs text-accent-600 dark:text-accent-400">
                        <ExclamationTriangleIcon aria-hidden="true" className="size-3.5 shrink-0" />
                        <span className="sr-only">Last error: </span>
                        <span className="max-w-48 truncate" title={tool.lastErrorMessage}>
                          {tool.lastErrorMessage}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                  {numberFormat.format(tool.callsLast7d)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
