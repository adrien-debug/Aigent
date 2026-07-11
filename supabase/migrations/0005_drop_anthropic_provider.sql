-- Drop the Anthropic provider/runtime from Agent Mission Control.
-- The product runs on OpenAI; 'anthropic' / 'anthropic-sdk' are removed from the
-- model_provider / runtime CHECK constraints. No live row uses them (verified),
-- so this is a safe, non-destructive tightening.

-- copilots.runtime
alter table copilots drop constraint if exists copilots_runtime_check;
alter table copilots add constraint copilots_runtime_check
  check (runtime in ('langgraph','openai-assistants','gemini','custom'));

-- copilots.model_provider
alter table copilots drop constraint if exists copilots_model_provider_check;
alter table copilots add constraint copilots_model_provider_check
  check (model_provider in ('openai','google','mistral','local'));

-- copilot_versions.model_provider
alter table copilot_versions drop constraint if exists copilot_versions_model_provider_check;
alter table copilot_versions add constraint copilot_versions_model_provider_check
  check (model_provider in ('openai','google','mistral','local'));

-- benchmark_runs.model_provider / runtime (if constrained)
alter table benchmark_runs drop constraint if exists benchmark_runs_model_provider_check;
alter table benchmark_runs add constraint benchmark_runs_model_provider_check
  check (model_provider in ('openai','google','mistral','local'));
alter table benchmark_runs drop constraint if exists benchmark_runs_runtime_check;
alter table benchmark_runs add constraint benchmark_runs_runtime_check
  check (runtime in ('langgraph','openai-assistants','gemini','custom'));
