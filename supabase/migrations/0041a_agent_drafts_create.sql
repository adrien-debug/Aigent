-- 0041a_agent_drafts_create — la table que 0042 supposait déjà là.
--
-- POURQUOI CETTE MIGRATION EXISTE
-- `0042_agent_drafts.sql` ne fait qu'un `grant` et l'assume en commentaire :
-- « la table `agent_drafts` existe DÉJÀ sur gpu1 … elle ne recrée rien ». Elle
-- avait donc été créée À LA MAIN sur la base de production, et aucune migration
-- ne la portait. Conséquence : le repo était incapable de reconstruire son
-- propre schéma — `0042` échoue sur `relation "agent_drafts" does not exist`
-- dès qu'on rejoue la suite depuis une base vide.
--
-- Le défaut n'a été révélé que par la reconstruction complète de `aigent_qa`
-- (2026-07-31). Aucune gate ne pouvait le voir : elles s'exécutent toutes
-- contre une base qui portait déjà la table.
--
-- Le schéma ci-dessous est relevé sur la production en LECTURE SEULE
-- (`information_schema.columns`, `pg_index`, `pg_constraint`) — il n'est pas
-- réinventé. Numérotée `0041a` pour s'intercaler avant `0042` sans renuméroter
-- une suite déjà appliquée ailleurs.
--
-- Idempotente : `if not exists` partout. Sur la production, où la table existe,
-- elle ne fait rien — c'est voulu, et c'est ce qui la rend sûre à appliquer
-- partout.

create table if not exists agent_drafts (
  id text primary key,

  -- L'identité éditée pendant le brouillon. Vides par défaut : un brouillon
  -- naît sans nom, il n'est pas « sans nom mesuré ».
  name text not null default '',
  description text not null default '',

  -- Runtime/modèle proposés par l'architecte. Ces valeurs par défaut sont
  -- historiques et NE reflètent pas le contrat canonique produit, où le seul
  -- runtime exécutable est `langgraph` : un brouillon n'est pas un agent, et sa
  -- matérialisation repasse par la validation du runtime.
  runtime text not null default 'anthropic-sdk',
  model text not null default 'claude-sonnet-4-5',
  model_provider text not null default 'anthropic',

  owner text not null default '',

  -- drafting → ready → created. `created` signifie qu'un copilot a été
  -- matérialisé ; `created_copilot_id` le porte alors.
  status text not null default 'drafting'
    check (status in ('drafting', 'ready', 'created')),

  -- Le manifeste produit par l'architecte, et le fil qui y a mené.
  generated_manifest jsonb not null default '{}'::jsonb,
  conversation jsonb not null default '[]'::jsonb,

  -- NULL tant qu'aucun copilot n'a été matérialisé — jamais une chaîne vide,
  -- qui se lirait comme un identifiant mesuré.
  created_copilot_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS + grant, les DEUX gestes. Un grant sans RLS a réellement exposé deux
-- tables sur l'internet public via ce PostgREST (incident des migrations
-- 0010/0012, refermé par 0044). Aucune policy : deny-by-default, seul
-- `service_role` (qui contourne RLS) lit et écrit.
alter table agent_drafts enable row level security;
grant select, insert, update, delete on agent_drafts to service_role;

notify pgrst, 'reload schema';
