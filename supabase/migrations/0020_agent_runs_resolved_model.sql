-- 0020_agent_runs_resolved_model — persist the model actually resolved at run time.
--
-- Additive + idempotent. Until this migration, agent_runs carried NO record of the
-- model or provider that actually executed a run: the runner computes
-- resolvedModel / resolvedProvider / modelUnverified (src/lib/agent-mission-control/
-- runner.ts) but never persisted them. The runs surfaces therefore had nothing real
-- to show and could only display the copilot's DECLARED model, which is not
-- necessarily the one that ran.
--
-- `model_unverified` defaults to TRUE on purpose: a run is presumed unverified until
-- a writer explicitly proves the resolved model. Never fabricate a verified model —
-- absence of proof is surfaced as unverified, never silently trusted.
--
-- Contains no prompt, no manifest body, no secret: two text labels and a boolean.

alter table agent_runs
  add column if not exists resolved_model text,
  add column if not exists resolved_provider text,
  add column if not exists model_unverified boolean not null default true;

notify pgrst, 'reload schema';
