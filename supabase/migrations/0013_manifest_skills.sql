-- Agent Mission Control — Manifest skills (base dédiée `aigent` sur gpu1).
-- Ajoute la liste des compétences métier d'un agent sur son manifest : un array
-- JSON d'objets { label, detail? } dérivés de la mission de l'agent par l'Agent
-- Builder. Colonne typée jsonb, cohérente avec les autres champs jsonb du manifest
-- (memory_sources, output_contract). Additive et non-destructive : le default
-- '[]'::jsonb garantit que les manifests existants (dont BTC Sentinel) reçoivent
-- un array vide, jamais NULL. Le grant "on all tables" de 0001 couvre déjà cette
-- colonne (elle hérite du grant de sa table), aucun re-grant nécessaire.

alter table manifests
  add column if not exists skills jsonb not null default '[]'::jsonb;

comment on column manifests.skills is 'Liste JSON des compétences métier de l''agent (objets {label, detail?}), dérivées de sa mission par l''Agent Builder.';
