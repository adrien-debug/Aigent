# Deploying the Aigent data layer (PostgREST + Caddy) on gpu1

The reproducible source for Aigent's data layer: the **PostgREST** API over the
`aigent` database, fronted by a small **Caddy** reverse proxy that publishes it
on `:8095`. Before this directory existed, both containers were created by hand
with `docker run` and had no source — if they died, nobody could rebuild them.
This compose is now the definitive source.

This directory contains:

| File | Purpose |
|------|---------|
| `docker-compose.yml` | **Two services**: `postgrest` (the API over `aigent`) and `caddy` (reverse proxy on `:8095`). |
| `Caddyfile` | Caddy config — proxies everything (and `/rest/v1/*`) to `aigent-postgrest:3000`. |
| `.env.example` | Template for the two secrets. Copy to `.env`, fill in. |
| `README.md` | This file. |

---

## Build + run

From the **repo root** on gpu1:

```bash
docker compose -f deploy/db/docker-compose.yml --env-file deploy/db/.env up -d
```

Neither service builds an image — both pull upstream (`postgrest/postgrest`,
`caddy:2`), so there is no build context requirement.

## Secrets

Put them in a `deploy/db/.env` next to the compose file (**git-ignored** —
never commit it, `chmod 600`). Two values, both captured from the running
`aigent-postgrest` container:

| Var | What it is | Where it comes from |
|-----|-----------|---------------------|
| `PGRST_DB_PASSWORD` | Password of the `authenticator_aigent` role on `nexus-postgres`. | Baked into the current container's `PGRST_DB_URI`. |
| `JWT_SECRET` | JWT signing secret — **must equal the app's** (the token minted with `SUPABASE_SERVICE_ROLE_KEY` is verified against it). | The current container's `PGRST_JWT_SECRET`; same secret the app uses. |

Both use `${VAR:?}` in the compose, so it fails fast if either is missing.

## Networking

```
Cloudflare tunnel (aigent-db.hearst.app) ──▶ gpu1 :8095 ──▶ [caddy] ──▶ [postgrest:3000]
                                                                              │
                                                                              └──▶ nexus-postgres:5432 / db "aigent"
```

- Caddy publishes on the host at **`0.0.0.0:8095`** — the Cloudflare tunnel for
  `aigent-db.hearst.app` targets this port.
- PostgREST listens on **`:3000`** inside the container; only Caddy reaches it
  (both on `nexus-net`).
- PostgREST connects to the `aigent` database in the **shared cluster**
  `nexus-postgres` over `nexus-net` (external network), as the
  `authenticator_aigent` login role.
- The app (`deploy/app/`) talks to this layer via `AMC_SUPABASE_URL`
  (`https://aigent-db.hearst.app`) + `SUPABASE_SERVICE_ROLE_KEY`.

## Database isolation (why `authenticator_aigent` is the only role)

The `aigent` database shares the `nexus-postgres` cluster with 8 other project
databases. Postgres grants `CONNECT` to `PUBLIC` by default, and the Supabase
role pattern (`anon` / `authenticated` / `service_role`) is **cluster-wide** —
designed for one database per cluster, not multi-tenant. Left as-is, any other
project's login role could connect to `aigent`, `SET ROLE service_role`, and
read/write every table, bypassing RLS.

The fix (applied on `nexus-postgres`, as `postgres`) revokes that default and
re-grants CONNECT only to Aigent's own role:

```sql
REVOKE CONNECT ON DATABASE aigent FROM PUBLIC;
GRANT  CONNECT ON DATABASE aigent TO authenticator_aigent;
```

Verify only `authenticator_aigent` (+ `postgres`) can connect:

```bash
ssh gpu1 'docker exec nexus-postgres psql -U postgres -tAc "
SELECT rolname FROM pg_roles WHERE rolcanlogin
AND has_database_privilege(rolname, '"'"'aigent'"'"', '"'"'CONNECT'"'"') ORDER BY 1;"'
```

This does **not** touch the JWT secret or the app code — the shared roles stay
in place, they just become unreachable from outside the Aigent perimeter.

> Out of scope here (cluster-wide infra chantier): revoking `authenticator_aigent`'s
> CONNECT on the 8 **other** databases, and splitting the shared
> `anon`/`authenticated`/`service_role` roles per project.

## Verify it works

```bash
# Both containers running, not restarting
ssh gpu1 'for c in aigent-postgrest aigent-caddy; do
  docker inspect -f "{{.Name}}: {{.State.Status}} restarts={{.RestartCount}}" $c; done'

# PostgREST answers through Caddy on :8095
ssh gpu1 'curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -H "apikey: $ANON_KEY" http://localhost:8095/rest/v1/copilots?limit=1'
```
