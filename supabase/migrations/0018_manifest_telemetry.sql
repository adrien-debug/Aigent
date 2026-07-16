-- Agent Mission Control — Manifest telemetry (base dédiée `aigent` sur gpu1).
-- Ajoute le champ optionnel `AgentManifest.telemetry` (types.ts, Prompt 62) comme
-- colonne réelle : la table manifests n'avait jamais reçu cette colonne alors que
-- le type TypeScript la déclarait déjà — getManifestForCopilot() fait un SELECT *
-- direct sur cette table, donc sans colonne le champ n'existe jamais en mémoire.
-- Nullable (pas de default '{}'::jsonb) : NULL signifie "pas de config telemetry
-- pour cette version" et readmeTelemetrySection()/scaffoldAgentFiles() (github.ts)
-- vérifient déjà `if (!manifest.telemetry) return ''` — donc NULL désactive
-- proprement le scaffolding du wrapper, exactement comme l'absence du champ.
-- Additive et non-destructive : les manifests existants restent NULL (comportement
-- inchangé, aucun handler livré aujourd'hui ne se voit ajouter de wrapper).

alter table manifests
  add column if not exists telemetry jsonb;

comment on column manifests.telemetry is 'Config opt-in du wrapper de télémétrie runtime généré (AgentManifest.telemetry, Prompt 62/64) : {enabled, endpoint?, projectId?, agentId?, sampleRate?, redactInputs?, redactOutputs?}. NULL = pas de wrapper généré pour cette version.';

notify pgrst, 'reload schema';
