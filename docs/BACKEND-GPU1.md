# Backend GPU1 — périmètre `aigent` (posé par /cloud-adrien install, 2026-07-10)

Base Postgres dédiée sur le serveur partagé de gpu1, exposée via PostgREST
(compatible `@supabase/supabase-js` et fetch), montage identique à Nexus.

## Topologie

| Élément | Valeur |
|---|---|
| Base | `aigent` sur le conteneur `nexus-postgres` (gpu1, `127.0.0.1:5432`) |
| Rôle login | `authenticator_aigent` (mdp : `gpu1:~/aigent-db/.auth-pwd`) |
| JWT secret | `gpu1:~/aigent-db/.jwt-secret` (unique au périmètre — isolation) |
| PostgREST | conteneur `aigent-postgrest` (réseau `nexus-net`) |
| Caddy | conteneur `aigent-caddy`, port `:8095`, config `gpu1:~/aigent-db/Caddyfile` |
| Accès dev | `http://100.88.191.49:8095` (Tailscale gpu1) — utilisé par `.env.local` |
| URL publique | `aigent-db.hearst.app` → tunnel `hearst-prod` :8095 (posée, voir ⚠️) |
| Schéma | `supabase/migrations/0001_agent_mission_control.sql` (19 tables, RLS deny-by-default, accès via `service_role` uniquement) |
| Seed | `npx -y tsx scripts/seed-amc.ts > /tmp/seed-amc.sql` puis psql sur gpu1 (idempotent, TRUNCATE+INSERT) |

## ⚠️ URL publique interceptée à l'edge

`https://aigent-db.hearst.app` répond mais sert l'app Next `hearst.app` au lieu de
PostgREST — **même symptôme que `studio-db.hearst.app`** (pré-existant). La règle
ingress gpu1 est correcte (`cloudflared tunnel ingress rule` matche → :8095) et
`nexus-db.hearst.app` fonctionne, lui, via un tunnel **géré à distance** (dashboard).
À corriger côté dashboard Cloudflare (Zero Trust → Tunnels) : ajouter les hostnames
`*-db` au tunnel remotely-managed qui sert `nexus-db`, ou lever l'interception
wildcard. En attendant, `.env.local` pointe le Tailscale gpu1.

## App

- Live-only, fail-closed : `AMC_DATA_SOURCE=gpu1` + `AMC_SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (`.env.local`, gitignoré). Sans ces 3 vars (ou
  `AMC_DATA_SOURCE` différent de `gpu1`), `requireBackend()` (`postgrest.ts`)
  **throw** — aucun mock, aucune donnée fabriquée. Les routes traduisent en
  **503**.
- Couche data : `src/lib/agent-mission-control/postgrest.ts` (client PostgREST
  partagé, `requireBackend()`) + `data.ts` (lectures async, mapping
  snake↔camel), service_role serveur uniquement, `server-only`.
- Mutations : `PATCH /api/agent-ops/tools/:id` (switchs enabled/confirmation persistés).
- JWT anon/service re-signés avec le secret du périmètre (HS256) — les clés d'un
  autre workspace ne valent rien ici.

## Diag rapide

```bash
ssh gpu1 'docker ps | grep aigent'                          # conteneurs up
curl -s http://100.88.191.49:8095/rest/v1/ | head -c 80      # PostgREST (Tailscale)
ssh gpu1 'docker exec nexus-postgres psql -U postgres -d aigent -tc "select count(*) from copilots;"'
```
