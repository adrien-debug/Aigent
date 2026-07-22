# Dev runtime (AIG-STABILIZATION-004)

Two commands own the local development runtime. No feature code, no UI — this is
operator plumbing only.

## The two commands

```
npm run dev         # start Next (:3210) + LangGraph (:2024) as one supervised stack
npm run health      # one-shot report on what is actually up right now
```

`npm run dev` **is** the supervisor — the safe path is the one you reach by
habit. `npm run dev:stack` is an explicit alias for the same command, and
`npm run dev:clean` wipes `.next` then chains to it.

`npm run dev:legacy` is the old, **unsupervised** `concurrently` line, kept only
as a fallback. It is the command with the defect described below; prefer `dev`.

Both `dev` and `health` load `.env.local` through `node --env-file`, like every
other node entry in `package.json`.

- **the supervisor** guarantees the stack is *all-or-nothing*: the two children live
  and die together. If either one exits, the supervisor takes the whole stack
  down instead of leaving a half-dead runtime behind.
- **`health`** guarantees an *observed* verdict, not an assumed one: it probes the
  services and reports `HEALTHY` or `UNHEALTHY` per service, and `HEALTHY` or
  `DEGRADED` for the stack. It starts nothing and kills nothing.

## The failure mode being fixed

`npm run dev:legacy` (`concurrently -k --kill-others-on-fail`) — which was the
`npm run dev` of record until this change — let the stack rot silently:

1. **LangGraph died, Next kept serving.** LangGraph exited on SIGTERM (code 143)
   while `next dev` carried on answering `200` on `/admin`. The dashboard looked
   perfectly healthy while *every agent run was broken* — the exact class of
   false-green this repo forbids elsewhere.
2. **Runaway orphans.** A detached dev server (PPID=1, cwd = this repo) burned
   102 % CPU for 11 hours holding port `3003` and answered HTTP `000`. Nothing
   noticed, and nothing reclaimed the port.

A `200` on `/admin` is therefore *not* evidence the stack works. `npm run health`
is.

The measured root cause in the logs was worse than a lone crash: Next was killed
externally and then **relaunched alone** as a bare `next dev`, with no LangGraph
at all. That is why `dev` itself now points at the supervisor — a safe path
nobody types is not a fix.

## Behaviour of the supervisor (`npm run dev`)

- **Child death** — if Next or LangGraph exits (any code, any signal), the
  supervisor tears the other one down and exits non-zero. There is no state where
  one half keeps serving alone.
- **SIGINT / SIGTERM** — the supervisor does not relay the signal it received;
  it sends `SIGTERM` to each child's whole **process group**, waits out the grace
  period, then escalates to `SIGKILL` on anything still alive. Pressing Ctrl-C a
  second time skips the wait and kills both groups immediately. Groups, not bare
  pids: a dev server forks workers, and signalling only the leader leaves those
  workers running and reparented to PID 1 — that is how the runaway orphan below
  was born.
- **Port already held** — the pre-flight resolves each listener's `cwd` *and* its
  command (via `lsof` + `ps`) before doing anything, then splits two ways:
  - **Not positively ours** — the run **aborts**, nothing is killed. This covers
    a `cwd` outside this repo, an unresolvable `cwd`, *and* a process inside this
    repo whose command is not recognisably one of our dev servers. The abort
    message names the port, the pid, the `cwd` and the program (argv is truncated
    to the leading token — a foreign command line can carry credentials). This
    machine runs many dev servers from *other* projects (Netpool `:4303`,
    TradeAgent `:3102`, Kyc, Alcaraz Fashion, dropship), and this repo also hosts
    editors, LSP servers and Claude Code sessions; killing on location alone
    would take down someone else's work.
  - **Positively ours** (`cwd` inside this repo **and** the command matches
    `next-server` / `next dev` / `langgraphjs` / `langgraph dev`) — the port **is
    reclaimed**: `SIGTERM` first, then `SIGKILL` if the process is still alive
    after the grace period (`DEV_STACK_SHUTDOWN_GRACE_MS`, 5 s by default). Each
    reclaim is logged with the pid and the port.

  Both proofs are required, never either one alone. The same two-proof rule
  governs the startup sweep for `PPID=1` orphans left by an earlier crash.

  Ownership is decided by segment-aware path comparison, so a sibling directory
  with a shared textual prefix (`…/Aigent-old` vs `…/Aigent`) is *not* treated as
  inside the repo.

- **Orphan sweep** — after the port pass, the pre-flight scans for processes
  reparented to init (`PPID=1`), the runaway class from failure mode 2. A process
  is killed (same SIGTERM → SIGKILL sequence) only when **both** hold: its `cwd`
  is inside this repo **and** its command matches a dev server this repo starts.
  Either condition alone is not enough — a `PPID=1` process merely sitting in the
  repo directory is left alone. If the scan itself fails, it is logged and
  skipped; it never aborts the run.

## Logs and `last-exit.json`

Everything the stack writes lands in `.runtime/` at the repo root, git-ignored
(see `.gitignore`) and safe to `rm -rf`:

- per-child stdout/stderr logs, so a crash that scrolled off the terminal is
  still readable afterwards;
- `last-exit.json` — the post-mortem of the previous run: which child died first,
  its exit code and signal, and when. This is what turns "it stopped working at
  some point" into a fact. Read it before re-running the stack.

## Reading a DEGRADED report

`npm run health` prints one aligned line per service — `NEXT`, `LANGGRAPH`,
`POSTGREST` — then a final `STACK` line carrying the verdict:

```
NEXT        HEALTHY    200  84ms
LANGGRAPH   UNHEALTHY  liveness /ok unreachable (connection refused)
POSTGREST   HEALTHY    61ms
STACK       DEGRADED
```

- Per service the status word is **`HEALTHY`** or **`UNHEALTHY`** (never `OK`).
- For `STACK` it is **`HEALTHY`** or **`DEGRADED`** — `DEGRADED` as soon as any
  one service is unhealthy, and also when nothing was checked at all: checking
  nothing must never read as green.
- The right-hand column is the observed detail: the HTTP status and latency, or
  the failure reason (`timed out`, `unreachable (…)`, `no response`, an HTTP
  status, `env missing: …`, or `alive but graph agent_builder absent`).
- **No port is ever printed**, and neither the PostgREST URL nor its key appears
  in any line, including failure reasons — a credential-bearing URL is a secret.

The `LANGGRAPH` check does not stop at liveness: after `GET /ok` it asserts the
`agent_builder` graph is actually registered (`POST /assistants/search`, the
read-only call — no thread, no run, zero billed tokens). A server that outlived
its graph reports `UNHEALTHY  alive but graph agent_builder absent`.

`STACK DEGRADED` with `NEXT HEALTHY` and `LANGGRAPH UNHEALTHY` is precisely the
false-green scenario above: the UI will load, agent runs will not work. Do not
treat the dashboard rendering as a counter-argument.

The exit code is `0` only when every service is `HEALTHY`, and `1` otherwise, so
`health` can gate a script. `npm run health -- --json` emits the same verdict as
a machine-readable object instead of the table.
