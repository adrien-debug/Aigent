/**
 * AIG-PACK-015 — deterministic export of the six trading agents.
 *
 * Pure, offline: drives scripts/export-trading-packages.mjs against the FROZEN
 * snapshot (delivery/tradeagent/_snapshot/db-truth.json). No network, no OpenAI,
 * no DB — the export is a function of committed bytes only.
 *
 * Proves the three mission guarantees:
 *   (a) reproducibility — two consecutive exports are byte-identical;
 *   (b) tamper detection — flipping one byte of a package changes its checksum;
 *   (c) safety gate — an invalid Sentinel/Pulse contract BLOCKS the whole export.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'

const REPO = resolve(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'export-trading-packages.mjs')
const SNAPSHOT = join(REPO, 'delivery', 'tradeagent', '_snapshot', 'db-truth.json')

const SLUGS = [
  'atlas-market-structure',
  'vector-quant-regime',
  'sentinel-risk-manager',
  'pulse-execution-scout',
  'meridian-macro-context',
  'sage-trading-coach',
] as const

const tempDirs: string[] = []
function freshOut(): string {
  const d = mkdtempSync(join(tmpdir(), 'aig-pack-015-'))
  tempDirs.push(d)
  return d
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true })
})

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Run the export into `outDir` from a chosen snapshot. Returns parsed stdout. */
function runExport(outDir: string, snapshotOverride?: string): {
  ok: boolean
  globalChecksum: string
  agents: Array<{ slug: string; contractValid: boolean; evidenceLevel: string; benchmarkGlobal: number | null }>
} {
  const env = { ...process.env }
  if (snapshotOverride) env.AIG_PACK_SNAPSHOT = snapshotOverride
  const stdout = execFileSync('node', [SCRIPT, '--out', outDir], {
    cwd: REPO,
    env,
    encoding: 'utf8',
  })
  return JSON.parse(stdout)
}

/** Recursively list files under `dir`, path relative to `dir`, sorted. */
function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out.sort()
}

/** Hash every emitted file into a { relPath -> sha256 } map (ignores _snapshot). */
function hashTree(dir: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const rel of listFiles(dir)) {
    if (rel.startsWith('_snapshot')) continue
    map[rel] = sha256(readFileSync(join(dir, rel)))
  }
  return map
}

describe('AIG-PACK-015 export — structure', () => {
  it('emits a package.json, contract.json and checksum.txt per agent + a global manifest', () => {
    const out = freshOut()
    const res = runExport(out)
    expect(res.ok).toBe(true)
    for (const slug of SLUGS) {
      expect(readdirSync(join(out, slug)).sort()).toEqual(['checksum.txt', 'contract.json', 'package.json'])
    }
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    expect(manifest.agentCount).toBe(6)
    expect(manifest.agents.map((a: { slug: string }) => a.slug).sort()).toEqual([...SLUGS].sort())
    expect(manifest.globalChecksum).toMatch(/^[0-9a-f]{64}$/)
  })

  it('every agent carries the required fields (identity, version, model, prompt, contract, tools, provenance, evidence, benchmark, markets)', () => {
    const out = freshOut()
    runExport(out)
    for (const slug of SLUGS) {
      const pkg = JSON.parse(readFileSync(join(out, slug, 'package.json'), 'utf8'))
      expect(pkg.identity.slug).toBe(slug)
      expect(pkg.version.delivered).toMatch(/^v\d+\.\d+\.\d+/)
      expect(pkg.model.model).toBe('gpt-5.4')
      expect(typeof pkg.prompt.systemPrompt).toBe('string')
      expect(pkg.prompt.systemPrompt.length).toBeGreaterThan(100)
      expect(pkg.contract.schemaName).toBeTruthy()
      expect(Array.isArray(pkg.tools)).toBe(true)
      expect(pkg.tools.length).toBeGreaterThan(0)
      expect(pkg.provenance.sourceCommit).toBe('d44844129bde0736915ccf30df8ef7cf9b8576ab')
      expect(pkg.evidenceLevel).toBe('FIXTURE')
      expect(pkg.benchmark.present).toBe(true)
      // Market compat is reconciled to the real backend — NOT "ETH-only" capability.
      expect(pkg.marketCompatibility.backendExecutableMarkets).toEqual(['ETH', 'BTC', 'SOL', 'XAU'])
    }
  })

  it('the checksum.txt for each agent matches a freshly recomputed sha256 of its files', () => {
    const out = freshOut()
    runExport(out)
    for (const slug of SLUGS) {
      const pkgBytes = readFileSync(join(out, slug, 'package.json'))
      const contractBytes = readFileSync(join(out, slug, 'contract.json'))
      const checksumTxt = readFileSync(join(out, slug, 'checksum.txt'), 'utf8')
      expect(checksumTxt).toContain(sha256(pkgBytes))
      expect(checksumTxt).toContain(sha256(contractBytes))
    }
  })

  it('the global manifest checksums match the on-disk package files', () => {
    const out = freshOut()
    runExport(out)
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    for (const entry of manifest.agents) {
      const pkgBytes = readFileSync(join(out, entry.package.path))
      const contractBytes = readFileSync(join(out, entry.contract.path))
      expect(sha256(pkgBytes)).toBe(entry.package.sha256)
      expect(sha256(contractBytes)).toBe(entry.contract.sha256)
    }
  })
})

