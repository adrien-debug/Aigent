/**
 * Unit tests for the Target Repo Sandbox RUNNER
 * (src/lib/agent-mission-control/target-repo-sandbox-runner.ts).
 *
 * Pure of the real world: child_process (execFile) and fs/promises are mocked —
 * NO real clone, NO real network, NO real process. Asserts the clone lands in a
 * unique dir, install-mode picks the right command per lockfile, scripts run
 * (passed/failed), cleanup fires on success AND failure, and keepSandbox keeps
 * the dir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- execFile mock ---------------------------------------------------------
type ExecCall = { cmd: string; args: string[]; env?: NodeJS.ProcessEnv }
let execCalls: ExecCall[]
let execImpl: (cmd: string, args: string[]) => { stdout: string; stderr: string }

vi.mock('node:child_process', () => ({
  // promisify(execFile) calls this with (file, args, options, callback).
  execFile: (
    cmd: string,
    args: string[],
    opts: { env?: NodeJS.ProcessEnv } | undefined,
    cb: (e: unknown, r?: { stdout: string; stderr: string }) => void
  ) => {
    execCalls.push({ cmd, args, env: opts?.env })
    try {
      cb(null, execImpl(cmd, args))
    } catch (err) {
      cb(err)
    }
  },
}))

// --- fs/promises mock ------------------------------------------------------
let existingFiles: Set<string>
let rmCalls: string[]
let pkgScripts: Record<string, string> | 'no-pkg'

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}ABC123`),
  rm: vi.fn(async (p: string) => {
    rmCalls.push(p)
  }),
  readFile: vi.fn(async (p: string) => {
    if (String(p).endsWith('package.json')) {
      if (pkgScripts === 'no-pkg') throw new Error('ENOENT')
      return JSON.stringify({ scripts: pkgScripts })
    }
    throw new Error('ENOENT')
  }),
  access: vi.fn(async (p: string) => {
    if (!existingFiles.has(String(p).split('/').pop() ?? '')) throw new Error('ENOENT')
  }),
}))

vi.mock('node:os', () => ({ tmpdir: () => '/tmp' }))

import { runTargetRepoSandbox } from '@/lib/agent-mission-control/target-repo-sandbox-runner'

function setup() {
  execCalls = []
  rmCalls = []
  existingFiles = new Set(['package.json'])
  pkgScripts = { typecheck: 'tsc', build: 'next build' }
  execImpl = () => ({ stdout: 'ok', stderr: '' })
}

const OPTS = { runId: 'sandbox_test', repo: 'owner/repo', branch: 'main', installMode: 'skip' as const, keepSandbox: false }

describe('runTargetRepoSandbox', () => {
  beforeEach(setup)
  afterEach(() => vi.clearAllMocks())

  it('2 — clones into a unique per-run dir and reports its path', async () => {
    const r = await runTargetRepoSandbox(OPTS)
    expect(r.sandboxPath).toContain('sandbox_test-')
    const clone = execCalls.find((c) => c.cmd === 'git' && c.args[0] === 'clone')
    expect(clone).toBeDefined()
    expect(clone!.args).toContain('--depth')
    expect(clone!.args[clone!.args.length - 1]).toBe(r.sandboxPath)
  })

  it('4 — present script exit 0 → passed', async () => {
    const r = await runTargetRepoSandbox(OPTS)
    expect(r.scriptResults.typecheck.status).toBe('passed')
  })

  it('5 — present script non-zero exit → failed', async () => {
    execImpl = (cmd, args) => {
      if (args.includes('typecheck')) {
        const e = Object.assign(new Error('exit 1'), { code: 1, stdout: 'error TS', stderr: '' })
        throw e
      }
      return { stdout: 'ok', stderr: '' }
    }
    const r = await runTargetRepoSandbox(OPTS)
    expect(r.scriptResults.typecheck.status).toBe('failed')
    expect(r.scriptResults.typecheck.outputExcerpt).toContain('error TS')
  })

  it('9 — installMode auto with package-lock.json → npm ci', async () => {
    existingFiles = new Set(['package.json', 'package-lock.json'])
    await runTargetRepoSandbox({ ...OPTS, installMode: 'auto' })
    const ci = execCalls.find((c) => c.cmd === 'npm' && c.args[0] === 'ci')
    expect(ci).toBeDefined()
  })

  it('9b — installMode auto with pnpm-lock.yaml → pnpm install --frozen-lockfile', async () => {
    existingFiles = new Set(['package.json', 'pnpm-lock.yaml'])
    await runTargetRepoSandbox({ ...OPTS, installMode: 'auto' })
    const pnpm = execCalls.find((c) => c.cmd === 'pnpm')
    expect(pnpm?.args).toEqual(['install', '--frozen-lockfile'])
  })

  it('9c — installMode skip runs no install command', async () => {
    await runTargetRepoSandbox({ ...OPTS, installMode: 'skip' })
    expect(execCalls.some((c) => c.args.includes('ci') || (c.cmd === 'npm' && c.args[0] === 'install'))).toBe(false)
  })

  it('verify present → runs verify, marks the rest covered_by_verify', async () => {
    pkgScripts = { verify: 'x', typecheck: 'tsc', build: 'next build' }
    const r = await runTargetRepoSandbox(OPTS)
    expect(r.scriptResults.verify.status).toBe('passed')
    expect(r.coveredByVerify).toContain('typecheck')
    expect(r.coveredByVerify).toContain('build')
    // typecheck/build were NOT run individually.
    expect(execCalls.filter((c) => c.args.includes('typecheck'))).toHaveLength(0)
  })

  it('10 — cleanup (rm) fires on success', async () => {
    const r = await runTargetRepoSandbox(OPTS)
    expect(rmCalls).toContain(r.sandboxPath)
  })

  it('10b — spawned scripts get a SCRATCH HOME, never the operator real ~ (credential isolation)', async () => {
    const realHome = process.env.HOME
    await runTargetRepoSandbox(OPTS)
    // Every spawned command runs with HOME pointed at a throwaway dir inside the
    // sandbox root, and git/npm global config pinned there — so a hostile script
    // or postinstall can't read ~/.ssh, ~/.npmrc, ~/.gitconfig, gh/claude tokens.
    const withEnv = execCalls.filter((c) => c.env)
    expect(withEnv.length).toBeGreaterThan(0)
    for (const call of withEnv) {
      expect(call.env?.HOME).toBeTruthy()
      expect(call.env?.HOME).not.toBe(realHome)
      expect(call.env?.HOME).toContain('aigent-target-sandbox')
      expect(call.env?.GIT_CONFIG_GLOBAL).toContain('aigent-target-sandbox')
      // The parent's secret-bearing vars never leak in.
      expect(call.env?.GITHUB_TOKEN).toBeUndefined()
      expect(call.env?.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
      expect(call.env?.OPENAI_API_KEY).toBeUndefined()
    }
  })

  it('11 — cleanup fires even when the clone fails', async () => {
    execImpl = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'clone') throw Object.assign(new Error('clone failed'), { stderr: 'fatal' })
      return { stdout: '', stderr: '' }
    }
    await expect(runTargetRepoSandbox(OPTS)).rejects.toThrow()
    // Both disposable dirs were still removed: the clone AND the scratch HOME
    // (the throwaway home that isolates spawned scripts from the operator's ~).
    expect(rmCalls.length).toBe(2)
  })

  it('12 — keepSandbox true → no rm, path returned', async () => {
    const r = await runTargetRepoSandbox({ ...OPTS, keepSandbox: true })
    expect(rmCalls).toEqual([])
    expect(r.sandboxPath).toContain('sandbox_test-')
  })

  it('3 — absent scripts are simply not run (never invented)', async () => {
    pkgScripts = { typecheck: 'tsc' } // no build/lint/verify
    const r = await runTargetRepoSandbox(OPTS)
    expect(r.scriptResults.build).toBeUndefined()
    expect(r.scriptResults.lint).toBeUndefined()
    expect(Object.keys(r.scriptResults)).toEqual(['typecheck'])
  })
})
