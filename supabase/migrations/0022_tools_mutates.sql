-- 0022_tools_mutates.sql — structural "does this tool mutate state?" flag.
--
-- WHY: the "risky tool ⇒ requiresConfirmation" invariant currently rests on a
-- ~30-verb English regex over `name || description` (authoring-writes.ts),
-- because no column ever said whether a tool writes. That heuristic is wrong in
-- both directions: it refuses `submit_report` / `execute_query` (a SELECT) with
-- no escape hatch for the author, and it waves through a genuinely mutating
-- `sync_ledger` or any non-English name. This column makes the fact explicit
-- and turns the regex back into what it always was — an authoring suggestion.
--
-- DEFAULT true = FAIL-CLOSED: every row that exists today, and every future
-- insert that omits the field, is presumed mutating. Downgrading a tool to
-- mutates=false is an explicit, auditable act by its author.
--
-- APPLIED 2026-07-20 against the live `aigent` database on gpu1 (column present,
-- not null, default true). Additive + idempotent, safe to re-run.

alter table tools add column if not exists mutates boolean not null default true;

comment on column tools.mutates is
  'True when the tool writes, sends, publishes or spends anything. Fail-closed default: true. Combined with risk_level to require confirmation.';

-- Rollback (this repo keeps no .down.sql files; kept here as documentation):
--   alter table tools drop column if exists mutates;
