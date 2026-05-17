// ESLint 9 flat-config.
//
// Wires in the two custom local rules that enforce the v3.0 event-bus
// governance (EVENTS-03 + EVENTS-08):
//   - local-rules/no-imperative-event-names — bus.emit() string literals
//     must be noun.verbed past-tense dotted.
//   - local-rules/no-direct-bus-emit — bus.emit() is only allowed from
//     **/events.ts, test files, and the bus internals themselves.
//
// Run via `npm run lint` (see package.json scripts).
import localRules from 'eslint-plugin-local-rules';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  // `ignores` is a global key in flat-config (when it's the ONLY key in the
  // object). Exclude build artifacts + intentionally-invalid fixtures so
  // `npm run lint` on the whole tree stays green. Fixtures are still lint-able
  // with `npx eslint --no-ignore <path>` to prove the rules fire.
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'web/build/**',
      'web/.svelte-kit/**',
      'coverage/**',
      'eslint-local-rules/__tests__/fixtures/**',
    ],
  },
  // Main TypeScript surface — server code + rule fixtures (the latter are
  // normally excluded via `ignores` above, but the parser still needs to be
  // configured for them when running with `--no-ignore`).
  {
    files: ['server/**/*.ts', 'eslint-local-rules/__tests__/fixtures/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    linterOptions: {
      // Pre-existing `// eslint-disable-next-line no-console` directives in
      // spec files (written in prior plans, before ESLint was wired up) are
      // considered "unused" by this config because we do not enable the
      // `no-console` rule. Treat them as benign rather than warnings so
      // `npm run lint` output stays clean.
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'local-rules': localRules,
    },
    rules: {
      'local-rules/no-imperative-event-names': 'error',
      'local-rules/no-direct-bus-emit': 'error',
    },
  },
  // CommonJS rule source files (the .js ones — package.json declares
  // "type": "commonjs" inside eslint-local-rules/).
  {
    files: ['eslint-local-rules/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs' },
    rules: {},
  },
  // ESM test files (.mjs) — vitest v4 cannot be require()'d, so the
  // RuleTester specs must be ESM.
  {
    files: ['eslint-local-rules/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {},
  },
];
