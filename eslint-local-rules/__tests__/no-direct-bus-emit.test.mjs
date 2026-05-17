// RuleTester exercises valid + invalid cases for `no-direct-bus-emit`.
// Valid cases rely on `filename:` to simulate the allowlist match; invalid
// cases use a production-path filename that does NOT match the allowlist.
//
// ESM `.mjs` is used so we can `import` from vitest v4, which cannot be
// required from CommonJS. The rule source itself is CJS (in
// eslint-local-rules/package.json `"type": "commonjs"`) and is loaded via
// createRequire below.
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../no-direct-bus-emit.js');

describe('no-direct-bus-emit', () => {
  it('rule test cases', () => {
    const tester = new RuleTester();
    tester.run('no-direct-bus-emit', rule, {
      valid: [
        // Module events.ts — the canonical emit helper home.
        { code: `bus.emit('x.y', {})`, filename: 'server/jobs/events.ts' },
        // Tests are allowed via `.spec.ts` / `.test.ts` extension (the
        // directory name alone is intentionally NOT allowlisted — see rule
        // source comment).
        {
          code: `bus.emit('x.y', {})`,
          filename: 'server/jobs/__tests__/foo.test.ts',
        },
        {
          code: `bus.emit('x.y', {})`,
          filename: 'server/jobs/service.spec.ts',
        },
        // Bus internals (defensive allowlist — these implement the bus
        // abstraction itself).
        { code: `bus.emit('x.y', {})`, filename: 'server/bus/bus.ts' },
        { code: `bus.emit('x.y', {})`, filename: 'server/bus/helpers.ts' },
        { code: `bus.emit('x.y', {})`, filename: 'server/bus/plugin.ts' },
      ],
      invalid: [
        // Plain module service file — forbidden.
        {
          code: `bus.emit('x.y', {})`,
          filename: 'server/jobs/service.ts',
          errors: [{ messageId: 'forbidden' }],
        },
        // fastify.bus.emit is also forbidden outside allowlist.
        {
          code: `fastify.bus.emit('x.y', {})`,
          filename: 'server/jobs/plugin.ts',
          errors: [{ messageId: 'forbidden' }],
        },
      ],
    });
  });
});
