# Deploying Agent Mission Control (Next.js app) on gpu1

Production deployment of the Next.js app itself, as a single-container Docker
build using `output: "standalone"` (see `next.config.ts`).

This directory contains:

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build — `next build` (standalone output) then a minimal runtime image. |
| `docker-compose.yml` | **Two services**: `app` (env, port, healthcheck, `restart: always`) and `reprovision` (see below). |
| `README.md` | This file. |

---

## Build + run

From the **repo root** on gpu1 (build context must be the repo root — the
Dockerfile needs `package.json`, `src/`, `public/`, `next.config.ts` at the
top level):

```bash
docker compose -f deploy/app/docker-compose.yml --env-file deploy/app/.env up -d --build
```

## Secrets

Put them in a `deploy/app/.env` next to the compose file (**git-ignored** —
never commit it). See `.env.example` at the repo root for what each var does;
values themselves live in `~/.claude/api-config/SERVICES.md` or the app's own
`.env.local` on gpu1.

Required (compose fails fast with `${VAR:?...}` if missing): `AMC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `AMC_SESSION_SECRET`,
`LANGGRAPH_SERVER_SECRET`.

Optional (default or empty is fine): `AMC_DATA_SOURCE`, `GEMINI_API_KEY`,
`AMC_ALLOW_MODEL_FALLBACKS`, `AMC_ADMIN_PASSWORD` / `AMC_ADMIN_PASSWORD_HASH`,
`AMC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_PUSH_ENABLED`, `LANGGRAPH_API_URL`
(defaults to `https://agent.hearst.app`), `LANGSMITH_*`.

## Networking

```
Cloudflare tunnel (aigent.hearst.app) ──▶ 127.0.0.1:8099 ──▶ [app:3000]
                                                                  │
                                                                  └──▶ LANGGRAPH_API_URL (agent.hearst.app by default)
```

- The app listens on **`:3000`** inside the container.
- Published on the host at **`127.0.0.1:8099`** (loopback only) — the
  Cloudflare tunnel for `aigent.hearst.app` targets this port.
- Talks to the LangGraph agent server via `LANGGRAPH_API_URL` +
  `LANGGRAPH_SERVER_SECRET` (header `x-agent-key`) — see `deploy/langgraph/`
  for that server's own deployment. Defaults to the production server
  (`https://agent.hearst.app`); override to point at a different instance.
- Joined to `nexus-net` (external network) for parity with `deploy/langgraph/`
  and to reach any other gpu1 service (e.g. `aigent-caddy:8095`) internally
  if a future code path needs it.

## Verify it works

```bash
curl -sf http://127.0.0.1:8099/login && echo "  <- app up"
```

## The `reprovision` service — assistants are in-memory on the Agent Server

`docker-compose.yml` in this directory also brings up a second, long-running
service: `reprovision` (container `aigent-reprovision`). It runs `npm run
reprovision`'s underlying script once at boot, then repeats every
`REPROVISION_INTERVAL_SECONDS` (default 900s / 15 min) for as long as the
stack is up. Full explanation of WHY this exists (the Agent Server
(`deploy/langgraph`) forgets every provisioned assistant on restart, silently
degrading runs to a bare tool-less graph that hallucinates and still reports
`completed`) lives in `deploy/langgraph/README.md`, section "Assistants are
in-memory too — the traitorous failure mode" — read that before touching
either compose file.

Quick facts:
- Talks to the Agent Server **directly** over `nexus-net`
  (`http://aigent-langgraph:2024` by default, override via
  `LANGGRAPH_REPROVISION_URL`) rather than through the public tunnel, so it
  doesn't depend on Cloudflare being up.
- Best-effort: a failed pass does NOT crash the loop or block `app` (`app`
  does not `depends_on` it) — it logs loudly and retries next interval.
- Its own Docker healthcheck goes `unhealthy` once the last successful pass
  is older than 2× the interval — check `docker inspect aigent-reprovision
  --format '{{.State.Health.Status}}'` (or `docker compose ps`) after any
  deploy or Agent Server restart.
- Built from the SAME Dockerfile/context as `app`, targeting the `builder`
  stage (has `scripts/`, `src/`, full `node_modules`) instead of `runner`
  (pruned standalone output, no `scripts/`) — no extra build cost beyond the
  first build since the layers are shared.
