-- Agent Mission Control — assistant LangGraph dédié par projet (base dédiée `aigent` sur gpu1).
-- Chaque projet possède SON assistant sur le graphe partagé `agent_builder` du LangGraph
-- Agent Server : les runs d'un copilot rattaché au projet passent par cet assistant (au lieu
-- du graph_id générique), ce qui fait de chaque projet une entité distincte inspectable dans
-- le Studio LangGraph. La colonne stocke l'assistant_id (uuid renvoyé par POST /assistants).
-- Nullable : un projet legacy (créé avant ce câblage) reste sans assistant et retombe sur le
-- graph_id partagé au run (fallback). Colonne snake_case ; la data layer camelise
-- assistant_id→assistantId automatiquement (data.ts intact).

alter table projects add column if not exists assistant_id text;
