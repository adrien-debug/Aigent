# Deploying the LangGraph.js Agent Server (Aigent) on gpu1

Production deployment of the `agent_builder` graph as a **two-container**
Docker Compose stack on **gpu1**, with checkpointing that **survives a
container restart** (runs paused for human approval must not be lost).

This directory contains:

| File | Purpose |
|------|---------|
| `Dockerfile` | Production image — runs the free `langgraphjs dev` server in a container. |
| `Caddyfile` | Front-proxy config — hard-denies `/internal/*`, forwards everything else to `agent-server`. |
| `docker-compose.yml` | Two-service compose (`agent-server` + `caddy`) with env, port, volume, `restart: always`. |
| `README.md` | This file — exact build/run commands + how persistence works. |

---

## Architecture — two containers, one exposed

```
Cloudflare tunnel ──▶ 127.0.0.1:8098 ──▶ [caddy] ──▶ (nexus-net) ──▶ [agent-server:2024]
                                            │
                                            └── DENIES /internal/* (403), proxies everything else
```

- **`agent-server`** — the free `langgraphjs dev` server. **Not published to
  the host** (no `ports:`, only `expose: "2024"`) — it is reachable **only**
  from other containers on the `nexus-net` network, i.e. only from `caddy`.
- **`caddy`** — a front proxy and **the only container published to the
  host**, on `127.0.0.1:8098`. It hard-denies `/internal/*` and proxies
  everything else through to `agent-server:2024`. This is what the Cloudflare
  tunnel points at.

### Why the Caddy sidecar exists

The `langgraphjs dev` server mounts a set of `/internal/*` admin routes —
notably **`/internal/truncate`, which wipes all threads/runs/checkpoints** —
and these routes are **not covered by the server's auth gate**
(`LANGGRAPH_SERVER_SECRET` / `src/langgraph/auth.mjs`). If `agent-server`
were exposed directly, `/internal/truncate` would be a public,
unauthenticated data-wipe endpoint. The Caddy sidecar exists specifically to
block that surface **at the edge**, before it ever reaches the server: it
denies `/internal/*` outright and only forwards the rest. Auth
(`LANGGRAPH_SERVER_SECRET`) and the Caddy `/internal/*` block are two
separate, complementary layers — never rely on one to cover for the other.

---

## What is actually deployed

