-- 0046_consumer_installation_version_verification
--
-- Purpose:
-- 1) Bind each consumer installation to the exact copilot version and delivery
--    event it is allowed to report for.
-- 2) Mark runtime telemetry rows with a persisted version-verification verdict
--    so activation reads can require proven delivery/version alignment.
--
-- Additive, non-destructive, idempotent.

alter table consumer_installations
  add column if not exists version_id text references copilot_versions(id) on delete set null;

alter table consumer_installations
  add column if not exists delivery_event_id text references agent_delivery_events(id) on delete set null;

alter table consumer_installations
  add column if not exists revoked_reason text;

create index if not exists consumer_installations_version_idx
  on consumer_installations (version_id);

create index if not exists consumer_installations_delivery_event_idx
  on consumer_installations (delivery_event_id);

alter table runtime_telemetry_events
  add column if not exists version_verified boolean not null default false;

create index if not exists runtime_telemetry_events_verified_consumer_idx
  on runtime_telemetry_events (agent_id, received_at desc)
  where installation_id is not null and version_verified = true;

notify pgrst, 'reload schema';
