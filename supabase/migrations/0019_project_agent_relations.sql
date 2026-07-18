-- 0019_project_agent_relations — explicit agent-to-agent relations, per project.
--
-- Additive + idempotent. Until this table, the schema carried NO agent-to-agent
-- relation of any kind: no parent/supervisor/orchestrator/upstream/downstream/
-- reviewer/depends_on column, no junction table, no teams table. The team canvas
-- therefore had nothing real to draw a graph from, and the only honest options
-- were "draw nothing" or "persist the truth". This table is the second.
--
-- A row is a DECLARED relation between two agents of the SAME project. It is
-- never inferred: nothing writes here from a name heuristic, a model, a shared
-- project, or the temporal proximity of two runs. Absence of a row means
-- absence of a known relation — the canvas draws no edge, and that is correct.
--
-- Contains no prompt, no manifest body, no secret: ids, a relation type, a
-- human label, and free-form metadata.

create table if not exists project_agent_relations (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  source_copilot_id text not null references copilots(id) on delete cascade,
  target_copilot_id text not null references copilots(id) on delete cascade,
  relation_type text not null
    check (relation_type in ('orchestrates','depends-on','sends-output-to','reviews','triggers')),
  label text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An agent never relates to itself.
  constraint project_agent_relations_no_self_edge
    check (source_copilot_id <> target_copilot_id),
  -- One row per directed pair per relation type; re-declaring is an upsert,
  -- not a duplicate edge on the canvas.
  constraint project_agent_relations_unique_edge
    unique (project_id, source_copilot_id, target_copilot_id, relation_type)
);

create index if not exists project_agent_relations_project_idx
  on project_agent_relations (project_id, created_at desc);
create index if not exists project_agent_relations_source_idx
  on project_agent_relations (source_copilot_id);
create index if not exists project_agent_relations_target_idx
  on project_agent_relations (target_copilot_id);

-- CROSS-PROJECT RELATIONS ARE IMPOSSIBLE BY CONTRACT.
--
-- The invariant is: both source_copilot_id and target_copilot_id must be
-- copilots whose own `project_id` equals this row's `project_id`. A plain CHECK
-- cannot express it (it would have to read another table), and copilots.project_id
-- is TEXT + NULLABLE and reassignable, so a composite FK would either be violated
-- by the 6 existing NULL-project copilots or would freeze reassignment.
--
-- It is therefore enforced at READ TIME, in
-- src/lib/agent-mission-control/project-team/relations.ts (buildTeamEdges): any
-- row whose project_id differs from the requested project, or whose endpoints
-- are not both members of that project, is DROPPED — never rendered. The same
-- filter also removes rows pointing at a since-deleted or reassigned agent.
--
-- Consequence for writers: a future write path MUST re-verify both endpoints'
-- project_id before inserting. The DB will accept a cross-project row; the
-- canvas will simply refuse to display it.

alter table project_agent_relations enable row level security;
grant select, insert, update, delete on project_agent_relations to service_role;

notify pgrst, 'reload schema';
