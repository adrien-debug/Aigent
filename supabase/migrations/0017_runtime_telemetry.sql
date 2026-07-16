-- 0017_runtime_telemetry — opt-in runtime telemetry events from deployed agents.
--
-- Additive + idempotent. Records best-effort lifecycle pings (started/completed/failed)
-- emitted by generated agent handlers via POST /api/runtime-telemetry. No sensitive data —
-- redacted shapes only, error is a hashed/sanitized summary, never raw prompts or secrets.

create table if not exists runtime_telemetry_events (
  id text primary key,
  project_id text not null,
  agent_id text not null,
  agent_version text,
  target_repo text,
  run_id text not null,
  provider text,
  model text,
  status text not null check (status in ('started', 'completed', 'failed')),
  latency_ms integer,
  input_shape jsonb not null default '{}',
  output_shape jsonb not null default '{}',
  error jsonb not null default '{}',
  usage jsonb not null default '{}',
  environment jsonb not null default '{}',
  received_at timestamptz not null default now()
);

create index if not exists runtime_telemetry_events_project_agent_received_idx
  on runtime_telemetry_events (project_id, agent_id, received_at desc);

create index if not exists runtime_telemetry_events_status_idx
  on runtime_telemetry_events (status);

create index if not exists runtime_telemetry_events_run_idx
  on runtime_telemetry_events (run_id);

alter table runtime_telemetry_events enable row level security;
grant select, insert, update, delete on runtime_telemetry_events to service_role;

notify pgrst, 'reload schema';
