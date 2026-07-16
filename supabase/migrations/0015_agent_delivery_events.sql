-- 0015_agent_delivery_events — record each agent delivery to a target repo.
--
-- Additive + idempotent: a new table only. Captures both delivery modes
-- (direct_commit and pull_request) so the UI can show "latest delivery" (PR #,
-- branch, commit) and cross-reference the sandbox verdict. No sensitive data:
-- only public GitHub URLs/shas + a sanitized report snapshot.

create table if not exists agent_delivery_events (
  id text primary key,
  copilot_id text not null references copilots(id) on delete cascade,
  version_id text,
  project_id text,
  mode text not null check (mode in ('direct_commit','pull_request')),
  target_repo text not null,
  target_branch text,
  delivery_branch text,
  commit_sha text,
  commit_url text,
  pr_url text,
  pr_number integer,
  status text not null,
  report jsonb,
  created_at timestamptz not null default now()
);

-- Latest-delivery-per-copilot lookup.
create index if not exists agent_delivery_events_copilot_created_idx
  on agent_delivery_events (copilot_id, created_at desc);

-- RLS deny-by-default (same doctrine as 0001): app access is service_role only.
alter table agent_delivery_events enable row level security;
grant select, insert, update, delete on agent_delivery_events to service_role;

-- Tell PostgREST to reload its schema cache so the new table is queryable.
notify pgrst, 'reload schema';
