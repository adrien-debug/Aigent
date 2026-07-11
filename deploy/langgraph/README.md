# Deploying the LangGraph.js Agent Server (Aigent) on gpu1

Production deployment of the `agent_builder` graph as a standalone Docker
container on **gpu1**, with checkpointing that **survives a container restart**
(runs paused for human approval must not be lost).

This directory contains:

| File | Purpose |
|------|---------|
| `Dockerfile` | Production image (the `langgraphjs dockerfile` output, adapted). |
| `docker-compose.yml` | One-service compose with env, port, volume, `restart: always`. |
| `README.md` | This file — exact build/run commands + how persistence works. |

---

## ⚠️ How persistence ACTUALLY works (read before deploying)

The investigation into the `langgraphjs` CLI turned up a fact that contradicts
the usual "point it at Postgres" assumption. **There are two different servers**,
and only one of them uses Postgres:

### Two servers

1. **OSS image `langchain/langgraphjs-api` — what `langgraphjs build` / `langgraphjs dockerfile` produce (this is what the Dockerfile here uses).**
   Package: `@langchain/langgraph-api` v1.4.2 (verified in `node_modules`).
   - Its checkpointer is `InMemorySaver` **persisted to a JSON file on disk** —
     `<workdir>/.langgraph_api/.langgraphjs_api.checkpointer.json`. Threads,
     runs and assistants are likewise stored as files under `.langgraph_api/`.
   - There is **no `postgres`/`pg` import anywhere in that package's runtime.**
     It does **not** connect to Postgres. `POSTGRES_URI` / `REDIS_URI` are simply
     **ignored** by this image.
   - **Consequence:** to make paused runs survive a restart, mount a **persistent
     volume** over the workdir's `.langgraph_api/` directory. That is exactly what
     the `Dockerfile` (`VOLUME`) and `docker-compose.yml` (named volume
     `aigent_langgraph_state → /deps/Aigent/.langgraph_api`) do. **This is the
     supported, working persistence path for this deployment.**

2. **Licensed self-hosted server — what `langgraphjs up` pulls & runs via compose.**
   This is the image whose `docker-compose` wiring sets `REDIS_URI` +
   `POSTGRES_URI`, backs checkpoints/threads with **Postgres + Redis**, and on
   boot **creates its own checkpoint tables** in the database. It additionally
   **requires a license key**: `langgraphjs up` prints
   *"For production use, requires a license key in env var
   `LANGGRAPH_CLOUD_LICENSE_KEY`."* Without that key + the licensed image, you do
   **not** get the Postgres-backed server.

### The exact env-var answer

- The variable the **Postgres-backed (licensed) server** reads is **`POSTGRES_URI`**
  (plus `REDIS_URI` for Redis) — this is what `langgraphjs`'s own compose sets on
  the `langgraph-api` service, and what `langgraphjs up --postgres-uri` feeds.
- **`DATABASE_URI` is NOT what the self-hosted server reads.** It appears only in
  the CLI's `RESERVED_ENV_VARS` list (secret-filtering for LangSmith **Cloud**
  deploys), never as a runtime connection var for the container. The prompt's
  hypothesis that the server wants `DATABASE_URI` is **incorrect** — it's
  `POSTGRES_URI`.
