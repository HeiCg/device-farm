// server/scripts/build-openapi.ts
// Phase 17 — Contracts build script.
//
// Run via: tsx server/scripts/build-openapi.ts  OR  npm run openapi:generate
//
// Emits two generated artifacts from the live Fastify app:
//   1. server/openapi.json       — OpenAPI 3.1 spec via @fastify/swagger
//   2. contracts/ws-messages.json — JSON Schema draft-2020-12 for all WS
//      variants, derived from the Zod registry in contracts/ws-messages.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { buildApp } from '../index.js';
import { wsMessageRegistry } from '../../contracts/ws-messages.js';

export async function main() {
  // 1) Boot Fastify with all plugins. NODE_ENV=contracts signals the config
  //    plugin (and checkDependencies helper) to skip side-effects like
  //    emulator boots — plan 17-01 wires that behavior.
  process.env.NODE_ENV = 'contracts';
  const app = await buildApp();
  await app.ready();  // REQUIRED before app.swagger() per RESEARCH §Pitfall 5

  // 2) Extract OpenAPI spec. After 17-01, fastify-zod-openapi + @fastify/swagger
  //    are registered and app.swagger() returns a populated OpenAPI 3.1 document.
  const spec = (app as unknown as { swagger: () => unknown }).swagger();

  // 3) Write OpenAPI JSON to the path CONTEXT locked (server/openapi.json).
  const openapiPath = resolve('server/openapi.json');
  writeFileSync(openapiPath, JSON.stringify(spec, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(`wrote ${openapiPath}`);

  // 4) Emit WS message JSON Schema via Zod 4 native toJSONSchema.
  const wsSchema = z.toJSONSchema(wsMessageRegistry, {
    target: 'draft-2020-12',
    unrepresentable: 'throw',
    reused: 'ref',
  });
  const wsPath = resolve('contracts/ws-messages.json');
  mkdirSync(resolve('contracts'), { recursive: true });
  writeFileSync(wsPath, JSON.stringify(wsSchema, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(`wrote ${wsPath}`);

  await app.close();
}

// Entry point — guarded so the file can be imported for testing without auto-running.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('build-openapi failed:', err);
    process.exit(1);
  });
}
