#!/usr/bin/env node
/**
 * Dev stack supervisor — replaces `concurrently` for `npm run dev`.
 *
 * The defect this fixes: with `concurrently -k`, LangGraph could die
 * (SIGTERM/143) while Next kept serving. /admin answered 200 while every agent
 * run was broken. Here the two children share ONE lifetime: whichever dies
 * first, the other is killed and the supervisor exits non-zero.
 *
 * Also: this machine runs many Next dev servers from OTHER projects, and this
 * repo hosts editors, LSP servers and Claude Code sessions of its own. The
 * pre-flight cleanup therefore demands TWO proofs before killing anything —
 * the process's cwd is inside THIS repo AND its command is recognisably one of
 * our dev servers. Location alone is never authority to kill. Anything else
 * holding our port aborts the run: we never kill a process we cannot identify,
 * and never silently pick another port.
 *
 * Pure Node, no deps. Pure helpers are named exports (unit tested in
 * tests/unit/dev-stack.test.ts); importing this module does not run main().
 */
import { execFile, spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

// Single source of truth for "is the graph actually registered". health.mjs is
// side-effect free on import (its main() is guarded), so this costs nothing.
import { classifyAssistantsSearch } from './health.mjs'

const execFileAsync = promisify(execFile)

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RUNTIME_DIR = join(REPO_ROOT, '.runtime')

// Port de dev ABSOLU : 3210, jamais 3000 (voir AGENTS.md § "Port de dev").
// Cette machine fait tourner d'autres serveurs Next qui se battent pour le 3000 ;
// s'y mettre écrase un chantier voisin. Surchargeable par AIGENT_DEV_PORT au cas
// où 3210 serait lui-même pris, mais jamais un retour silencieux sur 3000.
const NEXT_PORT = Number(process.env.AIGENT_DEV_PORT) || 3210
const LANGGRAPH_PORT = Number(process.env.AIGENT_LANGGRAPH_PORT) || 2024
const NEXT_URL = `http://127.0.0.1:${NEXT_PORT}`
const LANGGRAPH_BASE_URL = `http://127.0.0.1:${LANGGRAPH_PORT}`
/** Graph id declared in langgraph.json — mirrors health.mjs / AGENT_BUILDER_GRAPH_ID. */
const GRAPH_ID = 'agent_builder'

/** Local binaries. Spawned directly, never through `npx` — see spawnChild(). */
const NEXT_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'next')
const LANGGRAPH_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'langgraphjs')

const NEXT_READY_TIMEOUT_MS = Number(process.env.DEV_STACK_NEXT_TIMEOUT_MS ?? 90_000)
const LANGGRAPH_READY_TIMEOUT_MS = Number(process.env.DEV_STACK_LANGGRAPH_TIMEOUT_MS ?? 120_000)
const READY_POLL_INTERVAL_MS = Number(process.env.DEV_STACK_POLL_INTERVAL_MS ?? 500)
const SHUTDOWN_GRACE_MS = Number(process.env.DEV_STACK_SHUTDOWN_GRACE_MS ?? 5_000)

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Is a listener owned by THIS repo, and therefore ours to kill?
 *
 * Critical safety property: a sibling directory sharing a textual prefix
 * (/Users/x/Aigent-old vs /Users/x/Aigent) is NOT inside the repo. Prefix
 * comparison must be segment-aware, hence the trailing separator.
 *
 * @param {string | null | undefined} cwd  resolved cwd of the listening process
 * @param {string} repoRoot                absolute path of this repo
 * @returns {boolean}
 */
export function isKillableListener(cwd, repoRoot) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) return false
  const target = resolve(cwd)
  const root = resolve(repoRoot)
  if (target === root) return true
  return target.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * Dev-server command signatures. Deliberately narrow: these are the only two
 * programs this supervisor ever starts, so they are the only two it may reclaim.
 *
 * `next-server (v16.2.10)` is the form Next rewrites its argv to once booted —
 * that exact string was the real runaway orphan (PPID 1, holding :3003) this
 * mission was opened for, so it MUST match.
 */
const DEV_SERVER_COMMAND_PATTERNS = [
  /\bnext-server\b/,
  /\bnext\s+dev\b/,
  /\blanggraphjs\b/,
  /\blanggraph\s+dev\b/,
]

