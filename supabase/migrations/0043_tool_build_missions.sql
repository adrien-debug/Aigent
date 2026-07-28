-- Agent Mission Control — Tool Builder mission ledger (Factory).
--
-- One row per tool build walk through the DRAFT→…→CERTIFIED state machine.
-- Proof lives in evidence jsonb; certification is earned by sandbox tests.

create table if not exists tool_build_missions (
  id text primary key,
  tool_id text not null,
  state text not null
    check (state in ('DRAFT', 'IMPLEMENTING', 'TESTING', 'CERTIFIED', 'REJECTED', 'DEPRECATED')),
  spec jsonb not null,
  evidence jsonb,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tool_build_missions_state_updated_idx
  on tool_build_missions (state, updated_at desc);

create index if not exists tool_build_missions_tool_id_idx
  on tool_build_missions (tool_id, updated_at desc);

alter table tool_build_missions enable row level security;
grant select, insert, update, delete on tool_build_missions to service_role;

notify pgrst, 'reload schema';
