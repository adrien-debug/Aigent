import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Agent Mission Control — vitest config for the LIVE suite ONLY.
 *
 * The live suite talks to GPU1 (PostgREST) and to real model providers: it
 * costs money and requires credentials. It is deliberately kept OUT of the
 * default config (vitest.config.ts) so that a bare `npx vitest run` — with no
 * path argument — can never launch it. Reaching these tests requires opting in
 * explicitly through `npm run test:live`, which points at this file.
 */
const alias = {
  '@': path.resolve(__dirname, './src'),
}

const serverConditions = ['react-server', 'node', 'import', 'default'] as const

export default defineConfig({
  resolve: {
    alias,
    conditions: [...serverConditions],
  },
  ssr: {
    resolve: {
      conditions: [...serverConditions],
    },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Loads .env.local so the live probes find real credentials.
    setupFiles: ['tests/live/setup.ts'],
  },
})