/**
 * Is this `ps -o command=` line one of OUR dev servers?
 *
 * Positive identification, never a negative filter: anything unrecognised is
 * left alone. Being inside the repo is NOT evidence of being a dev server — an
 * editor's LSP server, a detached watcher and a running Claude Code session all
 * legitimately live with their cwd inside this repo, and killing one of those
 * is the defect this predicate exists to prevent.
 *
 * @param {string | null | undefined} command  full command line from ps
 * @returns {boolean}
 */
export function isDevServerCommand(command) {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (trimmed.length === 0) return false
  return DEV_SERVER_COMMAND_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/**
 * The full kill authorisation for a pre-flight reclaim: the process must be
 * ours BY LOCATION *and* ours BY IDENTITY. Both, never either.
 *
 * @param {string | null | undefined} cwd
 * @param {string | null | undefined} command
 * @param {string} repoRoot
 * @returns {boolean}
 */
export function isReclaimableProcess(cwd, command, repoRoot) {
  return isKillableListener(cwd, repoRoot) && isDevServerCommand(command)
}

/**
 * A foreign process's argv, reduced to something safe to print.
 *
 * The pre-flight abort names the process holding our port, and that message is
 * both printed and persisted to .runtime/. A full command line belonging to an
 * unrelated program can carry credentials (`--token=…`, `API_KEY=…` inlined
 * before the binary), so only the leading token — the program itself — is
 * shown. That is all an operator needs in order to go stop it.
 *
 * @param {string | null | undefined} command
 * @returns {string}
 */
export function summarizeCommand(command) {
  if (typeof command !== 'string') return 'unresolved'
  const trimmed = command.trim()
  if (trimmed.length === 0) return 'unresolved'
  const [head] = trimmed.split(/\s+/)
  return trimmed.length > head.length ? `${head} …` : head
}

/**
 * Parse `ps -Ao pid=,ppid=,command=` into records. The command is free-form and
 * contains spaces, so only the first two columns are split off.
 *
 * @param {string} stdout
 * @returns {Array<{pid: number, ppid: number, command: string}>}
 */
export function parsePsRecords(stdout) {
  /** @type {Array<{pid: number, ppid: number, command: string}>} */
  const records = []
  for (const raw of String(stdout).split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const match = /^(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const pid = Number.parseInt(match[1], 10)
    const ppid = Number.parseInt(match[2], 10)
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
    records.push({ pid, ppid, command: match[3] })
  }
  return records
}

/**
 * Does an /assistants/search response prove `graphId` is registered?
 *
 * A live LangGraph that has lost its graph is the exact "false green" this
 * mission targets, so an empty or non-array body is NOT proof of readiness.
 * Zero billed tokens — this only reads the registry.
 *
 * Delegates to health.mjs so the readiness gate and
 * `npm run health` can never drift apart — this used to be a second, divergent
 * copy under the same name (one returned a boolean, the other {healthy, reason}),
 * which is precisely how a safety classifier rots.
 *
 * @param {unknown} rows  parsed /assistants/search body
 * @param {string} graphId
 * @returns {boolean}
 */
export function graphIsRegistered(rows, graphId) {
  return classifyAssistantsSearch(rows, graphId).healthy
}

/**
 * One log line: ISO timestamp + service prefix + text.
 * Never called with environment values — child stdout/stderr only.
 *
 * @param {string} service  'next' | 'langgraph' | 'dev-stack'
 * @param {string} line
 * @param {Date} [now]
 * @returns {string}
 */
export function formatLogLine(service, line, now = new Date()) {
  return `${now.toISOString()} [${service}] ${line}`
}

/**
 * Split a raw child chunk into formatted log lines, dropping the trailing
 * empty fragment so a chunk ending in \n does not emit a blank line.
 *
 * @param {string} service
 * @param {string} chunk
 * @param {Date} [now]
 * @returns {string[]}
 */
export function formatLogChunk(service, chunk, now = new Date()) {
  return chunk
    .split('\n')
    .filter((line, index, all) => !(line === '' && index === all.length - 1))
    .map((line) => formatLogLine(service, line.replace(/\r$/, ''), now))
}

/**
 * Human-readable cause of a child's exit. A signal wins over a code: a process
 * killed by SIGTERM reports code null, and reporting "code null" hides the
 * whole story (that is exactly how the LangGraph death went unnoticed).
 *
 * @param {string} service
 * @param {number | null | undefined} code
 * @param {string | null | undefined} signal
 * @returns {string}
 */
export function formatExitReason(service, code, signal) {
  if (signal) return `${service} exited on signal ${signal}`
  if (typeof code === 'number') return `${service} exited with code ${code}`
  return `${service} exited for an unknown reason (no code, no signal)`
}

/**
 * Parse `lsof -p PID -a -d cwd -Fn` output into the cwd path.
 * Fields are one per line; the name field starts with 'n'.
 *
 * @param {string} stdout
 * @returns {string | null}
 */
export function parseLsofCwd(stdout) {
  for (const line of String(stdout).split('\n')) {
    if (line.startsWith('n')) {
      const value = line.slice(1).trim()
      if (value) return value
    }
  }
  return null
}

/**
 * Parse `lsof -ti :PORT -sTCP:LISTEN` output into unique numeric PIDs.
 *
 * @param {string} stdout
 * @returns {number[]}
 */
export function parsePids(stdout) {
  const pids = String(stdout)
    .split('\n')
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
  return [...new Set(pids)]
}

// ---------------------------------------------------------------------------
// Side-effecting supervisor
// ---------------------------------------------------------------------------

/**
 * @type {{
 *   next: import('node:fs').WriteStream,
 *   langgraph: import('node:fs').WriteStream,
 *   'dev-stack': import('node:fs').WriteStream,
 * } | null}
 */
let logStreams = null

function log(service, line) {
  const formatted = formatLogLine(service, line)
  process.stdout.write(formatted + '\n')
  const stream = logStreams?.[service]
  if (stream) stream.write(formatted + '\n')
}

function openLogs() {
  mkdirSync(RUNTIME_DIR, { recursive: true })
  logStreams = {
    next: createWriteStream(join(RUNTIME_DIR, 'next.log'), { flags: 'a' }),
    langgraph: createWriteStream(join(RUNTIME_DIR, 'langgraph.log'), { flags: 'a' }),
    // Supervisor-authored lines (pre-flight, reclaim, exit reason, shutdown) are
    // the post-mortem trail. Without this stream they existed only on a stdout
    // nobody was watching when the stack died.
    'dev-stack': createWriteStream(join(RUNTIME_DIR, 'dev-stack.log'), { flags: 'a' }),
  }
}

function recordExit(service, code, signal, reason) {
  try {
    mkdirSync(RUNTIME_DIR, { recursive: true })
    writeFileSync(
      join(RUNTIME_DIR, 'last-exit.json'),
      JSON.stringify({ service, code: code ?? null, signal: signal ?? null, reason, at: new Date().toISOString() }, null, 2) + '\n',
    )
  } catch (error) {
    log('dev-stack', `could not write last-exit.json: ${error.message}`)
  }
}

async function listenerPids(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'])
    return parsePids(stdout)
  } catch {
    // lsof exits 1 when nothing matches — that is "port free", not an error.
    return []
  }
}

async function processCwd(pid) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-p', String(pid), '-a', '-d', 'cwd', '-Fn'])
    return parseLsofCwd(stdout)
  } catch {
    return null
  }
}

