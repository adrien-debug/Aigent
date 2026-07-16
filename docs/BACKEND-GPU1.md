# Backend GPU1 — périmètre `aigent` (posé par /cloud-adrien install, 2026-07-10 ; couche data isolée + reproductible 2026-07-15)

Base Postgres dédiée sur le serveur partagé de gpu1, exposée via PostgREST
(compatible `@supabase/supabase-js` et fetch), montage identique à Nexus.

**Config définitive de la couche data : `deploy/db/` dans le repo.** PostgREST +
Caddy ne sont plus des `docker run` à la main — ils se recréent à l'identique
avec `docker compose -f deploy/db/docker-compose.yml --env-file deploy/db/.env up -d`.
Voir `deploy/db/README.md`.

## Topologie

| Élément | Valeur |
|---|---|
| Base | `aigent` sur le conteneur `nexus-postgres` (gpu1, `127.0.0.1:5432`) |
| Rôle login | `authenticator_aigent` (**seul rôle avec `CONNECT` sur `aigent`** — voir « Isolation ») |
| JWT secret | `deploy/db/.env` (`JWT_SECRET`) — identique à celui de l'app, unique au périmètre |
| PostgREST | conteneur `aigent-postgrest` (réseau `nexus-net`) — source : `deploy/db/docker-compose.yml` |
| Caddy | conteneur `aigent-caddy`, port `:8095` — source : `deploy/db/docker-compose.yml` + `deploy/db/Caddyfile` |
| Accès dev | `http://100.88.191.49:8095` (Tailscale gpu1) — fallback si le tunnel est down |
| URL publique | `https://aigent-db.hearst.app` → tunnel `hearst-prod` :8095 (opérationnelle) — `.env.local` la pointe |
| Schéma | `supabase/migrations/` `0001` (19 tables) → `0014_sandbox_reports.sql`, **24 tables**, RLS deny-by-default, accès via `service_role` uniquement |
| Seed | `npx -y tsx scripts/seed-amc.ts > /tmp/seed-amc.sql` puis psql sur gpu1 (idempotent, TRUNCATE+INSERT) |

## Isolation de la base (périmètre strict `aigent`)

La base `aigent` partage le cluster `nexus-postgres` avec 8 autres bases projet.
Postgres accorde `CONNECT` à `PUBLIC` par défaut, et les rôles Supabase
(`anon`/`authenticated`/`service_role`) sont **partagés par tout le cluster** —
donc, sans correction, le rôle login d'un autre projet pouvait se connecter à
`aigent`, `SET ROLE service_role`, et lire/écrire les tables en contournant la RLS.

Correctif appliqué sur `nexus-postgres` (en tant que `postgres`) :

```sql
REVOKE CONNECT ON DATABASE aigent FROM PUBLIC;
GRANT  CONNECT ON DATABASE aigent TO authenticator_aigent;
```

Ne touche ni au JWT ni au code app : les rôles partagés restent, mais deviennent
inatteignables hors périmètre Aigent. Vérif — seuls `authenticator_aigent` et
`postgres` doivent pouvoir se connecter :

```bash
ssh gpu1 'docker exec nexus-postgres psql -U postgres -tAc "
SELECT rolname FROM pg_roles WHERE rolcanlogin
AND has_database_privilege(rolname, '"'"'aigent'"'"', '"'"'CONNECT'"'"') ORDER BY 1;"'
```

> Hors périmètre (chantier infra cluster-wide) : révoquer le `CONNECT` de
> `authenticator_aigent` sur les 8 autres bases, et scinder les rôles partagés
> `anon`/`authenticated`/`service_role` par projet (impacte les claims JWT de tous
> les projets).

## App

- Live-only, fail-closed : `AMC_DATA_SOURCE=gpu1` + `AMC_SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (`.env.local`, gitignoré). Sans ces 3 vars (ou
  `AMC_DATA_SOURCE` différent de `gpu1`), `requireBackend()` (`postgrest.ts`)
  **throw** — aucun mock, aucune donnée fabriquée. Les routes traduisent en
  **503**.
- Couche data : `src/lib/agent-mission-control/postgrest.ts` (client PostgREST
  partagé, `requireBackend()`) + `data.ts` (lectures async, mapping
  snake↔camel), service_role serveur uniquement, `server-only`.
- Mutations : des dizaines de routes sous `app/api/agent-ops/**` écrivent en base
  (copilots, projects, builder/*, improve/*, promotion, push-agent…) —
  `PATCH /api/agent-ops/tools/:id` (switchs enabled/confirmation persistés) n'en
  est qu'un exemple. Inventaire complet audité : `.sweep/securite-routes-api.md`.
- JWT anon/service re-signés avec le secret du périmètre (HS256) — les clés d'un
  autre workspace ne valent rien ici.

## Diag rapide

```bash
ssh gpu1 'docker ps | grep aigent'                          # conteneurs up
curl -s http://100.88.191.49:8095/rest/v1/ | head -c 80      # PostgREST (Tailscale)
ssh gpu1 'docker exec nexus-postgres psql -U postgres -d aigent -tc "select count(*) from copilots;"'

# Recréer la couche data à l'identique (si aigent-postgrest / aigent-caddy meurent).
# ~/aigent-app = copie synchronisée du repo sur gpu1 (contient deploy/db/, avec son .env chmod 600).
ssh gpu1 'cd ~/aigent-app && docker compose -f deploy/db/docker-compose.yml --env-file deploy/db/.env up -d'

# Vérifier l'isolation (attendu : authenticator_aigent + postgres uniquement) :
ssh gpu1 'docker exec nexus-postgres psql -U postgres -tAc "
SELECT rolname FROM pg_roles WHERE rolcanlogin
AND has_database_privilege(rolname, '"'"'aigent'"'"', '"'"'CONNECT'"'"') ORDER BY 1;"'
```
