/**
 * AIGENT-FRONTEND-RESET-001 / P003 — the V2 slice must live INSIDE the design
 * system.
 *
 * The rule this pins was REVERSED mid-mission. The earlier doctrine forbade V2
 * from importing Catalyst; P003 requires the opposite — Catalyst is mandatory
 * and no parallel design system may exist. These probes exercise the gate in
 * its current direction, in BOTH senses: it must fire on a second palette, and
 * it must stay silent on legitimate Catalyst usage. A gate only ever tested in
 * one direction is how "green" stops meaning anything.
 *
 * Runs the real script against the real tree with a throwaway file inside the
 * real perimeter, removed in `finally` even when an assertion throws.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const SCRIPT = join(ROOT, 'scripts', 'check-frontend-v2-boundary.mjs')
const PROBE_DIR = join(ROOT, 'src', 'components', 'aigent-v2', '__boundary_probe__')

function runScript() {
  return execFileSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' })
}

async function withProbe(filename: string, source: string, assertion: () => void) {
  await mkdir(PROBE_DIR, { recursive: true })
  await writeFile(join(PROBE_DIR, filename), source)
  try {
    assertion()
  } finally {
    await rm(PROBE_DIR, { recursive: true, force: true })
  }
}

describe('check-frontend-v2-boundary.mjs — the slice stays inside the kit', () => {
  it('passes on the real repo tree today', () => {
    expect(() => runScript()).not.toThrow()
  })

  it('fails on a parallel token module', async () => {
    // This is literally how the previous iteration of the slice started a second
    // design system: one local `tokens.ts` holding surfaces, radii and a focus ring.
    await withProbe('tokens.ts', "export const surface = 'rounded-3xl bg-black'\n", () => {
      expect(() => runScript()).toThrow()
    })
  })

  it.each([
    ['hex literal', "export const Probe = () => <div className=\"bg-[#0A0A0B]\" />\n"],
    ['rgb() literal', "export const Probe = () => <div style={{ color: 'rgb(10, 10, 11)' }} />\n"],
  ])('fails on a raw colour chosen outside the palette (%s)', async (_label, source) => {
    await withProbe('probe.tsx', source, () => {
      expect(() => runScript()).toThrow()
    })
  })

  it('stays silent on a theme role read through var(--…)', async () => {
    // The danger role IS the sanctioned way to paint a failure; a gate that
    // flagged it would push authors back toward hard-coded hexes.
    await withProbe(
      'probe.tsx',
      "export const Probe = () => <span className=\"text-[var(--state-danger-text)]\">x</span>\n",
      () => {
        expect(() => runScript()).not.toThrow()
      }
    )
  })

  it('stays silent on a legitimate Catalyst import', async () => {
    await withProbe(
      'probe.tsx',
      "import { Badge } from '@/components/ui/badge'\nexport const Probe = () => <Badge>x</Badge>\n",
      () => {
        expect(() => runScript()).not.toThrow()
      }
    )
  })
})