/** Full command line of a pid, or null when it cannot be read. */
async function processCommand(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)])
    const command = stdout.trim()
    return command.length > 0 ? command : null
  } catch {
    return null
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * SIGTERM -> grace -> SIGKILL on a SINGLE pid. Used for reclaim only: a
 * process we did not spawn may lead a group we do not own, and signalling that
 * group could hit unrelated processes. Our own children go through killGroup().
 */
async function killPid(pid, label) {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return
  }
  const deadline = Date.now() + SHUTDOWN_GRACE_MS
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      log('dev-stack', `reclaimed ${label} (pid ${pid}) with SIGTERM`)
      return
    }
    await sleep(100)
  }
  try {
    process.kill(pid, 'SIGKILL')
    log('dev-stack', `reclaimed ${label} (pid ${pid}) with SIGKILL`)
  } catch {
    /* already gone */
  }
}

/**
 * Signal a whole process GROUP. Children are spawned detached, so each leads a
 * group whose id equals its pid; `process.kill(-pid, sig)` reaches the real
 * server as well as any shell/wrapper in between. ESRCH means the group is
 * already gone — that is success, not an error.
 *
 * @returns {boolean} true if the signal was delivered
 */
function signalGroup(pid, sig) {
  try {
    process.kill(-pid, sig)
    return true
  } catch (error) {
    if (error && error.code === 'ESRCH') return false
    // EPERM or a non-leader pid: fall back to the single process.
    try {
      process.kill(pid, sig)
      return true
    } catch {
      return false
    }
  }
}