describe('AIG-PACK-015 export — (a) reproducibility', () => {
  it('two consecutive exports are byte-identical (same global checksum + same file hashes)', () => {
    const outA = freshOut()
    const outB = freshOut()
    const a = runExport(outA)
    const b = runExport(outB)
    expect(a.globalChecksum).toBe(b.globalChecksum)

    const treeA = hashTree(outA)
    const treeB = hashTree(outB)
    expect(Object.keys(treeA).sort()).toEqual(Object.keys(treeB).sort())
    for (const rel of Object.keys(treeA)) {
      expect(treeB[rel], `file ${rel} must be byte-identical across runs`).toBe(treeA[rel])
    }
  })

  it('re-running over an existing output directory is idempotent (identical bytes)', () => {
    const out = freshOut()
    const first = runExport(out)
    const treeFirst = hashTree(out)
    const second = runExport(out) // overwrite in place
    const treeSecond = hashTree(out)
    expect(second.globalChecksum).toBe(first.globalChecksum)
    expect(treeSecond).toEqual(treeFirst)
  })
})

describe('AIG-PACK-015 export — (b) tamper detection', () => {
  it('flipping one byte of a delivered package.json breaks its recorded checksum', () => {
    const out = freshOut()
    runExport(out)
    const slug = 'atlas-market-structure'
    const pkgPath = join(out, slug, 'package.json')
    const original = readFileSync(pkgPath, 'utf8')
    const recorded = sha256(readFileSync(pkgPath))

    // Alter exactly one byte (a digit in the benchmark score) — smallest change.
    const tampered = original.replace('0.985', '0.986')
    expect(tampered).not.toBe(original)
    writeFileSync(pkgPath, tampered)

    const after = sha256(readFileSync(pkgPath))
    expect(after).not.toBe(recorded)

    // The manifest's recorded checksum no longer matches the tampered file — detected.
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    const entry = manifest.agents.find((a: { slug: string }) => a.slug === slug)
    expect(after).not.toBe(entry.package.sha256)
    expect(recorded).toBe(entry.package.sha256) // pre-tamper hash was the recorded one
  })

  it('a single flipped byte anywhere in the tree changes the recomputed global checksum', () => {
    const out = freshOut()
    const res = runExport(out)
    // Recompute the global checksum the same way the script does, then tamper.
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
    const recompute = () => {
      const entries = [...manifest.agents].sort((a, b) => a.slug.localeCompare(b.slug))
      return sha256(
        entries
          .map((e) => `${e.slug}:${sha256(readFileSync(join(out, e.package.path)))}:${sha256(readFileSync(join(out, e.contract.path)))}`)
          .join('\n'),
      )
    }
    expect(recompute()).toBe(res.globalChecksum)

    const victim = join(out, 'sage-trading-coach', 'contract.json')
    const body = readFileSync(victim, 'utf8')
    writeFileSync(victim, body.replace('v1.0.0', 'v1.0.1'))
    expect(recompute()).not.toBe(res.globalChecksum)
  })
})

describe('AIG-PACK-015 export — (c) safety gate: invalid Sentinel/Pulse blocks the export', () => {
  function corruptedSnapshot(slug: string, mutate: (m: Record<string, unknown>) => void): string {
    const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
    const cp = snap.copilots.find((c: { slug: string }) => c.slug === slug)
    const latest = cp.copilot_versions.find((v: { id: string }) => v.id === cp.latest_version_id)
    const manifest = cp.manifests.find((m: { id: string }) => m.id === latest.manifest_id)
    mutate(manifest)
    const dir = mkdtempSync(join(tmpdir(), 'aig-pack-015-bad-'))
    tempDirs.push(dir)
    const path = join(dir, 'db-truth.json')
    writeFileSync(path, JSON.stringify(snap, null, 2))
    return path
  }

  /**
   * Run against an ALTERNATE snapshot via AIG_PACK_SNAPSHOT. The frozen
   * committed snapshot is never touched — the corrupted copy lives in a temp
   * dir only.
   */
  function runWithSnapshot(badSnapshotPath: string, outDir: string): { code: number; stderr: string } {
    try {
      execFileSync('node', [SCRIPT, '--out', outDir], {
        cwd: REPO,
        env: { ...process.env, AIG_PACK_SNAPSHOT: badSnapshotPath },
        encoding: 'utf8',
      })
      return { code: 0, stderr: '' }
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string }
      return { code: e.status ?? 1, stderr: String(e.stderr ?? '') }
    }
  }

  it('an invalid Sentinel contract (bad schemaName) aborts the export non-zero', () => {
    const bad = corruptedSnapshot('sentinel-risk-manager', (m) => {
      ;(m.output_contract as Record<string, unknown>).schemaName = 'NotARealContract'
    })
    const out = freshOut()
    const r = runWithSnapshot(bad, out)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/BLOCKED/i)
    expect(r.stderr).toMatch(/sentinel-risk-manager/)
  })

  it('an invalid Pulse contract (empty invariants) aborts the export non-zero', () => {
    const bad = corruptedSnapshot('pulse-execution-scout', (m) => {
      ;(m.output_contract as Record<string, unknown>).invariants = []
    })
    const out = freshOut()
    const r = runWithSnapshot(bad, out)
    expect(r.code).not.toBe(0)
    expect(r.stderr).toMatch(/BLOCKED/i)
    expect(r.stderr).toMatch(/pulse-execution-scout/)
  })

  it('after any blocked run, the real snapshot is restored and a normal export still succeeds', () => {
    // Verifies the corruption tests did not leave the frozen snapshot damaged.
    const out = freshOut()
    const res = runExport(out)
    expect(res.ok).toBe(true)
    expect(res.agents.every((a) => a.contractValid)).toBe(true)
  })
})
