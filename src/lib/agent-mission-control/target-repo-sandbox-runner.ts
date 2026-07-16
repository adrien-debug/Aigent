/**
 * Agent Mission Control — Target Repo Sandbox RUNNER (server only, disposable).
 *
 * Turns the Prompt-48 dry-run into a real execution: clones the target repo into
 * a UNIQUE disposable directory, optionally installs deps per its lockfile, runs
 * ONLY the repo scripts that actually exist (bounded by strict timeouts), and
 * returns sanitized, length-capped results the pure evaluator folds into the
 * report. The clone is ALWAYS cleaned up (unless keepSandbox for debug).
 *
 * Read-only doctrine end to end: `git clone --depth 1` (no write remote, no
 * push), never commits, never touches the target repo's branches. The clone is
 * a throwaway copy under a temp root — NEVER the Aigent repo itself. Secrets
 * (the token used to clone a private repo) never reach the report: the clone URL
 * is built locally and command output is sanitized before capture.
 *
 * Never import from a client component (reads GITHUB_TOKEN).
 */
import 'server-only'

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, readFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  sanitizeOutput,
  SANDBOX_SCRIPT_ORDER,
  type SandboxInstallMode,
  type ScriptExecResult,
} from './target-repo-sandbox'

const pExecFile = promisify(execFile)

/**
 * A minimal env for spawned commands: PATH + HOME only (plus optional extras),
 * deliberately WITHOUT the parent's secret-bearing vars. Typed as ProcessEnv.
 */
function minimalEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string> = {}
  if (process.env.PATH) env.PATH = process.env.PATH
  if (process.env.HOME) env.HOME = process.env.HOME
  return { ...env, ...extra } as NodeJS.ProcessEnv
}

// Strict bounds — never an unbounded run.
const PER_COMMAND_TIMEOUT_MS = 120_000 // 120s
const GLOBAL_BUDGET_MS = 8 * 60_000 // 8 min
const OUTPUT_CAP = 8000 // pre-sanitize cap (sanitizeOutput caps again at 4000)

export interface SandboxRunResult {
  sandboxPath: string
  scriptResults: Record<string, ScriptExecResult>
  coveredByVerify: string[]
  /** Scripts present in package.json (name → command). */
  targetScripts: Record<string, string> | null
  cleanedUp: boolean
}

/** Detect the package manager install command from the clone's lockfile. */
async function detectInstallCommand(dir: string): Promise<{ cmd: string; args: string[] } | null> {
  const has = async (f: string) => {
    try {
      await access(path.join(dir, f))
      return true
    } catch {
      return false
    }
  }
  if (await has('pnpm-lock.yaml')) return { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] }
  if (await has('yarn.lock')) return { cmd: 'yarn', args: ['install', '--frozen-lockfile'] }
  if (await has('package-lock.json')) return { cmd: 'npm', args: ['ci'] }
  if ((await has('bun.lockb')) || (await has('bun.lock'))) return { cmd: 'bun', args: ['install', '--frozen-lockfile'] }
  if (await has('package.json')) return { cmd: 'npm', args: ['install'] }
  return null
}

async function readScripts(dir: string): Promise<Record<string, string> | null> {
  try {
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> }
    return pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}
  } catch {
    return null
  }
}

/** Run one command with a hard timeout; capture merged stdout+stderr, sanitized. */
async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<ScriptExecResult> {
  const started = Date.now()
  try {
    const { stdout, stderr } = await pExecFile(cmd, args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      // Never inherit the parent's secret-bearing env into the target scripts.
      env: minimalEnv({ CI: '1' }),
    })
    const out = sanitizeOutput(`${stdout}\n${stderr}`.slice(0, OUTPUT_CAP))
    return { status: 'passed', durationMs: Date.now() - started, outputExcerpt: out }
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; stdout?: string; stderr?: string; code?: number }
    const timedOut = e.killed === true || e.signal === 'SIGTERM'
    const out = sanitizeOutput(`${e.stdout ?? ''}\n${e.stderr ?? ''}`.slice(0, OUTPUT_CAP))
    return { status: 'failed', durationMs: Date.now() - started, outputExcerpt: out, ...(timedOut ? { timedOut: true } : {}) }
  }
}

export interface RunSandboxOptions {
  runId: string
  repo: string // owner/name
  branch: string
  installMode: SandboxInstallMode
  keepSandbox: boolean
}

/**
 * Clone the target repo into a disposable dir, optionally install, run the
 * existing gate scripts (bounded), and return their results. ALWAYS cleans up
 * the clone unless keepSandbox. Never throws for a script failure — that's a
 * result; only a clone failure rejects (the caller reports it honestly).
 */
export async function runTargetRepoSandbox(opts: RunSandboxOptions): Promise<SandboxRunResult> {
  const token = process.env.GITHUB_TOKEN
  const root = path.join(tmpdir(), 'aigent-target-sandbox')
  await mkdir(root, { recursive: true })
  // Unique disposable dir per run: <tmp>/aigent-target-sandbox/<runId>-XXXXXX
  const sandboxPath = await mkdtemp(path.join(root, `${opts.runId}-`))
  const deadline = Date.now() + GLOBAL_BUDGET_MS

  let cleanedUp = false
  const cleanup = async () => {
    if (opts.keepSandbox || cleanedUp) return
    try {
      await rm(sandboxPath, { recursive: true, force: true })
      cleanedUp = true
    } catch {
      // best-effort — a leftover temp dir is not worth failing the run
    }
  }

  try {
    // Clone read-only, shallow. Token embedded only in the local URL (never
    // logged; output is sanitized regardless). --no-tags/--depth 1 keep it light.
    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${opts.repo}.git`
      : `https://github.com/${opts.repo}.git`
    await pExecFile(
      'git',
      ['clone', '--depth', '1', '--no-tags', '--branch', opts.branch, cloneUrl, sandboxPath],
      { timeout: PER_COMMAND_TIMEOUT_MS, env: minimalEnv() }
    )

    const targetScripts = await readScripts(sandboxPath)
    const scriptResults: Record<string, ScriptExecResult> = {}
    const coveredByVerify: string[] = []

    // Optional install.
    if (opts.installMode === 'auto') {
      const install = await detectInstallCommand(sandboxPath)
      if (install && Date.now() < deadline) {
        await runCommand(install.cmd, install.args, sandboxPath, PER_COMMAND_TIMEOUT_MS)
      }
    }

    // Option A (safest): if `verify` exists, run it and mark the rest
    // covered_by_verify — it composes typecheck+lint+test+build in this repo
    // family, so re-running them wastes the budget. Otherwise run each present
    // script in order until the global budget is exhausted.
    const present = (name: string) =>
      targetScripts !== null && Object.prototype.hasOwnProperty.call(targetScripts, name)

    if (present('verify')) {
      scriptResults['verify'] = await runCommand('npm', ['run', 'verify'], sandboxPath, PER_COMMAND_TIMEOUT_MS)
      for (const name of SANDBOX_SCRIPT_ORDER) {
        if (name !== 'verify' && present(name)) coveredByVerify.push(name)
      }
    } else {
      for (const name of SANDBOX_SCRIPT_ORDER) {
        if (name === 'verify' || !present(name)) continue
        if (Date.now() >= deadline) break
        scriptResults[name] = await runCommand('npm', ['run', name], sandboxPath, PER_COMMAND_TIMEOUT_MS)
      }
    }

    return { sandboxPath, scriptResults, coveredByVerify, targetScripts, cleanedUp: false }
  } finally {
    await cleanup()
  }
}
