-- AIG-AGENT-QUALITY-005 — Lot sécurité (2/2) : invariant de confirmation rétroactif.
--
-- Invariant canonique du domaine :
--   mutates = true OR risk_level IN ('high','critical')  =>  requires_confirmation = true
--
-- Le code d'authoring (isHighRiskOrWriteCapableTool) l'impose déjà à l'ÉCRITURE de
-- nouveaux outils, mais les 158 lignes déjà persistées n'avaient jamais été
-- réconciliées. Après la classification 0023, tout outil resté mutates=true (les 22
-- stubs UNKNOWN_FAIL_CLOSED + draft_copilot_spec) doit exiger confirmation.
--
-- STRICTEMENT ADDITIF : n'ajoute que des confirmations, n'en retire aucune. Un outil
-- read-only prouvé (mutates=false, low) n'est jamais forcé à confirmer.
-- DOIT s'exécuter APRÈS 0023 (dépend de l'état mutates final).
-- Appliqué en live le 2026-07-20 (UPDATE 17). Idempotent.

update tools set requires_confirmation = true
 where (mutates = true or risk_level in ('high', 'critical'))
   and requires_confirmation = false;
