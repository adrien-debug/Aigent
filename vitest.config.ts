import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Agent Mission Control — vitest config.
 *
 * TWO projects, run together via `npm test` / `npm run test:live`:
 *   - `unit` — pure server tests (node). Uses `react-server` resolve conditions
 *     so `server-only` imports resolve to the no-op export (same as
 *     `tsx --conditions=react-server`).
 *   - `components` — dashboard RTL smoke (happy-dom). Uses browser conditions
 *     so `react-dom/client` and `react-dom/server` resolve to real builds, not
 *     the RSC stubs.
 *
 * Live tests (`tests/live/**`) live in the `unit` project and self-skip when the
 * dev stack is down unless `LIVE_REQUIRED=1`.
 */
const alias = {
  '@': path.resolve(__dirname, './src'),
}

const serverConditions = ['react-server', 'node', 'import', 'default'] as const
const clientConditions = ['browser', 'node', 'import', 'default'] as const

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
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts', 'tests/live/**/*.test.ts'],
          environment: 'node',
          globals: false,
          setupFiles: ['tests/live/setup.ts'],
        },
      },
      {
        resolve: {
          alias: {
            ...alias,
            'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client.js'),
            'react-dom/server': path.resolve(__dirname, 'node_modules/react-dom/server.node.js'),
          },
          conditions: [...clientConditions],
        },
        ssr: {
          resolve: {
            conditions: [...clientConditions],
          },
        },
        test: {
          name: 'components',
          include: ['tests/unit/**/*.test.tsx'],
          environment: 'happy-dom',
          globals: false,
          setupFiles: ['tests/unit/setup-dom.ts'],
        },
      },
    ],
  },
})
