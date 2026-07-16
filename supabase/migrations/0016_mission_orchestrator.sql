-- 0016_mission_orchestrator — multi-agent mission runs + structured findings.
--
-- Additive + idempotent. Records orchestrated missions over a project repo:
-- participant selection, evidence-based findings per role, consensus decision.
-- No sensitive data — only public repo metadata and sanitized evidence.

create table if not exists mission_runs (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  objective text not null,
  status text not null,
  orchestrator_copilot_id text,
  participant_copilot_ids jsonb not null default '[]',
  repo text,
  branch text,
  decision text,
  summary text,
  report jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_runs_project_created_idx
  on mission_runs (project_id, created_at desc);

create table if not exists mission_findings (
  id text primary key,
  mission_run_id text not null references mission_runs(id) on delete cascade,
  copilot_id text,
  role text not null,
  severity text not null,
  title text not null,
  description text not null,
  evidence jsonb not null default '{}',
  recommendation text,
  created_at timestamptz not null default now()
);

create index if not exists mission_findings_run_idx
  on mission_findings (mission_run_id, created_at asc);

alter table mission_runs enable row level security;
alter table mission_findings enable row level security;
grant select, insert, update, delete on mission_runs to service_role;
grant select, insert, update, delete on mission_findings to service_role;

notify pgrst, 'reload schema';
