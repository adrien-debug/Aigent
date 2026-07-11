-- Agent Mission Control — lien repo GitHub (projet 1:1) + état de push d'agent (base dédiée `aigent` sur gpu1).
-- Miroir de Project.repoUrl / Project.repoFullName et Copilot.lastPushStatus / lastPushedAt / lastPushCommitUrl dans src/lib/agent-mission-control/types.ts.
-- Colonnes snake_case ; la data layer camelise repo_url→repoUrl, last_push_status→lastPushStatus automatiquement (data.ts intact).

alter table projects add column if not exists repo_url text;
alter table projects add column if not exists repo_full_name text;
alter table copilots add column if not exists last_push_status text;
alter table copilots add column if not exists last_pushed_at timestamptz;
alter table copilots add column if not exists last_push_commit_url text;
