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
    // Unit suite ONLY. The live suite (tests/live/**) hits GPU1 + OpenAI and
    // COSTS MONEY: it must never be picked up by a bare `npx vitest run`. It
    // has its own config — vitest.live.config.ts, wired to `npm run test:live`.
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
