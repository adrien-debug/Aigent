# Stack d'observabilité locale — AIGENT-VISUAL-STACK-002

Langfuse, Prometheus, Grafana et n8n, isolés pour Aigent.

## Pourquoi une stack isolée

Cette machine héberge d'autres chantiers : un Supabase local complet et des
Postgres appartenant à `hermes`, `hpb`, `hcb`, `mamo`. **Rien n'est réutilisé
ici.** Tous les conteneurs sont préfixés `aigent-obs-`, sur volumes dédiés, dans
une bande de ports vérifiée libre au 2026-08-01.

Les ports ne sont publiés que sur `127.0.0.1` : aucun service n'est joignable
depuis le réseau.

## Ports

| Service | Port | Rôle |
|---|---|---|
| Langfuse | 3801 | traces d'exécution des agents |
| Grafana | 3802 | dashboards |
| n8n | 3803 | automatisations |
| Prometheus | 3804 | scrape des métriques Aigent |

Aigent tourne sur **3987** (partagé) et LangGraph sur **2024**. Ni l'un ni
l'autre n'appartient à cette stack : ne jamais les redémarrer depuis ici.

## Démarrer

```bash
cd deploy/observability
cp .env.example .env          # puis renseigner de vraies valeurs locales
docker compose --env-file .env up -d
```

Arrêter : `docker compose down` · Purger les volumes : `docker compose down -v`
(**détruit les données**).

## Secrets

`.env` et `prometheus/secrets/` sont **gitignorés**. Seul `.env.example` est
versionné, avec des valeurs factices. Aucune clé n'apparaît dans un fichier
versionné, ni dans le YAML de Prometheus, ni dans le JSON du workflow n8n —
vérifié par `npm run check:secrets` et par un scan du bundle client.

## Brancher Aigent

Ajouter à `.env.local` (voir `.env.aigent.example`) :

```
LANGFUSE_HOST=http://127.0.0.1:3801
LANGFUSE_PUBLIC_KEY=…
LANGFUSE_SECRET_KEY=…
LANGFUSE_BASEURL=http://127.0.0.1:3801
GRAFANA_URL=http://127.0.0.1:3802
N8N_URL=http://127.0.0.1:3803
```

## Vérifier

```bash
node scripts/smoke-langfuse.mjs      # aller-retour trace complet
curl -s localhost:3804/api/v1/query?query=aigent_runs_total
```

## Prometheus scrape 3988, pas 3987

Le serveur partagé (3987) tourne sur `main` et **ne porte pas encore** la route
`/api/agent-ops/metrics` : il y répond 404. Il n'a pas été redémarré pour cette
mission. La cible pointe donc sur l'instance de mission (3988).

**Après merge**, une fois le serveur partagé redémarré par son propriétaire,
repasser la cible sur 3987 dans `prometheus/prometheus.yml`.

## Le workflow n8n : deux axes à ne pas confondre

Le statut technique n8n (`success` / `error`) dit si le workflow s'est déroulé.
Le champ `verdict` de sa sortie (`HEALTHY` / `ATTENTION` / `UNAVAILABLE`) dit ce
qu'on a appris sur la flotte.

Un run `success` portant un verdict `UNAVAILABLE` est le fonctionnement normal
d'une sonde dont la cible est éteinte — pas une contradiction.

## n8n : compte local

n8n 1.68 ignore `N8N_USER_MANAGEMENT_DISABLED` et exige une authentification
REST. Un compte propriétaire local a été créé (`local@example.invalid`). Le
service n'écoutant que sur `127.0.0.1`, ce compte n'est pas exposé.
