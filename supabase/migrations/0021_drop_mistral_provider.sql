-- Drop the Mistral provider from Agent Mission Control's model_provider CHECKs.
-- 'mistral' is declared in the SQL enum but was never wired end-to-end: the
-- TypeScript ModelProvider type has already removed it, and both dispatch paths
-- (model-router.ts direct + src/langgraph/model-provider.mjs) throw
-- ProviderUnavailableError for it. A stray 'mistral' row would otherwise be
-- silently rebound to 'openai' by normalizeModelProvider, producing a
-- guaranteed-failing run (openai provider + mistral model id).
-- Same operation/tables as 0005_drop_anthropic_provider.sql for 'anthropic'.
--
-- Pre-verified read-only via PostgREST before writing this migration:
-- copilots / copilot_versions / benchmark_runs each returned 0 rows with
-- model_provider = 'mistral' (Content-Range: */0). No live data is affected.
-- APPLIED 2026-07-20 against the live `aigent` database on gpu1. Re-verified
-- after: no CHECK constraint mentions 'mistral' anymore, on any table. Note
-- that copilot_versions/benchmark_runs had no named constraint to drop (the
-- NOTICE is expected); the recreate added them. Idempotent, safe to re-run.

-- copilots.model_provider
alter table copilots drop constraint if exists copilots_model_provider_check;
alter table copilots add constraint copilots_model_provider_check
  check (model_provider in ('openai','google','local'));

-- copilot_versions.model_provider
alter table copilot_versions drop constraint if exists copilot_versions_model_provider_check;
alter table copilot_versions add constraint copilot_versions_model_provider_check
  check (model_provider in ('openai','google','local'));

-- benchmark_runs.model_provider
alter table benchmark_runs drop constraint if exists benchmark_runs_model_provider_check;
alter table benchmark_runs add constraint benchmark_runs_model_provider_check
  check (model_provider in ('openai','google','local'));