- The Postgres URI format (only needed for path #2) is:
  `postgresql://<user>:<password>@host.docker.internal:5432/aigent`
  (`host.docker.internal` = the gpu1 host, where `nexus-postgres` listens on
  `127.0.0.1:5432`). The compose file wires this from `${POSTGRES_URI}` /
  `${PGUSER}` / `${PGPASSWORD}` — **no secret is hardcoded**.

### Which path should Aigent use?

**Default: path #1 (this Dockerfile) + the persistent volume.** It needs no
license, no Redis, no Postgres — just the volume — and it satisfies the actual
requirement ("survive a container restart"). The `POSTGRES_URI` env is still
wired in compose so that *if* a licensed image is later swapped in, the DB is
ready; it is harmlessly ignored by the OSS image.

> If cross-restart durability must live in the shared `aigent` Postgres (not a
> Docker volume), that requires the **licensed** server (path #2) + a license
> key, OR a custom graph-level Postgres checkpointer wired inside
> `src/langgraph/*` (code change, out of scope for this deploy folder).

---

## What the generated Dockerfile contains

`langgraphjs dockerfile` for this repo emits (verbatim core):

```dockerfile
FROM langchain/langgraphjs-api:20
ADD . /deps/Aigent
ENV LANGSERVE_GRAPHS='{"agent_builder":"./src/langgraph/agent-builder-graph.mjs:graph"}'
WORKDIR /deps/Aigent
RUN npm ci
RUN (test ! -f /api/langgraph_api/js/build.mts && echo "Prebuild script not found, skipping") || tsx /api/langgraph_api/js/build.mts
```

- **Base image:** `langchain/langgraphjs-api:20` (tag = `node_version` from
  `langgraph.json`).
- **Graph load:** whole repo copied to `/deps/Aigent`; graph registered via
  `LANGSERVE_GRAPHS` from `langgraph.json`'s `graphs`.
- **Internal port: `8000`** (fixed in the base image; `--port` only remaps the
  host side). We publish it as **8098** on gpu1.
- **DB wait:** none in the OSS image (it doesn't use a DB). The licensed compose
  path adds `depends_on: postgres/redis (service_healthy)`.

**Our `Dockerfile` adds two things the raw generation omits:**
1. `ENV LANGGRAPH_AUTH='{"path":"./src/langgraph/auth.mjs:auth"}'` — activates the
   repo's fail-closed shared-secret gate (see gap note below).
2. `VOLUME ["/deps/Aigent/.langgraph_api"]` + `EXPOSE 8000` — the persistence
   mount point and the documented port.

### 🔴 Gap found & fixed: auth was not wired

`src/langgraph/auth.mjs` implements a **fail-closed** shared-secret gate
(`LANGGRAPH_SERVER_SECRET`, header `x-agent-key`), but the root
`langgraph.json` has **no `auth` key**, so a plain `langgraphjs build` would ship
a **public, unauthenticated** Agent Server. The `Dockerfile` here sets
`LANGGRAPH_AUTH` explicitly to close that hole. **You must supply
`LANGGRAPH_SERVER_SECRET`** at runtime or every request is rejected with 503 (by
design).

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
| `AMC_DATA_SOURCE` | No (default `gpu1`) | Matches the app's data-source switch. |
| `POSTGRES_URI` | Only path #2 | `postgresql://<user>:<pass>@host.docker.internal:5432/aigent`. Creds = the gpu1 `nexus-postgres` credentials (in the gpu1 env / infra notes). **Ignored by the OSS image.** |
| `LANGGRAPH_CLOUD_LICENSE_KEY` | Only path #2 | LangGraph Platform license. Absent → OSS/file-checkpoint path. |
| `LANGSMITH_API_KEY` | Optional | Tracing. Absent → no-op. |

Put them in a `deploy/langgraph/.env` on gpu1 (git-ignored) or export in the shell.

### Option A — docker compose (recommended)

From the **repo root** on gpu1:

```bash
# 1) create deploy/langgraph/.env with the secrets (git-ignored), e.g.:
#    LANGGRAPH_SERVER_SECRET=...
#    OPENAI_API_KEY=...
#    AMC_SUPABASE_URL=...
#    SUPABASE_SERVICE_ROLE_KEY=...
#    # (optional, path #2) POSTGRES_URI / PGUSER / PGPASSWORD / LANGGRAPH_CLOUD_LICENSE_KEY

# 2) build + run
docker compose -f deploy/langgraph/docker-compose.yml --env-file deploy/langgraph/.env up -d --build

# 3) logs
docker logs -f aigent-langgraph
```

### Option B — plain docker build + run

From the **repo root** on gpu1:

```bash
# Build (context = repo root, so langgraph.json + src/langgraph are included)
docker build -f deploy/langgraph/Dockerfile -t aigent-langgraph:local .

# Run — internal 8000 published as 8098, state on a named volume, restart:always
docker run -d \
  --name aigent-langgraph \
  --restart always \
  -p 8098:8000 \
  --add-host host.docker.internal:host-gateway \
  -v aigent_langgraph_state:/deps/Aigent/.langgraph_api \
  -e LANGGRAPH_SERVER_SECRET="$LANGGRAPH_SERVER_SECRET" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e AMC_SUPABASE_URL="$AMC_SUPABASE_URL" \
  -e SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  -e AMC_DATA_SOURCE=gpu1 \
  -e POSTGRES_URI="postgresql://<user>:<pass>@host.docker.internal:5432/aigent" \
  aigent-langgraph:local
```

> `-v aigent_langgraph_state:/deps/Aigent/.langgraph_api` is the line that makes
> paused runs survive `docker restart` / `docker stop && docker run`. Drop it and
> every checkpoint is lost on restart.

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
```

### Verify checkpoint persistence (the actual requirement)

Because this image checkpoints to **files on a volume** (not Postgres tables):

```bash
# The state files live on the named volume, mounted at .langgraph_api in-container:
docker exec aigent-langgraph sh -c 'ls -la /deps/Aigent/.langgraph_api'
#   → after the first run you should see .langgraphjs_api.checkpointer.json and
#     the threads/runs/assistants state files.

# Durability test: start a run that interrupts for approval, then:
docker restart aigent-langgraph
# Re-query the thread via the API (with x-agent-key) — the interrupted run and
# its pending checkpoint are still there. If you REMOVED the volume, they'd be gone.
```

> **If you chose path #2 (licensed image + `POSTGRES_URI` + license key)**,
> verify Postgres instead: after boot, the server creates its checkpoint tables
> in the `aigent` DB — `psql "$POSTGRES_URI" -c '\dt'` should list
> checkpoint/thread tables, and paused runs survive a restart via Postgres rather
> than the volume.
