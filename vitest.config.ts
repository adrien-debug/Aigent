import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Agent Mission Control — vitest config.
 *
 * ONE config, TWO suites, run separately by npm script (see package.json):
 *   - `tests/unit/**`  — pure, offline, no network, no servers required.
 *     `npm test` runs ONLY this (via the `exclude` below staying out of the
 *     way and CI/local devs invoking `vitest run tests/unit`).
 *   - `tests/live/**`  — hits the real `npm run dev` stack (Next on :3000/:3001,
 *     LangGraph Agent Server on :2024) and the real gpu1 PostgREST backend +
 *     OpenAI. Opt-in only (`npm run test:live`), costs real money per run, and
 *     each live test self-skips (not fails) when the stack isn't reachable.
 *
 * `resolve.conditions: ['react-server', ...]` mirrors the exact flag the repo
 * already uses to run TS outside Next's RSC bundler (see the `reprovision`
 * script: `tsx --conditions=react-server`). Source files import the
 * `server-only` marker package, whose `package.json#exports` maps the
 * `react-server` condition to a no-op (`empty.js`) instead of the
 * throwing `index.js`. Without this condition, importing any server-only
 * module here throws at import time.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Order matters: vitest/vite prepend their own conditions, but listing
    // 'react-server' here ensures the server-only package resolves to its
    // no-op export instead of throwing.
    conditions: ['react-server', 'node', 'import', 'default'],
  },
  // Vitest runs test files through Vite's SSR pipeline, which resolves
  // deps via `ssr.resolve` — NOT the top-level `resolve` above. Without this,
  // `server-only` still resolves to its throwing `index.js` even though
  // `resolve.conditions` lists 'react-server' (that only affects client-graph
  // resolution). Mirrors the exact fix for the same class of issue Next.js's
  // own RSC bundler and the repo's `tsx --conditions=react-server` both apply.
  ssr: {
    resolve: {
      conditions: ['react-server', 'node', 'import', 'default'],
    },
  },
  test: {
    environment: 'node',
    globals: false,
    // Both suites are declared here; which one runs is decided by the CLI
    // path argument in package.json's `test` / `test:live` scripts, not by
    // this `include` (kept broad so `vitest run tests/unit/x.test.ts` style
    // single-file runs still work during development).
    include: ['tests/**/*.test.ts'],
    // Loads .env.local (if present) so tests/live/** sees the same
    // AMC_SUPABASE_URL / AMC_API_KEY / etc. `npm run dev` uses. Harmless for
    // tests/unit/**: those tests are pure and never read these vars.
    setupFiles: ['tests/live/setup.ts'],
    // Live tests self-skip via runtime probes (see tests/live/helpers.ts);
    // this timeout only raises vitest's own per-test ceiling so a real
    // OpenAI + GitHub round trip doesn't get killed by the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
