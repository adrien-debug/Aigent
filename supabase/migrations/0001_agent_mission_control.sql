-- Agent Mission Control — schéma initial (base dédiée `aigent` sur gpu1).
-- Miroir de src/lib/agent-mission-control/types.ts ; ids texte lisibles (cp-…, run-…).
-- Accès : service_role uniquement (RLS activée, zéro policy anon — console interne).

create table if not exists projects (
  id text primary key,
  name text not null,
  slug text not null unique,
  description text not null default '',
  platform text not null check (platform in ('web','desktop','mobile','api')),
  created_at timestamptz not null
);

create table if not exists copilots (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  slug text not null unique,
  description text not null default '',
  runtime text not null check (runtime in ('langgraph','openai-assistants','gemini','custom')),
  status text not null check (status in ('active','paused','draft','degraded','archived')),
  production_version_id text,
  latest_version_id text not null,
  model text not null,
  model_provider text not null check (model_provider in ('openai','google','mistral','local')),
  owner text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  health jsonb not null default '{}'::jsonb
);
create index if not exists copilots_project_idx on copilots(project_id);

create table if not exists copilot_versions (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  label text not null,
  stage text not null check (stage in ('production','beta','draft','archived')),
  manifest_id text not null,
  model text not null,
  model_provider text not null,
  changelog text not null default '',
  created_at timestamptz not null,
  created_by text not null,
  scores jsonb not null default '{}'::jsonb
);
create index if not exists copilot_versions_copilot_idx on copilot_versions(copilot_id);

create table if not exists manifests (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  version text not null,
  system_prompt_summary text not null default '',
  allowed_routes text[] not null default '{}',
  forbidden_actions text[] not null default '{}',
  confirmation_policy text not null check (confirmation_policy in ('never','risky-only','always')),
  always_confirm_actions text[] not null default '{}',
  memory_sources jsonb not null default '[]'::jsonb,
  output_contract jsonb not null default '{}'::jsonb,
  tool_ids text[] not null default '{}',
  max_steps_per_run int not null default 24,
  max_cost_per_run_usd numeric not null default 1,
  updated_at timestamptz not null
);
create index if not exists manifests_copilot_idx on manifests(copilot_id);

create table if not exists tools (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  name text not null,
  description text not null default '',
  provider text not null check (provider in ('internal','composio','mcp','http')),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  enabled boolean not null default true,
  requires_confirmation boolean not null default false,
  scoped_routes text[] not null default '{}',
  last_used_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  calls_last_7d int not null default 0,
  error_rate_last_7d numeric not null default 0
);
create index if not exists tools_copilot_idx on tools(copilot_id);

create table if not exists test_suites (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  name text not null,
  description text not null default '',
  kind text not null check (kind in ('behavior','safety','regression','output-contract')),
  last_run_id text
);
create index if not exists test_suites_copilot_idx on test_suites(copilot_id);

create table if not exists test_cases (
  id text primary key,
  suite_id text not null references test_suites(id) on delete cascade,
  name text not null,
  input text not null default '',
  expected_behavior text not null default '',
  expected_tool_calls text[] not null default '{}',
  tags text[] not null default '{}'
);
create index if not exists test_cases_suite_idx on test_cases(suite_id);

create table if not exists test_runs (
  id text primary key,
  suite_id text not null references test_suites(id) on delete cascade,
  copilot_id text not null references copilots(id) on delete cascade,
  version_id text not null,
  triggered_by text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('queued','running','completed','aborted')),
  pass_rate numeric not null default 0,
  total_cost_usd numeric not null default 0
);
create index if not exists test_runs_copilot_idx on test_runs(copilot_id);

create table if not exists test_results (
  id text primary key,
  run_id text not null references test_runs(id) on delete cascade,
  case_id text not null references test_cases(id) on delete cascade,
  status text not null check (status in ('pass','fail','error','skip','running')),
  actual_behavior text not null default '',
  actual_tool_calls text[] not null default '{}',
  failure_reason text,
  latency_ms int not null default 0,
  cost_usd numeric not null default 0,
  trace_url text
);
create index if not exists test_results_run_idx on test_results(run_id);