We run the **free `langgraphjs dev` server** in a container — **not** the
licensed `langchain/langgraphjs-api` image (which requires a paid LangSmith
license + Redis + Postgres). See the Dockerfile:

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
VOLUME ["/app/.langgraph_api"]
EXPOSE 2024
CMD ["npx", "langgraphjs", "dev", "--no-browser", "--host", "0.0.0.0", "--port", "2024"]
```

- **Base image:** `node:22-slim` — plain Node, no LangGraph Platform image.
- **Graph load:** whole repo copied to `/app`; graph registered via
  `langgraph.json`'s `graphs` key (`agent_builder`).
- **Internal port: `2024`** (the `langgraphjs dev` default). `agent-server`
  has **no host port mapping** — it is only `expose`d on the `nexus-net`
  network. The public port, **`127.0.0.1:8098` on gpu1, is mapped on the
  `caddy` service**, not on `agent-server` — see `docker-compose.yml`'s
  `caddy.ports: 127.0.0.1:8098:8098` and the Architecture section above.
- **Checkpoint/state dir: `/app/.langgraph_api`** — the dev server's
  in-memory-but-file-backed checkpointer persists threads/runs/assistants
  here. A named Docker volume is mounted over this path (see below) so it
  **survives a container restart**.

### How persistence actually works

The `langgraphjs dev` server's checkpointer is `InMemorySaver` **persisted to
a JSON file on disk** — `/app/.langgraph_api/.langgraphjs_api.checkpointer.json`.
Threads, runs and assistants are likewise stored as files under
`.langgraph_api/`. There is no Postgres/Redis involved.

**Consequence:** to make paused runs survive a restart, mount a **persistent
volume** over `/app/.langgraph_api`. That is exactly what the `Dockerfile`
(`VOLUME`) and `docker-compose.yml` (named volume
`aigent_langgraph_state → /app/.langgraph_api`) do. **This is the supported,
working persistence path for this deployment.**

> **Note — the official prod-HA path is different and unused here.** LangGraph
> Platform ships a **licensed self-hosted server** (what `langgraphjs up`
> pulls & runs via its own generated compose) that backs checkpoints/threads
> with **Postgres + Redis** (`POSTGRES_URI` / `REDIS_URI`) and **requires a
> license key** (`LANGGRAPH_CLOUD_LICENSE_KEY`). We deliberately do **not**
> use it: no license, no Redis, no Postgres — just the containerized dev
> server + a persistent volume, which already satisfies the actual
> requirement ("survive a container restart"). If cross-restart durability
> must someday live in the shared `aigent` Postgres instead of a Docker
> volume, that means either switching to the licensed image + a license key,
> or wiring a custom graph-level Postgres checkpointer inside
> `src/langgraph/*` (a code change, out of scope for this deploy folder).

---

## Auth: fail-closed, wired via `langgraph.json`, plus the Caddy `/internal/*` block

Root `langgraph.json`'s `"auth"` key wires the gate directly:

```json
{
  "auth": { "path": "./src/langgraph/auth.mjs:auth" }
}
```

`langgraphjs` (both the local `npm run dev` server and this container — same
`langgraph.json`, no separate env var needed to activate it) reads that key
and installs `src/langgraph/auth.mjs` as a **fail-closed** shared-secret gate
(header `x-agent-key`, env `LANGGRAPH_SERVER_SECRET`). **Without
`LANGGRAPH_SERVER_SECRET` set, every request 503s** — by design, this can
never run as an unauthenticated public deployment. Set the same secret value
on the app side (`x-agent-key` sender) and the server side
(`docker-compose.yml`'s `agent-server.environment.LANGGRAPH_SERVER_SECRET`).

**This auth gate does NOT cover `/internal/*`.** Those routes (see
"Architecture" above) are admin/debug routes the `langgraphjs dev` server
mounts unauthenticated by design — `src/langgraph/auth.mjs` never sees them.
That is why the **Caddy front proxy** exists as a second, independent layer:
it denies `/internal/*` outright at the edge, regardless of auth state. Do
not treat `LANGGRAPH_SERVER_SECRET` as covering `/internal/*` — it does not;
only Caddy does.

---

## Deploy on gpu1

### Prerequisites
- Docker on gpu1 (the target host).
- The Aigent repo checked out on gpu1 (build context = repo root).
- Secret values (never commit them) — see the env table below.

### Secrets — where each value comes from

| Env var | Required? | Source |
|---------|-----------|--------|
| `LANGGRAPH_SERVER_SECRET` | **Yes** | Shared secret the Aigent app sends as `x-agent-key`. Must match the app's `LANGGRAPH_SERVER_SECRET`. Generate once (e.g. `openssl rand -hex 32`) and set it in BOTH the app env and here. |
| `OPENAI_API_KEY` | **Yes** | `~/.claude/api-config/SERVICES.md` (`OPENAI_API_KEY`), or the app's `.env.local`. |
| `AMC_SUPABASE_URL` | **Yes** | The app's `.env.local` (`AMC_SUPABASE_URL`) — Supabase/PostgREST base used by the graph tools. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | `~/.claude/api-config/SERVICES.md` / app `.env.local`. Service-role key — server-side only. |
| `AGENT_BUILDER_MODEL` | No (default `gpt-5.4`) | Model override for the graph. |
| `AMC_DATA_SOURCE` | No (default `gpu1`) | Matches the app's data-source switch. |
| `LANGSMITH_API_KEY` | Optional | Tracing. Absent → no-op. |

Put them in a `deploy/langgraph/.env` on gpu1 (git-ignored) or export in the shell.

### Deploy — docker compose (the only supported path)

From the **repo root** on gpu1:

```bash
# 1) create deploy/langgraph/.env with the secrets (git-ignored), e.g.:
#    LANGGRAPH_SERVER_SECRET=...
#    OPENAI_API_KEY=...
#    AMC_SUPABASE_URL=...
#    SUPABASE_SERVICE_ROLE_KEY=...

# 2) build + run BOTH containers (agent-server + caddy)
docker compose -f deploy/langgraph/docker-compose.yml --env-file deploy/langgraph/.env up -d --build

# 3) logs
docker logs -f aigent-langgraph          # agent-server
docker logs -f aigent-langgraph-caddy    # caddy front proxy
```

> **Do NOT run `agent-server` standalone with `docker run ... -p 8098:2024`
> (or any host port mapping straight onto the server).** That was a
> previously-documented "Option B" here and it is **dangerous**: it exposes
> the server's `/internal/*` routes — including `/internal/truncate`, which
> **wipes all data** — directly to the host/tunnel with **no auth and no
> Caddy in front of it**. Always deploy with `docker compose up -d`, which
> brings up `caddy` alongside `agent-server` and keeps `/internal/*` blocked.
> `agent-server`'s `docker-compose.yml` service intentionally has **no
> `ports:`** for this reason — only `caddy` is published.

> `-v aigent_langgraph_state:/app/.langgraph_api` (already wired in
> `docker-compose.yml`) is what makes paused runs survive a restart. Never
> remove that volume — every checkpoint would be lost.

---

## Verify it works

```bash
# 1) Liveness (no auth needed on /ok)
curl -sf http://localhost:8098/ok && echo "  <- server up"

# 2) Auth gate is active: a request WITHOUT the secret must be rejected.
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8098/assistants/search \
  -X POST -H 'content-type: application/json' -d '{}'
#   → 401 (missing key) or 503 (LANGGRAPH_SERVER_SECRET not set). Never 200.

# 3) Authenticated call succeeds:
curl -s http://localhost:8098/assistants/search \
  -X POST -H 'content-type: application/json' \
  -H "x-agent-key: $LANGGRAPH_SERVER_SECRET" -d '{}' | head -c 400

# 4) /internal/* must be blocked by Caddy (data-wipe protection):
curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8098/internal/truncate -d '{}'   # expect 403
```

### Verify checkpoint persistence (the actual requirement)

Because this image checkpoints to **files on a volume** (not Postgres tables):

```bash
# The state files live on the named volume, mounted at .langgraph_api in-container:
docker exec aigent-langgraph sh -c 'ls -la /app/.langgraph_api'
#   → after the first run you should see .langgraphjs_api.checkpointer.json and
#     the threads/runs/assistants state files.

# Durability test: start a run that interrupts for approval, then:
docker restart aigent-langgraph
# Re-query the thread via the API (with x-agent-key) — the interrupted run and
# its pending checkpoint are still there. If you REMOVED the volume, they'd be gone.
```
