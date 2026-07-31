-- 0045_consumer_installations — per-installation identity for the consumer
-- feedback channel (the create → qualify → ship → telemetry → improve loop).
--
-- WHY A FOURTH IDENTITY
-- Aigent already has three trust boundaries, each with its OWN token value:
--   /api/agent-ops/**        operator session cookie or AMC_API_KEY
--   /api/runtime-telemetry   AIGENT_RUNTIME_TELEMETRY_TOKEN (one shared value)
--   /api/runtime/v1/**       AIGENT_RUNTIME_API_TOKEN
-- A shared telemetry token cannot answer "WHICH consumer installation reported
-- this?" — every caller presents the same bytes, so any installation could
-- forge another's events and `active_in_consumer` could never be proven from an
-- authenticated source. This table gives each consumer installation/environment
-- its own credential, so a consumer event carries a verified identity.
--
-- TOKENS ARE NEVER STORED IN CLEAR TEXT.
-- `token_hash` holds a SHA-256 hex digest of the token. Aigent can VERIFY a
-- presented token (hash it, compare) but can never reproduce or leak one — a
-- dump of this table yields no usable credential. `token_prefix` is a short,
-- non-secret leading fragment kept ONLY so an operator can tell two rows apart
-- in a UI without unmasking anything.
--
-- Additive + idempotent. NOT APPLIED to the live database by this mission.

create table if not exists consumer_installations (
  -- Caller-visible identity, echoed in every consumer telemetry event.
  id text primary key,

  -- Which copilot this installation is allowed to report for. FK to copilots so
  -- an installation cannot outlive its agent. Consumer events naming any other
  -- copilot are rejected at the route (an installation speaks only for itself).
  copilot_id text not null references copilots(id) on delete cascade,

  -- Consumer-side deployment slot. Two environments of the same consumer are
  -- two installations with two distinct tokens — a staging leak never grants
  -- production reporting.
  environment text not null check (environment in ('production', 'staging', 'development')),

  -- Human label for operators (consumer/workspace name). Never a secret.
  label text,

  -- SHA-256 hex of the installation token. 64 lowercase hex chars, enforced.
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),

  -- Short non-secret fragment for operator disambiguation only.
  token_prefix text,

  -- Fail-closed switch: a revoked installation authenticates no further events.
  -- Revocation NEVER deletes past events — history stays truthful.
  status text not null default 'active' check (status in ('active', 'revoked')),

  created_at timestamptz not null default now(),
  revoked_at timestamptz,

  -- Last authenticated contact. Written ONLY after a successful token check, so
  -- it is evidence, not a guess. Null means: never observed. Never coerce to 0
  -- or to a date — an absent observation stays absent.
  last_seen_at timestamptz,

  -- Version identifier the consumer last reported having LOADED. Null until a
  -- consumer.version_loaded event proves it. Aigent never infers this from a
  -- delivery: pushing a version does not prove the consumer loaded it.
  last_version_loaded text,
  last_version_loaded_at timestamptz
);

-- One installation per (copilot, environment, label) — re-running provisioning
-- must not silently mint duplicate credentials for the same slot.
create unique index if not exists consumer_installations_slot_idx
  on consumer_installations (copilot_id, environment, coalesce(label, ''));

-- Authentication lookup path: presented token -> hash -> row.
create unique index if not exists consumer_installations_token_hash_idx
  on consumer_installations (token_hash);

create index if not exists consumer_installations_copilot_idx
  on consumer_installations (copilot_id, status);

-- ── Consumer provenance on the telemetry table ──────────────────────────────
--
-- Consumer events live in the SAME table as internal ones (AGENTS.md: "une
-- seule table, runtime_telemetry_events"). These columns record WHO reported,
-- and are written ONLY by the authenticated consumer route — an internal
-- emitter leaves them null, so `installation_id is not null` is exactly the
-- set of events proven to come from an authenticated consumer.

alter table runtime_telemetry_events
  add column if not exists installation_id text references consumer_installations(id) on delete set null;

alter table runtime_telemetry_events
  add column if not exists version_id text;

comment on column runtime_telemetry_events.installation_id is
  'Authenticated consumer installation that reported this event. NULL for internal '
  'emitters (aigent-internal-runner/shadow/replay/promotion). Non-null is proof of '
  'an authenticated consumer report — it is the only basis for active_in_consumer.';

comment on column runtime_telemetry_events.version_id is
  'Copilot version the consumer reported running. NULL when not reported; never guessed.';

-- Recency scan for the activation read: newest authenticated consumer event
-- per copilot.
create index if not exists runtime_telemetry_events_installation_idx
  on runtime_telemetry_events (installation_id, received_at desc)
  where installation_id is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- BOTH gestures, always. PostgREST answers the public internet as `anon`;
-- migrations 0010/0012 granted without enabling RLS and two tables really did
-- serve their contents publicly (documented in 0044). A grant alone is a leak.
-- No policy is defined on purpose: deny-by-default is the goal, and only
-- service_role (which bypasses RLS) may read or write this table.
alter table consumer_installations enable row level security;
grant select, insert, update, delete on consumer_installations to service_role;

notify pgrst, 'reload schema';
