// RuleTester exercises valid + invalid cases for `no-imperative-event-names`.
// Wrapped in describe/it because vitest treats any thrown error at
// module-import time as an unhandled failure — wrapping gives us proper
// test reporting.
//
// ESM `.mjs` is used so we can `import` from vitest v4, which cannot be
// required from CommonJS. The rule source itself is CJS (in
// eslint-local-rules/package.json `"type": "commonjs"`) and is loaded via
// createRequire below.
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rule = require('../no-imperative-event-names.js');

describe('no-imperative-event-names', () => {
  it('rule test cases', () => {
    const tester = new RuleTester();
    tester.run('no-imperative-event-names', rule, {
      valid: [
        // Past-tense dotted — the canonical shape.
        `bus.emit('job.completed', {})`,
        `bus.emit('device.booted', {})`,
        `bus.emit('artifact.created', {})`,
        // fastify.bus.emit path works identically.
        `fastify.bus.emit('job.completed', {})`,
        // Non-bus emitters with malformed strings MUST NOT trigger the rule
        // (it is scoped to bus.emit only — see rule doc comment).
        `this.emit('stateChange', {})`,
        `broadcaster.emit('job-1', {})`,
        `proc.emit('exit', 0)`,
      ],
      invalid: [
        {
          code: `bus.emit('job.create', {})`,
          errors: [{ messageId: 'imperative' }],
        },
        {
          code: `bus.emit('JobCompleted', {})`,
          errors: [{ messageId: 'malformed' }],
        },
        {
          code: `bus.emit('job', {})`,
          errors: [{ messageId: 'malformed' }],
        },
        // Imperative last-segment verbs (update, delete, run, ...).
        {
          code: `bus.emit('device.start', {})`,
          errors: [{ messageId: 'imperative' }],
        },
        // fastify.bus.emit path is also linted.
        {
          code: `fastify.bus.emit('job.update', {})`,
          errors: [{ messageId: 'imperative' }],
        },
      ],
    });
  });
});
