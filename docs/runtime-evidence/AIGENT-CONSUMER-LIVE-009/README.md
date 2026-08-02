# AIGENT-CONSUMER-LIVE-009 - Runtime evidence

- UTC window: `2026-08-02T09:36:00Z` to `2026-08-02T09:41:00Z`
- Branch: `feat/aigent-consumer-live-009`
- Commit SHA: `2b117b097a17aa4eea4c3a93909b28adce9ad33c`
- Migration file: `supabase/migrations/0046_consumer_installation_version_verification.sql`
- Target (masked):
  - `host=<masked>`
  - `database=<masked>`
  - `user=<masked>`

## Files

- `pre-migration-schema.json`: read-only snapshot before migration
- `post-migration-schema.json`: read-only snapshot after migration
- `migration-run.json`: first pass + idempotence pass outcomes
- `live-proof.json`: canonical route live flow (create/list/telemetry/revoke)
- `negative-cases.json`: required fail-closed negative checks
- `cleanup.json`: proof data cleanup/conservation decision

## Secret handling

- No token value is persisted here.
- No private URL/connection string is persisted here.
- Only non-sensitive IDs and masked target metadata are included.