/** Is any member of the group still alive? */
function isGroupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error && error.code === 'EPERM') return true
    return false
  }
}

/** SIGTERM -> grace -> SIGKILL, applied at GROUP level so nothing is orphaned. */
async function killGroup(pid, label) {
  if (!signalGroup(pid, 'SIGTERM')) return
  const deadline = Date.now() + SHUTDOWN_GRACE_MS
  while (Date.now() < deadline) {
    if (!isGroupAlive(pid)) {
      log('dev-stack', `stopped ${label} (group ${pid}) with SIGTERM`)
      return
    }
    await sleep(100)
  }
  if (signalGroup(pid, 'SIGKILL')) {
    log('dev-stack', `stopped ${label} (group ${pid}) with SIGKILL`)
  }
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

/**
 * Free :3000 and :2024 — but only of processes belonging to this repo.
 * A foreign listener throws, aborting the whole run.
 */
async function preflight() {
  for (const port of [NEXT_PORT, LANGGRAPH_PORT]) {
    for (const pid of await listenerPids(port)) {
      const cwd = await processCwd(pid)
      const command = await processCommand(pid)
      // Both proofs, same rule as the orphan scan: inside the repo AND a dev
      // server. Anything else on our port is a refusal, never a kill.
      if (!isReclaimableProcess(cwd, command, REPO_ROOT)) {
        throw new Error(
          `port ${port} is held by pid ${pid} we must not kill ` +
            `(cwd: ${cwd ?? 'unresolved'}, command: ${summarizeCommand(command)}).\n` +
            `  Refusing to kill it. Stop that process yourself, or free port ${port}, then retry.`,
        )
      }
      log('dev-stack', `port ${port} held by our own dev server pid ${pid} (${cwd}) — reclaiming`)
      await killPid(pid, `listener on :${port}`)
    }
  }

  for (const { pid, command } of await sameRepoOrphans()) {
    log('dev-stack', `orphan dev server from this repo (pid ${pid}, PPID=1): ${command} — reclaiming`)
    await killPid(pid, 'orphan')
  }
}

/**
 * Same-repo dev servers reparented to init (PPID=1) — the 102%-CPU runaway class.
 *
 * TWO independent proofs are required before a pid is returned: its cwd is
 * inside this repo AND its command is recognisably one of our dev servers. cwd
 * alone is never sufficient — an editor/LSP server, a detached watcher, or a
 * Claude Code session all run with their cwd inside this repo and must survive.
 *
 * @returns {Promise<Array<{pid: number, command: string}>>}
 */
async function sameRepoOrphans() {
  /** @type {Array<{pid: number, command: string}>} */
  const found = []
  try {
    const { stdout } = await execFileAsync('ps', ['-Ao', 'pid=,ppid=,command='], {
      maxBuffer: 8 * 1024 * 1024,
    })
    for (const { pid, ppid, command } of parsePsRecords(stdout)) {
      if (ppid !== 1) continue
      if (pid === process.pid) continue
      // Cheap identity test first: it rejects almost every candidate without
      // paying for an lsof call.
      if (!isDevServerCommand(command)) continue
      const cwd = await processCwd(pid)
      if (isReclaimableProcess(cwd, command, REPO_ROOT)) found.push({ pid, command })
    }
  } catch (error) {
    log('dev-stack', `orphan scan skipped: ${error.message}`)
  }
  return found
}

/** Any HTTP answer proves the server is up — 4xx included. */
async function answersHttp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
    return response.status >= 200 && response.status < 500
  } catch {
    return false
  }
}

