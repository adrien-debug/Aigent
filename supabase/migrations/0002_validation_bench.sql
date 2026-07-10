-- Banc de validation (directive Adrien 2026-07-10) :
-- * project_id devient NULLABLE — null = copilote sur le banc, non validé.
--   L'affectation à un projet est l'acte de validation.
-- * target_project_ids — destination(s) de développement (0..2 projets visés
--   pendant le rodage), informatif, sans effet d'affectation.

alter table copilots alter column project_id drop not null;

alter table copilots
  add column if not exists target_project_ids text[] not null default '{}';

-- Copilotes actuellement en rodage → sur le banc, avec leur destination.
update copilots
  set target_project_ids = array[project_id], project_id = null
  where id in ('cp-docs-drafter', 'cp-api-triage');
