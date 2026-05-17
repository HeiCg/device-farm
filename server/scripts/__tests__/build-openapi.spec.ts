// server/scripts/__tests__/build-openapi.spec.ts
// Phase 17 Plan 17-00 — Wave 0 smoke test.
// Phase 17 Plan 17-03 — Source-level assertions locking the WS emit activation state.
//
// Asserts the script's SHAPE (exports, import-time soundness) without
// running buildApp(). Live boot tests come in 17-01 after fastify-zod-openapi
// + @fastify/swagger are wired into server/index.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as mod from '../build-openapi.js';

describe('server/scripts/build-openapi.ts', () => {
  it('exports a `main` async function', () => {
    expect(typeof mod.main).toBe('function');
    expect(mod.main.constructor.name).toBe('AsyncFunction');
  });
});

describe('build-openapi.ts source', () => {
  const source = readFileSync(resolve('server/scripts/build-openapi.ts'), 'utf8');

  it('imports wsMessageRegistry from contracts aggregator', () => {
    expect(source).toMatch(
      /import \{ wsMessageRegistry \} from '\.\.\/\.\.\/contracts\/ws-messages\.js';/,
    );
  });

  it('emits contracts/ws-messages.json via z.toJSONSchema', () => {
    expect(source).toContain('z.toJSONSchema(wsMessageRegistry');
    expect(source).toContain('writeFileSync(wsPath,');
    expect(source).toContain("resolve('contracts/ws-messages.json')");
  });

  it('has no unresolved TODO(17-02) markers', () => {
    expect(source).not.toContain('TODO(17-02)');
  });

  it('does not carry void z / void mkdirSync anchors', () => {
    expect(source).not.toContain('void z;');
    expect(source).not.toContain('void mkdirSync;');
  });
});
