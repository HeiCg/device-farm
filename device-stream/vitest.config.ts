import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['packages/**/tests/**/*.spec.ts', 'web-sdk/tests/**/*.spec.ts'],
    environmentMatchGlobs: [
      ['web-sdk/tests/**', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**/*.ts'],
    },
  },
});
