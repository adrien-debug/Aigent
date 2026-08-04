-- AIGENT-DOWNSTREAM-LAST-MILE-001 — canonical corpus identity and downstream links.
--
-- `content_hash` proves that qualification, shadow, replay and improvement used
-- the same versioned corpus. Existing rows stay NULL: absence is unknown, never
-- rewritten into a fabricated hash. New writers require a SHA-256 value.
--
-- Additive and independent from 0047: no measurement column is altered.

alter table qualification_runs
  add column if not exists content_hash text;
alter table qualification_runs
  add column if not exists source_run_id text references agent_runs(id) on delete set null;

alter table shadow_experiments
  add column if not exists content_hash text;
alter table shadow_experiments
  add column if not exists idempotency_key text;
alter table shadow_experiments
  add column if not exists qualification_run_id text references qualification_runs(id) on delete set null;
alter table shadow_experiments
  add column if not exists source_run_id text references agent_runs(id) on delete set null;
alter table shadow_experiments
  add column if not exists provider text;
alter table shadow_experiments
  add column if not exists model text;
alter table shadow_experiments
  add column if not exists cost_usd numeric;
alter table shadow_experiments
  add column if not exists version_verified boolean not null default false;

alter table replay_comparisons
  add column if not exists content_hash text;
alter table replay_comparisons
  add column if not exists idempotency_key text;
alter table replay_comparisons
  add column if not exists qualification_run_id text references qualification_runs(id) on delete set null;
alter table replay_comparisons
  add column if not exists provider text;
alter table replay_comparisons
  add column if not exists model text;
alter table replay_comparisons
  add column if not exists cost_usd numeric;
alter table replay_comparisons
  add column if not exists version_verified boolean not null default false;

alter table improvement_proposals
  add column if not exists content_hash text;
alter table improvement_proposals
  add column if not exists idempotency_key text;
alter table improvement_proposals
  add column if not exists source_run_id text references agent_runs(id) on delete set null;
alter table improvement_proposals
  add column if not exists qualification_run_id text references qualification_runs(id) on delete set null;
alter table improvement_proposals
  add column if not exists shadow_experiment_id text references shadow_experiments(id) on delete set null;
alter table improvement_proposals
  add column if not exists replay_comparison_id text references replay_comparisons(id) on delete set null;

-- Comparison producers also stamp the corpus they actually executed. Without
-- this, a V1/V2 delta cannot prove both run rows used the proposal corpus.
alter table test_runs
  add column if not exists content_hash text;
alter table benchmark_runs
  add column if not exists content_hash text;

alter table qualification_runs drop constraint if exists qualification_runs_content_hash_check;
alter table qualification_runs add constraint qualification_runs_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

alter table shadow_experiments drop constraint if exists shadow_experiments_content_hash_check;
alter table shadow_experiments add constraint shadow_experiments_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

alter table replay_comparisons drop constraint if exists replay_comparisons_content_hash_check;
alter table replay_comparisons add constraint replay_comparisons_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

alter table improvement_proposals drop constraint if exists improvement_proposals_content_hash_check;
alter table improvement_proposals add constraint improvement_proposals_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

alter table test_runs drop constraint if exists test_runs_content_hash_check;
alter table test_runs add constraint test_runs_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

alter table benchmark_runs drop constraint if exists benchmark_runs_content_hash_check;
alter table benchmark_runs add constraint benchmark_runs_content_hash_check
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

create unique index if not exists shadow_experiments_idempotency_key
  on shadow_experiments (copilot_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists replay_comparisons_idempotency_key
  on replay_comparisons (copilot_id, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists improvement_proposals_idempotency_key
  on improvement_proposals (copilot_id, idempotency_key)
  where idempotency_key is not null;

notify pgrst, 'reload schema';
