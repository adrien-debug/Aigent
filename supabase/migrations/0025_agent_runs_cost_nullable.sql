-- AIG-AGENT-QUALITY-005 — Lot F1 : coût inconnu ≠ zéro.
--
-- 0001 a créé agent_runs.cost_usd NUMERIC NOT NULL DEFAULT 0. Conséquence : tout
-- run dont le coût n'est pas mesuré (chemin LangGraph — le stream n'expose pas
-- usage_metadata de façon lisible) reçoit 0, indistinguable d'un coût réellement nul.
-- C'est un faux zéro : de vrais tokens ont été consommés, jamais mesurés.
--
-- Correctif canonique, en deux temps, additif et sûr :
--
-- 1) Rendre la colonne NULLABLE et retirer le DEFAULT, pour que les futurs runs
--    non mesurés persistent NULL (unavailable) au lieu d'un 0 fabriqué. Les
--    agrégations SQL (SUM) ignorent nativement NULL ; agent-health.ts ignore déjà
--    tout cost_usd non-fini.
--
-- 2) Convertir les faux zéros historiques → NULL, avec une règle PROUVÉE, jamais
--    déduite du provider seul :
--       cost_usd = 0  AND  model_unverified = true  ⇒  NULL
--    model_unverified=true est la preuve que le chemin n'a PAS pu lire ce qui a
--    tourné — donc pas pu mesurer le coût. À l'inverse, un run mesuré
--    (model_unverified=false) à 0 est un vrai zéro (ex. run bloqué/erreur avant
--    tout token facturable) et est CONSERVÉ. Vérifié en live : les 26 zéros ont
--    TOUS model_unverified=true, 0 zéro mesuré n'existe. Aucun zéro réécrit
--    aveuglément.

alter table agent_runs alter column cost_usd drop default;
alter table agent_runs alter column cost_usd drop not null;

update agent_runs set cost_usd = null
 where cost_usd = 0 and model_unverified = true;
