-- 0014_sandbox_reports — persist Target Repo Sandbox evaluation reports.
--
-- Additive + idempotent: a new table only, no change to existing schema. Stores
-- the JSON verdict produced by the sandbox (dry_run or execute) so the UI can
-- show the latest verdict without re-running the read-only GitHub/clone check.
-- No sensitive data: the report's output excerpts are already sanitized upstream
-- (secret VALUES masked), and only the delivered-artifact scan names are kept.

create table if not exists sandbox_reports (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  version_id text,
  project_id text,
  run_id text not null,
  target_repo text not null,
  target_branch text,
  target_commit text,
  execution_mode text not null check (execution_mode in ('dry_run','execute')),
  install_mode text not null check (install_mode in ('skip','auto')),
  status text not null check (status in ('passed','warning','failed')),
  sandbox_fit_score numeric,
  repo_fit_score numeric,
  report jsonb not null,
  created_at timestamptz not null default now()
);

-- Latest-report-per-copilot lookup (the GET /latest route).
create index if not exists sandbox_reports_copilot_created_idx
  on sandbox_reports (copilot_id, created_at desc);

-- RLS deny-by-default (same doctrine as 0001): app access is service_role only,
-- which bypasses RLS. The "grant on all tables" of 0001 only covered tables that
-- existed then, so a new table must re-grant explicitly.
alter table sandbox_reports enable row level security;
grant select, insert, update, delete on sandbox_reports to service_role;

-- Tell PostgREST to reload its schema cache so the new table is queryable.
notify pgrst, 'reload schema';
