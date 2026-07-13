-- Agent Mission Control — Project Builder persistent conversations (base `aigent` gpu1).
-- One active conversation per project at a time; messages + evolving preview jsonb.
-- Server-only via service_role. No secrets in messages — architect summaries only.
-- See src/lib/agent-mission-control/project-builder-conversation.ts

create table if not exists project_builder_conversations (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active','draft_ready','draft_created','archived')),
  langgraph_thread_id text,
  latest_preview jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists project_builder_conversations_project_updated_idx
  on project_builder_conversations (project_id, updated_at desc);

-- At most one active conversation per project.
create unique index if not exists project_builder_conversations_one_active_per_project
  on project_builder_conversations (project_id)
  where status = 'active';

create table if not exists project_builder_messages (
  id text primary key,
  conversation_id text not null references project_builder_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create index if not exists project_builder_messages_conversation_idx
  on project_builder_messages (conversation_id, created_at asc);

grant select, insert, update, delete on project_builder_conversations to service_role;
grant select, insert, update, delete on project_builder_messages to service_role;
