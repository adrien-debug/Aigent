-- Agent Mission Control — agent_drafts (alignement repo / gpu1).
--
-- La table `agent_drafts` existe déjà sur gpu1 (schéma historique :
-- generated_manifest, conversation, created_copilot_id, status drafting|ready|created).
-- Cette migration est idempotente : elle ne recrée rien, elle re-grante seulement
-- service_role au cas où la table aurait été créée hors 0001.

grant select, insert, update, delete on agent_drafts to service_role;

notify pgrst, 'reload schema';
