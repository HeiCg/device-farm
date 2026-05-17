import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // Phase 34 Plan 34-07: web sessions specs use `$lib/...` imports
      // (SvelteKit canonical) — root vitest needs the alias to resolve
      // them outside the Svelte/Vite build pipeline. Maps to
      // web/src/lib/ relative to this config file.
      $lib: fileURLToPath(new URL('./web/src/lib', import.meta.url)),
      '@sveltejs/kit': fileURLToPath(
        new URL('./web/src/lib/__test_stubs__/sveltekit-shim.ts', import.meta.url),
      ),
      // svelte lives in web/node_modules; root vitest can't resolve it
      // without help. We alias the public subpaths the SUT actually
      // imports so test runs from repo root succeed.
      'svelte/store': fileURLToPath(
        new URL('./web/node_modules/svelte/src/store/shared/index.js', import.meta.url),
      ),
    },
  },
  test: {
    include: [
      'server/**/__tests__/**/*.test.ts',
      'server/**/__tests__/**/*.spec.ts',
      'eslint-local-rules/__tests__/**/*.test.{js,mjs}',
      // Phase 17 Plan 17-05: web-side OpenAPI codegen smoke tests
      // (type-level assertions compiled by TS, executed by Vitest to
      // lock the schema surface against drift — see
      // web/src/lib/api/__tests__/generated-types.test.ts).
      'web/src/**/__tests__/**/*.test.ts',
      'web/src/**/__tests__/**/*.spec.ts',
      // Phase 17 Plan 17-08: contracts:check drift-detection spec
      // (verifies scripts/check-generated.sh fires non-zero when a
      // generated file is mutated or absent — see
      // scripts/__tests__/check-generated.spec.ts).
      'scripts/__tests__/**/*.test.ts',
      'scripts/__tests__/**/*.spec.ts',
    ],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['server/**/*.ts'],
      exclude: [
        'server/**/__tests__/**',
        'server/**/*.d.ts',
        'server/types/__tests__/ids.compile.ts',
      ],
    },
  },
});
