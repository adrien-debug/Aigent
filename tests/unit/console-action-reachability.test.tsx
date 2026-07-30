/**
 * A row's action must stay reachable at any width.
 *
 * The console's two registries (`agents-screen`, `projects-screen`) put their
 * only per-row destination in the last column of a horizontally scrollable
 * table. Unpinned, that column sits past the scroll container's right edge:
 * measured in a real browser on `/admin/projects`, the "Open Builder" control
 * rendered 67px OUTSIDE its container — present in the DOM, invisible at rest,
 * reachable only by discovering a horizontal scrollbar. Typecheck, the unit
 * suite and every gate stayed green, because nothing asserted reachability.
 *
 * The fix is `sticky right-0` on both the action header and the action cell,
 * with an opaque background so the pinned column does not let scrolled content
 * bleed through it. This test pins that contract textually, on the real source
 * — jsdom has no layout engine, so it cannot measure the overflow that exposed
 * the bug, but it can prove the pin is still there.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const CONSOLE_DIR = join(process.cwd(), 'src/components/console')

function source(file: string): string {
  return readFileSync(join(CONSOLE_DIR, file), 'utf8')
}

/** Screens whose tables carry a per-row action in a scrollable container. */
const REGISTRIES = ['agents-screen.tsx', 'projects-screen.tsx'] as const

describe('console registries — the row action is never scrolled out of reach', () => {
  it.each(REGISTRIES)('%s pins its action column to the right edge', (file) => {
    const text = source(file)

    // The action cell AND its header are both pinned: pinning only the cell
    // leaves the header sliding away from the column it labels.
    const pinnedCells = text.match(/className="sticky right-0[^"]*"/g) ?? []
    expect(pinnedCells.length).toBeGreaterThanOrEqual(2)
  })

  it.each(REGISTRIES)('%s gives the pinned column an opaque background', (file) => {
    const text = source(file)

    // `sticky` without a background lets the scrolled row show through the
    // pinned cell — the action becomes unreadable rather than unreachable.
    for (const cls of text.match(/className="sticky right-0[^"]*"/g) ?? []) {
      expect(cls).toMatch(/bg-surface-(raised|sunken|app|overlay)/)
    }
  })

  it('projects-screen keeps its Builder action inside the pinned column', () => {
    const text = source('projects-screen.tsx')
    const cellStart = text.indexOf('sticky right-0 bg-surface-raised')
    expect(cellStart).toBeGreaterThan(-1)
    // The control lives in the cell that was pinned, not in an earlier column.
    expect(text.slice(cellStart, cellStart + 400)).toContain('Open Builder')
  })
})