create table if not exists agent_runs (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  version_id text not null,
  project_id text not null,
  user_label text not null default '',
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('completed','failed','blocked','needs-confirmation','running')),
  input_summary text not null default '',
  output_summary text not null default '',
  tool_call_count int not null default 0,
  unsafe_attempt_count int not null default 0,
  latency_ms int not null default 0,
  cost_usd numeric not null default 0,
  trace_url text
);
create index if not exists agent_runs_copilot_idx on agent_runs(copilot_id, started_at desc);

create table if not exists agent_run_steps (
  id text primary key,
  run_id text not null references agent_runs(id) on delete cascade,
  index int not null,
  kind text not null check (kind in ('llm-call','tool-call','memory-read','memory-write','guardrail-check','confirmation','output')),
  title text not null,
  detail text not null default '',
  status text not null check (status in ('ok','warning','blocked','error')),
  started_at timestamptz not null,
  duration_ms int not null default 0,
  tool_call_id text
);
create index if not exists agent_run_steps_run_idx on agent_run_steps(run_id, index);

create table if not exists tool_calls (
  id text primary key,
  run_id text not null references agent_runs(id) on delete cascade,
  tool_id text not null,
  tool_name text not null,
  arguments_summary text not null default '',
  result_summary text not null default '',
  status text not null check (status in ('ok','error','blocked','confirmed','rejected')),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  required_confirmation boolean not null default false,
  latency_ms int not null default 0
);
create index if not exists tool_calls_run_idx on tool_calls(run_id);

create table if not exists benchmark_suites (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  name text not null,
  description text not null default '',
  task_count int not null default 0,
  dimensions text[] not null default '{}'
);
create index if not exists benchmark_suites_copilot_idx on benchmark_suites(copilot_id);

create table if not exists benchmark_runs (
  id text primary key,
  suite_id text not null references benchmark_suites(id) on delete cascade,
  copilot_id text not null references copilots(id) on delete cascade,
  version_id text not null,
  model text not null,
  model_provider text not null,
  runtime text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('queued','running','completed','aborted')),
  result_id text
);
create index if not exists benchmark_runs_suite_idx on benchmark_runs(suite_id);

create table if not exists benchmark_results (
  id text primary key,
  run_id text not null references benchmark_runs(id) on delete cascade,
  accuracy numeric not null default 0,
  task_success_rate numeric not null default 0,
  avg_latency_ms int not null default 0,
  p95_latency_ms int not null default 0,
  avg_cost_per_task_usd numeric not null default 0,
  total_cost_usd numeric not null default 0,
  unsafe_action_count int not null default 0,
  unauthorized_route_count int not null default 0,
  confirmation_mistake_count int not null default 0,
  score numeric not null default 0
);
create index if not exists benchmark_results_run_idx on benchmark_results(run_id);

create table if not exists replay_comparisons (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  source_run_id text not null,
  created_at timestamptz not null,
  status text not null check (status in ('draft','ready','diverged','matched')),
  case_count int not null default 0,
  candidates jsonb not null default '[]'::jsonb
);
create index if not exists replay_comparisons_copilot_idx on replay_comparisons(copilot_id);

create table if not exists shadow_experiments (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  name text not null,
  production_version_id text not null,
  candidate_version_id text not null,
  started_at timestamptz not null,
  ends_at timestamptz,
  status text not null check (status in ('running','completed','stopped')),
  sampled_run_count int not null default 0,
  agreement_rate numeric not null default 0,
  agreement_threshold numeric not null default 0.95,
  unsafe_proposal_count int not null default 0,
  mismatches jsonb not null default '[]'::jsonb
);
create index if not exists shadow_experiments_copilot_idx on shadow_experiments(copilot_id);

create table if not exists promotion_gates (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  candidate_version_id text not null,
  target_stage text not null check (target_stage in ('production','beta')),
  checks jsonb not null default '[]'::jsonb,
  overall_status text not null check (overall_status in ('ready','blocked','pending-approval')),
  approver text,
  approved_at timestamptz,
  last_evaluated_at timestamptz not null
);
create index if not exists promotion_gates_copilot_idx on promotion_gates(copilot_id);

create table if not exists registry_warnings (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  severity text not null check (severity in ('warning','danger')),
  message text not null,
  occurred_at timestamptz not null,
  href text not null default ''
);
create index if not exists registry_warnings_time_idx on registry_warnings(occurred_at desc);

-- RLS : deny-by-default. Tout accès applicatif passe par service_role (bypass RLS).
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema public to service_role;
