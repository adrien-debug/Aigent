/**
 * Setup for the live suite: load .env.local (same file `npm run dev` and
 * scripts/reprovision-assistants.ts read) into process.env BEFORE any live
 * test runs, using Node's native process.loadEnvFile (Node >=20.6) — no
 * dotenv dependency needed. If .env.local is absent, tests simply see
 * whatever env is already present (CI can export vars directly) and each
 * test's own probe (resolveLiveStack / hasBackendEnv) skips accordingly.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(__dirname, '../../.env.local')
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath)
  } catch {
    // Malformed .env.local — leave process.env as-is; tests will skip on
    // their own missing-config probes rather than crash the whole run.
  }
}
