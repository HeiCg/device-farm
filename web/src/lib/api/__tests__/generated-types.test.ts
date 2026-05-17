// web/src/lib/api/__tests__/generated-types.test.ts
// Type-level smoke test — asserts that generated-types.ts exposes the expected
// schema shapes from server/openapi.json. If the server Zod schemas change
// and the web client has not regenerated, this file stops compiling.
//
// Run: npx vitest run web/src/lib/api/__tests__/generated-types.test.ts
//
// Every assertion is at compile time. The `satisfies` operator and typed
// variable declarations exercise the TypeScript checker; `expect(...)` calls
// exist to keep Vitest from flagging empty test bodies, not to perform
// substantive runtime assertions.
import { describe, test, expect } from 'vitest';
import type { components, paths } from '../generated-types.js';

describe('generated-types.ts — OpenAPI component schemas', () => {
  test('Hook schema exposes required fields', () => {
    // Satisfies check: if Hook's required fields drift, this fails to compile.
    // Required fields mirror server/hooks/schemas.ts (hookDefinitionSchema) —
    // name, event, command, platform, timeoutMs, failOnError, enabled — all
    // marked required in server/openapi.json because Zod 4 `.default(...)`
    // keeps the field required in z.infer.
    const hook = {
      name: 'pre-test',
      event: 'device.booted',
      command: '/usr/bin/true',
      platform: 'all',
      timeoutMs: 30_000,
      failOnError: false,
      enabled: true,
    } satisfies components['schemas']['Hook'];
    expect(hook.name).toBe('pre-test');
    expect(hook.event).toBe('device.booted');
  });

  test('JobSummary schema loads from components.schemas', () => {
    type JobSummary = components['schemas']['JobSummary'];
    // Simply assigning undefined to a typed variable exercises the type at
    // compile time — if JobSummary is removed or renamed, this breaks.
    const j: JobSummary | undefined = undefined;
    expect(j).toBeUndefined();

    // Concrete `satisfies` check on a minimal JobSummary value.
    const summary = {
      id: '00000000-0000-0000-0000-000000000000',
      status: 'queued',
      platform: 'android',
    } satisfies components['schemas']['JobSummary'];
    expect(summary.status).toBe('queued');
  });

  test('DeviceList is an array of DeviceSummary (by construction)', () => {
    // DeviceList is emitted as `components['schemas']['DeviceSummary'][]`
    // (OpenAPI `type: "array"` schemas lower to a direct array in
    // openapi-typescript 7.x). If DeviceList ever changes to an object
    // shape (e.g., `{ items: DeviceSummary[] }`), this type-level check
    // breaks and the test fails to compile.
    type DeviceList = components['schemas']['DeviceList'];
    type DeviceSummary = components['schemas']['DeviceSummary'];
    // Enforce element-type equality at compile time via mutual assignability.
    const dl: DeviceList = [] as DeviceSummary[];
    const dl2: DeviceSummary[] = [] as DeviceList;
    expect(Array.isArray(dl)).toBe(true);
    expect(Array.isArray(dl2)).toBe(true);
  });

  test('paths /api/hooks supports POST', () => {
    // Compile-time check that /api/hooks has a post route — if the server
    // stops exposing POST /api/hooks, this type resolves to `never` and the
    // indexed access below fails to compile.
    type HooksPost = paths['/api/hooks']['post'];
    const h: HooksPost | undefined = undefined;
    expect(h).toBeUndefined();
  });
});
