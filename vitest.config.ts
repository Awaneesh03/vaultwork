import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest keeps its own config file rather than a `test` block inside
 * vite.config.ts: Vitest 2 bundles its own copy of Vite, and the two Vite type
 * definitions do not unify. Separate files, no casts.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [
      ['src/**/*.dom.test.{ts,tsx}', 'jsdom'],
      ['tests/**/*.dom.test.{ts,tsx}', 'jsdom'],
    ],
    restoreMocks: true,
  },
})
