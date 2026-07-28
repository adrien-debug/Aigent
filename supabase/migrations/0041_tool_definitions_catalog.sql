-- AIGENT-TOOL-CATALOG-001 — shared tool_definitions + copilot mounts via tools.tool_definition_id
--
-- Before: every copilot duplicated full tool metadata in `tools` rows (name, description,
-- risk, mutates…) with no shared catalogue row. Reuse meant copying strings, not referencing
-- a stable definition id.
--
-- After: `tool_definitions` holds the reusable catalogue (id = registry id, e.g.
-- read_market_snapshot). `tools` rows are per-copilot MOUNTS that FK to a definition.
-- Name/description on mounts stay denormalized for PostgREST reads that predate joins.

create table if not exists tool_definitions (
  id text primary key,
  name text not null,
  description text not null default '',
  provider text not null check (provider in ('internal','composio','mcp','http')),
  risk_level text not null check (risk_level in ('low','medium','high','critical')),
  mutates boolean not null default true,
  version text not null default '1.0.0',
  certification text not null check (certification in ('certified','draft','deprecated')) default 'certified',
  provenance text not null default 'platform',
  kind text not null default 'http-get',
  updated_at timestamptz not null default now(),
  constraint tool_definitions_name_unique unique (name)
);

create index if not exists tool_definitions_name_idx on tool_definitions(name);

alter table tools
  add column if not exists tool_definition_id text references tool_definitions(id);

create index if not exists tools_tool_definition_id_idx on tools(tool_definition_id);

comment on table tool_definitions is
  'Shared catalogue of mountable tools (id = registry/tools.ts id). Copilot-specific enablement lives in tools.tool_definition_id mounts.';
comment on column tools.tool_definition_id is
  'FK to tool_definitions.id — the reusable definition this mount instantiates for copilot_id.';

-- Backfill catalogue from existing mount rows (best row per name wins).
insert into tool_definitions (id, name, description, provider, risk_level, mutates, version, certification, provenance, kind, updated_at)
select distinct on (t.name)
  t.name as id,
  t.name,
  t.description,
  t.provider,
  t.risk_level,
  t.mutates,
  '1.0.0',
  'certified',
  'platform',
  'http-get',
  now()
from tools t
order by t.name, t.id
on conflict (id) do nothing;

update tools
   set tool_definition_id = name
 where tool_definition_id is null
   and name in (select id from tool_definitions);

-- RLS deny-by-default (service_role bypasses).
alter table tool_definitions enable row level security;

grant select, insert, update, delete on tool_definitions to service_role;

notify pgrst, 'reload schema';
