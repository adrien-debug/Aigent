'use client'

import {
  ArrowPathIcon,
  ArrowsPointingOutIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  ViewfinderCircleIcon,
} from '@heroicons/react/20/solid'
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { Input, InputGroup } from '@/components/catalyst/input'
import { Select } from '@/components/catalyst/select'

export type ProjectTeamViewMode = 'structure' | 'activity' | 'dependencies'

export const VIEW_MODES: { value: ProjectTeamViewMode; label: string }[] = [
  { value: 'structure', label: 'Structure' },
  { value: 'activity', label: 'Activity' },
  { value: 'dependencies', label: 'Dependencies' },
]

/**
 * Viewport commands belong to the canvas (it owns the React Flow instance and
 * its own `ReactFlowProvider`, so no hook outside it can reach the viewport).
 * The toolbar therefore ASKS by event; project-team-view.tsx bridges the event
 * onto the canvas's real React Flow controls. Keeping it an event rather than a
 * ref means the toolbar stays a dumb, testable component.
 */
export const CANVAS_COMMAND_EVENT = 'project-team-canvas-command'
export type CanvasCommand = 'fit' | 'recenter' | 'zoom-in' | 'zoom-out'

export function dispatchCanvasCommand(command: CanvasCommand): void {
  window.dispatchEvent(new CustomEvent<CanvasCommand>(CANVAS_COMMAND_EVENT, { detail: command }))
}

const iconButtonClass =
  'inline-flex size-11 items-center justify-center rounded-lg border border-white/5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 sm:size-9'

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Headless.Button onClick={onClick} aria-label={label} title={label} className={iconButtonClass}>
      {children}
    </Headless.Button>
  )
}

export interface ProjectTeamFilters {
  query: string
  status: string
  runtime: string
  team: string
}

export const EMPTY_FILTERS: ProjectTeamFilters = { query: '', status: 'all', runtime: 'all', team: 'all' }

export function hasActiveFilters(filters: ProjectTeamFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.status !== 'all' ||
    filters.runtime !== 'all' ||
    filters.team !== 'all'
  )
}

/**
 * Delay before the filter result is announced. Typing "sentinel" moves the
 * count eight times; a live region wired straight to it interrupts the screen
 * reader eight times and the user never hears a whole sentence. The number is
 * announced only once the count has SETTLED, and never on first paint (the
 * initial count is already in the accessible name of the surface, so announcing
 * it on load would be noise, not news).
 */
const COUNT_SETTLE_MS = 700

function useSettledCountMessage(visibleCount: number, totalCount: number): string {
  const [settled, setSettled] = useState('')
  const seenFirstValue = useRef(false)

  useEffect(() => {
    if (!seenFirstValue.current) {
      seenFirstValue.current = true
      return
    }
    const timer = setTimeout(
      () => setSettled(`${visibleCount} of ${totalCount} agents shown`),
      COUNT_SETTLE_MS
    )
    return () => clearTimeout(timer)
  }, [visibleCount, totalCount])

  return settled
}

export function ProjectTeamToolbar({
  filters,
  onFiltersChange,
  statusOptions,
  runtimeOptions,
  teamOptions,
  viewMode,
  onViewModeChange,
  onClearFilters,
  onRefresh,
  visibleCount,
  totalCount,
}: {
  filters: ProjectTeamFilters
  onFiltersChange: (next: ProjectTeamFilters) => void
  statusOptions: { value: string; label: string }[]
  runtimeOptions: { value: string; label: string }[]
  teamOptions: { value: string; label: string }[]
  viewMode: ProjectTeamViewMode
  onViewModeChange: (mode: ProjectTeamViewMode) => void
  onClearFilters: () => void
  onRefresh: () => void
  visibleCount: number
  totalCount: number
}) {
  const filtersActive = hasActiveFilters(filters)
  const settledCountMessage = useSettledCountMessage(visibleCount, totalCount)

  return (
    <div className="flex flex-col gap-3 border-b border-white/5 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
      {/* Search + filters. They compose with AND — see project-team-view.tsx. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <InputGroup>
            <MagnifyingGlassIcon data-slot="icon" aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search agents by name or role"
              placeholder="Search name or role…"
              value={filters.query}
              onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
            />
          </InputGroup>
        </div>

        <Select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => onFiltersChange({ ...filters, status: event.target.value })}
          className="w-full sm:w-40"
        >
          <option value="all">All statuses</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by runtime"
          value={filters.runtime}
          onChange={(event) => onFiltersChange({ ...filters, runtime: event.target.value })}
          className="w-full sm:w-40"
        >
          <option value="all">All runtimes</option>
          {runtimeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by team"
          value={filters.team}
          onChange={(event) => onFiltersChange({ ...filters, team: event.target.value })}
          className="w-full sm:w-40"
        >
          <option value="all">All teams</option>
          {teamOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Headless.Button
          onClick={onClearFilters}
          disabled={!filtersActive}
          className={clsx(
            'rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
            filtersActive
              ? 'text-accent-300 hover:bg-white/5'
              : 'cursor-not-allowed text-zinc-600'
          )}
        >
          Clear filters
        </Headless.Button>

        {/* The visible counter updates on every keystroke — that immediacy is
            exactly right for a sighted user and exactly wrong for a live
            region, so the two are split. `aria-hidden` here is not hiding
            information: the sr-only region below states the same sentence,
            once the count stops moving. */}
        <span aria-hidden="true" className="text-xs text-zinc-500">
          {visibleCount} of {totalCount} agents shown
        </span>
        <span aria-live="polite" className="sr-only">
          {settledCountMessage}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* View mode. Segmented control, not a color-coded one: the active
            segment is told apart by its surface + border + aria-pressed. */}
        <div
          role="group"
          aria-label="Graph view mode"
          className="flex items-center gap-1 rounded-lg border border-white/5 p-1"
        >
          {VIEW_MODES.map((mode) => {
            const active = mode.value === viewMode
            return (
              <Headless.Button
                key={mode.value}
                onClick={() => onViewModeChange(mode.value)}
                aria-pressed={active}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                  active
                    ? 'bg-white/10 text-white ring-1 ring-white/10'
                    : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {mode.label}
              </Headless.Button>
            )
          })}
        </div>

        <div className="flex items-center gap-1">
          <IconAction label="Fit view" onClick={() => dispatchCanvasCommand('fit')}>
            <ArrowsPointingOutIcon aria-hidden="true" className="size-4" />
          </IconAction>
          <IconAction label="Recenter" onClick={() => dispatchCanvasCommand('recenter')}>
            <ViewfinderCircleIcon aria-hidden="true" className="size-4" />
          </IconAction>
          <IconAction label="Zoom out" onClick={() => dispatchCanvasCommand('zoom-out')}>
            <MinusIcon aria-hidden="true" className="size-4" />
          </IconAction>
          <IconAction label="Zoom in" onClick={() => dispatchCanvasCommand('zoom-in')}>
            <PlusIcon aria-hidden="true" className="size-4" />
          </IconAction>
          <IconAction label="Refresh team graph" onClick={onRefresh}>
            <ArrowPathIcon aria-hidden="true" className="size-4" />
          </IconAction>
        </div>
      </div>
    </div>
  )
}
