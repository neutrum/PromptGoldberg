import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/server/test/**/*.test.ts'],
    // Physics runs share the CPU when the whole suite runs in parallel; 5 s is too tight for them.
    testTimeout: 20_000,
  },
});
