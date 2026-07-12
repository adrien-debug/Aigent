# Deploying Agent Mission Control (Next.js app) on gpu1

Production deployment of the Next.js app itself, as a single-container Docker
build using `output: "standalone"` (see `next.config.ts`).

This directory contains:

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build — `next build` (standalone output) then a minimal runtime image. |
| `docker-compose.yml` | Single-service compose (`app`) with env, port, healthcheck, `restart: always`. |
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
