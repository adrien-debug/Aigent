#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const DB_NAME = 'aigent_local_proof'
const DB_USER = 'postgres'
const DB_PASSWORD = 'postgres'
const HOST_PORT = Number(process.env.AIGENT_LOCAL_PROOF_PORT ?? 55439)
const CONTAINER = `aigent-local-proof-${randomUUID().slice(0, 8)}`

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  })
  if (result.status !== 0) {
    const err = new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stderr || result.stdout}`
    )
    err.stdout = result.stdout
    err.stderr = result.stderr
    throw err
  }
  return result.stdout.trim()
}

function psql(sql, db = DB_NAME) {
  return run('psql', [
    `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${db}`,
    '-v',
    'ON_ERROR_STOP=1',
    '-t',
    '-A',
    '-c',
    sql,
  ])
}

function ensureDocker() {
  run('docker', ['--version'])
}

function startPostgres() {
  run('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    '-p',
    `${HOST_PORT}:5432`,
    'postgres:16-alpine',
  ])
}

function stopPostgres() {
  try {
    run('docker', ['rm', '-f', CONTAINER])
  } catch {
    // best-effort cleanup
  }
}

function waitForDatabase() {
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    try {
      psql('select 1', 'postgres')
      return
    } catch {
      // retry
    }
  }
  throw new Error('Postgres did not become ready within 60s')
}

function applyMigrations() {
  run('psql', [
    `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/postgres`,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end $$;`,
  ])

  run('psql', [
    `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/postgres`,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `create database ${DB_NAME};`,
  ])

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b))

  for (const file of files) {
    run('psql', [
      `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${HOST_PORT}/${DB_NAME}`,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      join(MIGRATIONS_DIR, file),
    ])
  }

  return files
}

function verifySchema() {
  const tableExists = psql(
    "select count(*) from information_schema.tables where table_schema='public' and table_name='consumer_installations';"
  )
  if (tableExists !== '1') {
    throw new Error('consumer_installations table is missing after migrations')
  }

  const columns = psql(
    "select column_name from information_schema.columns where table_schema='public' and table_name='consumer_installations' order by ordinal_position;"
  )
    .split('\n')
    .filter(Boolean)

  for (const required of ['version_id', 'delivery_event_id']) {
    if (!columns.includes(required)) {
      throw new Error(`consumer_installations.${required} is missing`)
    }
  }

  const telemetryColumns = psql(
    "select column_name from information_schema.columns where table_schema='public' and table_name='runtime_telemetry_events' order by ordinal_position;"
  )
    .split('\n')
    .filter(Boolean)
  if (!telemetryColumns.includes('version_verified')) {
    throw new Error('runtime_telemetry_events.version_verified is missing')
  }

  return { installationColumns: columns, telemetryColumns }
}

function runLifecycleFlow() {
  const now = new Date().toISOString()
  const token = 'local-proof-installation-token'
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')

  psql(`
    insert into projects (id, name, slug, description, platform, created_at)
    values ('proj-proof', 'Proof Project', 'proof-project', '', 'web', now());
  `)
  psql(`
    insert into copilots (
      id, project_id, name, slug, description, runtime, status, production_version_id,
      latest_version_id, model, model_provider, owner, tags, created_at, updated_at, health
    )
    values (
      'cop-proof', 'proj-proof', 'Proof Copilot', 'proof-copilot', '', 'langgraph', 'active',
      'v-proof', 'v-proof', 'gpt-test', 'openai', 'proof-owner', '{}', now(), now(), '{}'::jsonb
    );
  `)
  psql(`
    insert into copilot_versions (
      id, copilot_id, label, stage, manifest_id, model, model_provider, changelog, created_at, created_by, scores
    )
    values (
      'v-proof', 'cop-proof', 'v-proof', 'production', 'manifest-proof', 'gpt-test', 'openai', '', now(), 'proof', '{}'::jsonb
    );
  `)
  psql(`
    insert into agent_delivery_events (
      id, copilot_id, version_id, project_id, mode, target_repo, target_branch, delivery_branch, status
    )
    values (
      'deliv-proof', 'cop-proof', 'v-proof', 'proj-proof', 'pull_request', 'org/repo', 'main', 'aigent/proof', 'delivered'
    );
  `)

  // create installation (hash-only persistence, version+delivery linked)
  psql(`
    insert into consumer_installations (
      id, project_id, copilot_id, version_id, delivery_event_id,
      environment, label, token_hash, token_prefix, status
    )
    values (
      'inst-proof', 'proj-proof', 'cop-proof', 'v-proof', 'deliv-proof',
      'production', 'proof', '${tokenHash}', 'prooftok', 'active'
    );
  `)

  // telemetry accepted path with persisted proof
  psql(`
    insert into runtime_telemetry_events (
      id, project_id, agent_id, agent_version, version_id, version_verified, run_id,
      installation_id, event_type, provider, model, status, latency_ms,
      input_shape, output_shape, error, usage, environment, received_at, reported_at
    )
    values (
      'consumer:inst-proof:evt-1', 'proj-proof', 'cop-proof', 'v-proof', 'v-proof', true, 'run-proof-1',
      'inst-proof', 'consumer.run_completed', null, null, 'completed', 42,
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{"source":"consumer"}'::jsonb, '${now}', '${now}'
    );
  `)

  const recentExecutionCount = Number(
    psql(`
      select count(*)
      from runtime_telemetry_events
      where agent_id = 'cop-proof'
        and installation_id is not null
        and version_verified = true
        and event_type in ('consumer.run_started', 'consumer.run_completed', 'consumer.run_failed')
        and received_at >= now() - interval '7 days';
    `)
  )

  // revoke installation
  psql(`
    update consumer_installations
    set status = 'revoked', revoked_at = now(), revoked_reason = 'local-proof'
    where id = 'inst-proof';
  `)

  const activeInstallationRows = Number(
    psql(`
      select count(*)
      from consumer_installations
      where id = 'inst-proof' and status = 'active';
    `)
  )

  return {
    created: {
      projectId: 'proj-proof',
      copilotId: 'cop-proof',
      versionId: 'v-proof',
      deliveryEventId: 'deliv-proof',
      installationId: 'inst-proof',
    },
    telemetryInserted: true,
    activationDerivedFromVerifiedTelemetry: recentExecutionCount > 0,
    revoked: activeInstallationRows === 0,
  }
}

function main() {
  ensureDocker()
  startPostgres()
  try {
    waitForDatabase()
    const migrations = applyMigrations()
    const schema = verifySchema()
    const flow = runLifecycleFlow()

    console.log(
      JSON.stringify(
        {
          ok: true,
          database: { container: CONTAINER, port: HOST_PORT, db: DB_NAME },
          migrationsApplied: {
            count: migrations.length,
            first: basename(migrations[0] ?? ''),
            last: basename(migrations[migrations.length - 1] ?? ''),
          },
          checks: {
            consumerInstallationsTable: true,
            requiredInstallationColumns: ['version_id', 'delivery_event_id'],
            requiredTelemetryColumns: ['version_verified'],
          },
          flow,
          sample: {
            installationColumns: schema.installationColumns,
            telemetryColumns: schema.telemetryColumns,
          },
        },
        null,
        2
      )
    )
  } finally {
    stopPostgres()
  }
}

main()
