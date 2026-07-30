import path from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Agent Mission Control — vitest config (backend / unit only after frontend reset).
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
    include: ['tests/unit/**/*.test.ts', 'tests/live/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['tests/live/setup.ts'],
  },
})