/**
 * LangGraph readiness — liveness is NOT enough.
 *
 * A LangGraph server that answers /ok but has lost its graph is the same false
 * green this mission exists to kill, so the supervisor holds the same bar as
 * `npm run health`: the `agent_builder` graph must be registered. Reads the
 * assistant registry only (POST /assistants/search) — no thread, no run, ZERO
 * BILLED TOKENS.
 */
async function langgraphReady() {
  try {
    const live = await fetch(`${LANGGRAPH_BASE_URL}/ok`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    if (!(live.status >= 200 && live.status < 400)) return false
  } catch {
    return false
  }

  const headers = { 'Content-Type': 'application/json' }
  const secret = process.env.LANGGRAPH_SERVER_SECRET?.trim()
  if (secret) headers['x-agent-key'] = secret

  try {
    const res = await fetch(`${LANGGRAPH_BASE_URL}/assistants/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ graph_id: GRAPH_ID, limit: 1, offset: 0 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    })
    if (!(res.status >= 200 && res.status < 400)) return false
    return graphIsRegistered(await res.json(), GRAPH_ID)
  } catch {
    return false
  }
}

/**
 * Poll `probe` until it proves readiness, the child dies, or the budget runs out.
 *
 * @param {string} service
 * @param {string} description  what readiness means, for the log line
 * @param {() => Promise<boolean>} probe
 * @param {number} timeoutMs
 * @param {() => boolean} isDead
 */
async function waitForReady(service, description, probe, timeoutMs, isDead) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isDead()) return false
    if (await probe()) {
      log('dev-stack', `${service} is ready (${description})`)
      return true
    }
    await sleep(READY_POLL_INTERVAL_MS)
  }
  log('dev-stack', `${service} did not satisfy readiness (${description}) within ${timeoutMs}ms`)
  return false
}

async function main() {
  openLogs()
  log('dev-stack', `repo root: ${REPO_ROOT}`)

  try {
    await preflight()
  } catch (error) {
    log('dev-stack', `PRE-FLIGHT ABORT — ${error.message}`)
    recordExit('dev-stack', 1, null, `preflight abort: ${error.message}`)
    process.exit(1)
  }

  /** @type {Map<string, import('node:child_process').ChildProcess>} */
  const children = new Map()
  /** @type {Set<string>} */
  const exited = new Set()
  let shuttingDown = false

  /**
   * Spawn a local binary DIRECTLY — never through `npx`.
   *
   * `npx` is a wrapper: the supervisor would hold the wrapper's pid while the
   * real server ran as its child. Killing the wrapper left the server alive,
   * reparented to PPID 1 — this script would have manufactured the exact
   * runaway orphan the mission eliminates, and linked lifetime would silently
   * break (reproduced: wrapper 35522 killed, server 35632 survived, ppid 1).
   *
   * `detached: true` makes each child a process-group leader, so one
   * `process.kill(-pid, sig)` reaches the server and everything it forked.
   *
   * TRADEOFF: a detached child survives a SIGKILL of the supervisor (a kill -9
   * of the parent leaves no chance to clean up). That residue is precisely what
   * the pre-flight cleanup above reclaims on the next start.
   */
  function spawnChild(service, bin, args) {
    if (!existsSync(bin)) {
      throw new Error(
        `${service} binary not found at ${bin}.\n` +
          `  Run \`npm install\` in ${REPO_ROOT} first — refusing to fall back to a PATH lookup.`,
      )
    }
    return spawn(bin, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: true,
    })
  }

  function attach(service, child) {
    children.set(service, child)
    log('dev-stack', `${service} spawned (pid ${child.pid}, own process group)`)
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        for (const line of formatLogChunk(service, chunk)) {
          process.stdout.write(line + '\n')
          logStreams?.[service]?.write(line + '\n')
        }
      })
    }
    /** Both paths out of a child converge here — one death, one shutdown. */
    function onChildGone(service_, code, signal, reason) {
      exited.add(service_)
      log('dev-stack', reason)
      if (shuttingDown) return
      // LINKED LIFETIME: Next must never survive LangGraph, and vice versa.
      shuttingDown = true
      recordExit(service_, code, signal, reason)
      log('dev-stack', `terminating the rest of the stack because ${service_} died`)
      void terminateAll().then(() => process.exit(typeof code === 'number' && code !== 0 ? code : 1))
    }

    child.on('exit', (code, signal) => {
      onChildGone(service, code, signal, formatExitReason(service, code, signal))
    })
    // A spawn failure (ENOENT, EACCES) emits 'error', never 'exit'. Unhandled,
    // it throws out of the event loop and kills the supervisor while the
    // sibling keeps serving — the half-dead stack again. Route it to the same
    // shutdown path.
    child.on('error', (error) => {
      onChildGone(service, 1, null, `${service} failed to start: ${error.message}`)
    })
  }

  /**
   * Tear down every child's process GROUP — including the group of a service
   * that has already exited.
   *
   * Skipping an exited service is the intuitive thing to do and it is wrong: a
   * group leader dying does NOT kill its group. When langgraph's leader was
   * SIGKILLed during smoke testing, `next` was correctly torn down but two
   * langgraph grandchildren survived, were reparented to PPID 1, and one kept
   * holding :2024 — manufacturing the runaway orphan this supervisor exists to
   * eliminate. So we sweep every group we own, dead leader or not; killGroup
   * treats an already-empty group as a no-op (ESRCH).
   */
  async function terminateAll() {
    await Promise.all(
      [...children.entries()].map(async ([service, child]) => {
        if (child.pid == null) return
        await killGroup(child.pid, service)
      }),
    )
  }

  // Handlers FIRST: registering them after the spawns leaves a window in which
  // Ctrl-C kills the supervisor and leaves both children running.
  let signalCount = 0
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      signalCount += 1
      if (signalCount > 1) {
        log('dev-stack', `${signal} again — forcing exit`)
        for (const child of children.values()) {
          if (child.pid != null) signalGroup(child.pid, 'SIGKILL')
        }
        process.exit(130)
      }
      shuttingDown = true
      log('dev-stack', `${signal} received — shutting the stack down`)
      recordExit('dev-stack', null, signal, `supervisor received ${signal}`)
      void terminateAll().then(() => process.exit(0))
    })
  }

  // Last-resort net: any uncaught throw in the supervisor must still take the
  // children with it, otherwise the crash leaves two unsupervised servers.
  process.on('uncaughtException', (error) => {
    const reason = `supervisor crashed: ${error?.message ?? error}`
    log('dev-stack', reason)
    if (shuttingDown) return
    shuttingDown = true
    recordExit('dev-stack', 1, null, reason)
    void terminateAll().then(() => process.exit(1))
  })

  try {
    attach('next', spawnChild('next', NEXT_BIN, ['dev', '--port', String(NEXT_PORT)]))
    attach(
      'langgraph',
      spawnChild('langgraph', LANGGRAPH_BIN, [
        'dev',
        '--no-browser',
        '--host',
        '127.0.0.1',
        '--port',
        String(LANGGRAPH_PORT),
        '--n-jobs-per-worker',
        '2',
      ]),
    )
  } catch (error) {
    log('dev-stack', `SPAWN ABORT — ${error.message}`)
    recordExit('dev-stack', 1, null, `spawn abort: ${error.message}`)
    shuttingDown = true
    await terminateAll()
    process.exit(1)
  }

  // Polled in parallel: the two boots overlap, so the budget is the max of the
  // two timeouts, not their sum.
  const [nextIsReady, langgraphIsReady] = await Promise.all([
    waitForReady('next', NEXT_URL, () => answersHttp(NEXT_URL), NEXT_READY_TIMEOUT_MS, () =>
      exited.has('next'),
    ),
    waitForReady(
      'langgraph',
      `graph ${GRAPH_ID} registered`,
      langgraphReady,
      LANGGRAPH_READY_TIMEOUT_MS,
      () => exited.has('langgraph'),
    ),
  ])

  if (!nextIsReady || !langgraphIsReady) {
    if (!shuttingDown) {
      shuttingDown = true
      const failed = !nextIsReady ? 'next' : 'langgraph'
      const reason = `${failed} never became ready — the stack is not usable, killing both`
      log('dev-stack', reason)
      recordExit(failed, null, null, reason)
      await terminateAll()
      process.exit(1)
    }
    return
  }

  log('dev-stack', `stack ready — next ${NEXT_URL} · langgraph ${LANGGRAPH_BASE_URL} (graph ${GRAPH_ID})`)
}

const invokedDirectly = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  void main()
}
