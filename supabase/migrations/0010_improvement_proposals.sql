-- Agent Mission Control — Improvement Loop (base dédiée `aigent` sur gpu1).
-- Une ligne = un CYCLE d'amélioration d'un copilot : l'analyse des signaux réels
-- (échecs de tests, scores benchmark, runs LangGraph, traces LangSmith) produit
-- une PROPOSITION (résumé + analyse des échecs + changements de manifest), qui
-- peut être matérialisée en version V2 draft (nouveau manifests + copilot_versions,
-- assistant re-provisionné), re-testée, comparée à la base, puis APPROUVÉE ou
-- REJETÉE par un humain. La promotion effective reste la route promotion existante
-- (jamais automatique). La comparaison V1/V2 n'est PAS persistée ici : elle est
-- recalculée live depuis test_runs/benchmark_runs par version (source unique).
-- Voir src/lib/agent-mission-control/improvement-loop.ts.

create table if not exists improvement_proposals (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  -- Version servant de base à l'analyse (la "V1" du cycle).
  base_version_id text not null references copilot_versions(id) on delete cascade,
  -- Renseignés quand la proposition est matérialisée en draft V2.
  v2_version_id text references copilot_versions(id) on delete set null,
  v2_manifest_id text,
  status text not null default 'proposed'
    check (status in ('proposed','v2-created','approved','rejected')),
  -- Proposition générée (LLM réel, JSON strict) : résumé + analyse + changements.
  summary text not null default '',
  failure_analysis jsonb not null default '[]'::jsonb,
  manifest_changes jsonb not null default '{}'::jsonb,
  -- Quelles sources ont réellement alimenté l'analyse (honnêteté : LangSmith
  -- peut être indisponible → {"langsmith": false, ...}).
  sources jsonb not null default '{}'::jsonb,
  cost_usd numeric not null default 0,
  created_at timestamptz not null,
  created_by text not null default '',
  decided_by text,
  decided_at timestamptz
);

create index if not exists improvement_proposals_copilot_idx
  on improvement_proposals (copilot_id, created_at desc);

-- Le grant "on all tables" de 0001 ne couvre que les tables existantes à son
-- exécution — chaque nouvelle table doit re-granter explicitement.
grant select, insert, update, delete on improvement_proposals to service_role;
