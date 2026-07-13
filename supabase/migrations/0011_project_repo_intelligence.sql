-- Agent Mission Control — Project Repo Intelligence (base dédiée `aigent` sur gpu1).
-- Cache persistant du dernier scan d'intelligence repo d'un projet : la carte
-- structurée (RepoMap + AgenticFootprint + ResidueFindings + AgentRecommendations,
-- voir src/lib/agent-mission-control/repo-intelligence.ts) sérialisée en jsonb,
-- + le timestamp du scan pour décider de la fraîcheur (staleness : absent = scan
-- requis, > 24h = stale, sha de commit changé = stale). Read-only GitHub : ce
-- cache ne contient jamais de secret (github.ts refuse les chemins credentials).
-- Colonnes snake_case ; la data layer camelise repo_intelligence→repoIntelligence.

alter table projects add column if not exists repo_intelligence jsonb;
alter table projects add column if not exists repo_intelligence_at timestamptz;
alter table projects add column if not exists repo_intelligence_sha text;

-- Le grant "on all tables" de 0001 couvre les tables existantes ; une colonne
-- ajoutée hérite du grant de sa table, donc aucun re-grant n'est nécessaire ici
-- (contrairement à une nouvelle TABLE, cf. 0010). Documenté pour lever le doute.
