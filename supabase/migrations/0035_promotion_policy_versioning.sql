-- AIGENT-FACTORY-SHADOW-REPLAY-001 — promotion policy evolution: new copilots
-- require shadow+replay proof by default; historical copilots keep today's
-- lenient default. See promotion-policy.ts for the compatibility rule this
-- column backs (this comment documents the DB side only).
--
-- WHY A COLUMN, NOT A DATE HEURISTIC: "any copilot created after 2026-07-25
-- requires shadow+replay" is fragile — a backfill script, a restored row, or a
-- clock skew all silently change what a copilot requires with no record of the
-- decision. An explicit nullable boolean is a durable, inspectable signal that
-- is set ONCE at creation time and never inferred from created_at again.
--
-- NULL is the state for every EXISTING (pre-cutover) copilot — it means "no
-- explicit policy was recorded for this copilot", NOT "does not require
-- shadow/replay". The application resolver (promotion-policy.ts) treats NULL
-- as a distinct, INTENTIONAL compatibility case: historical copilots existed
-- before shadow/replay evidence was ever collectible, so requiring it for them
-- retroactively would brick every existing promotion path with a fabricated
-- new obligation nobody could have satisfied. That is the ONE place "fail-open"
-- is deliberate, and it is documented in code, not silent.
--
-- Every NEW copilot (created via createCopilotFromManifest after this
-- migration ships) gets requires_shadow_replay=true explicitly at INSERT time
-- — never left NULL. NULL will therefore only ever describe a pre-cutover row.
-- If a bug ever leaves a NEW copilot's column NULL, the resolver's fail-closed
-- rule (see promotion-policy.ts) treats an UNDETERMINABLE case as requiring
-- evidence — i.e. any future ambiguity resolves to MORE strict, never less.
--
-- Additive + idempotent. Ends with a schema reload.

alter table copilots add column if not exists requires_shadow_replay boolean;

comment on column copilots.requires_shadow_replay is
  'Nullable promotion-policy signal. NULL = pre-cutover copilot (historical, lenient default intentionally preserved). true = shadow+replay evidence mandatory before promotion (every copilot created after AIGENT-FACTORY-SHADOW-REPLAY-001). false is reserved for a future explicit opt-out and is never set automatically. See src/lib/agent-mission-control/promotion-policy.ts for the resolver.';

notify pgrst, 'reload schema';
