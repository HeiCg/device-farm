---
estimated_steps: 4
estimated_files: 2
---

# T01: Add hook types and API client

**Slice:** S03 — Hooks Management UI
**Milestone:** M003

## Description

Add client-side TypeScript types for hooks and create the API client module. Types mirror the server's `HookDefinition`, `HookResult`, and `HookEvent` from `server/hooks/hook-executor.ts`. The API client wraps 5 existing backend endpoints following the project's `apiFetch` pattern (see `web/src/lib/api/devices.ts` for the pattern).

**Relevant skills:** `frontend-design` (if needed for pattern reference)

## Steps

1. Open `web/src/lib/api/types.ts` and add the following types at the bottom of the file:
   - `HookEvent` — string literal union: `'device.booted' | 'device.shutdown' | 'test.before' | 'test.after'`
   - `HookDefinition` — interface with fields: `name: string`, `event: HookEvent`, `command: string`, `platform: 'android' | 'ios' | 'all'`, `timeoutMs: number`, `failOnError: boolean`, `enabled: boolean`
   - `HookResult` — interface with fields: `hookName: string`, `event: HookEvent`, `command: string`, `exitCode: number | null`, `stdout: string`, `stderr: string`, `durationMs: number`, `success: boolean`, `error?: string`

2. Create `web/src/lib/api/hooks.ts` with these exported functions, each wrapping `apiFetch`:
   - `listHooks(): Promise<HookDefinition[]>` — `GET /api/hooks`
   - `createHook(hook: HookDefinition): Promise<HookDefinition>` — `POST /api/hooks` with JSON body
   - `updateHook(oldName: string, hook: HookDefinition): Promise<HookDefinition>` — `PUT /api/hooks/${oldName}` with JSON body. Note: the URL param is the **old** name (for lookup), the body contains the full hook (which may have a **new** name if the user renamed it).
   - `deleteHook(name: string): Promise<{ status: string; name: string }>` — `DELETE /api/hooks/${name}`
   - `testHook(name: string, deviceId?: string): Promise<HookResult>` — `POST /api/hooks/${name}/test` with optional `{ deviceId }` body

3. Ensure all imports use `.js` extensions (NodeNext resolution): `import { apiFetch } from './client.js'` and `import type { HookDefinition, HookResult } from './types.js'`.

4. Run `npm run web:build` to verify everything compiles.

## Must-Haves

- [ ] `HookEvent` type matches server's 4 event strings exactly
- [ ] `HookDefinition` interface fields match `server/hooks/hook-executor.ts` exactly (name, event, command, platform, timeoutMs, failOnError, enabled)
- [ ] `HookResult` interface fields match server exactly (hookName, event, command, exitCode, stdout, stderr, durationMs, success, error?)
- [ ] API client has 5 functions matching 5 server routes (correct HTTP methods, paths, and body shapes)
- [ ] `updateHook` accepts `oldName` as first param (goes in URL) and full `HookDefinition` as second param (goes in body)
- [ ] `testHook` sends `{ deviceId }` body only when deviceId is provided (otherwise empty body or `{}`)

## Verification

- `npm run web:build` passes with zero errors
- Compare function signatures in `hooks.ts` against route definitions in `server/hooks/plugin.ts` — methods, paths, and body shapes must match

## Inputs

- `web/src/lib/api/client.ts` — provides `apiFetch<T>()` wrapper with auth headers and RFC 7807 error handling
- `web/src/lib/api/types.ts` — existing types file where hook types are added
- `web/src/lib/api/devices.ts` — reference pattern for API client functions (thin wrappers around `apiFetch`)
- `server/hooks/hook-executor.ts` — source of truth for `HookDefinition`, `HookResult`, `HookEvent` (read-only reference)
- `server/hooks/plugin.ts` — source of truth for route signatures (read-only reference)

## Observability Impact

- **New inspection surface**: `web/src/lib/api/hooks.ts` — all 5 functions throw `ApiError` on failure, which includes `status`, `detail`, and `type` fields for debugging. Callers can catch and display these to the user.
- **Type safety signal**: `HookEvent`, `HookDefinition`, `HookResult` types in `types.ts` ensure compile-time validation that UI code matches server shapes. A mismatch surfaces as a TypeScript error in `npm run web:build`.
- **Failure visibility**: `testHook()` conditionally sends `{ deviceId }` body — if omitted, server uses a test context. A missing device returns 404 via `ApiError`. Network-level failures (timeouts, connection refused) propagate as standard `fetch` errors.
- **How to inspect**: Import any hook API function in browser console or Svelte component; call it and inspect the Promise result or thrown `ApiError`. Server-side logs (pino, component: `hook-executor`) show corresponding request handling.

## Expected Output

- `web/src/lib/api/types.ts` — updated with `HookEvent`, `HookDefinition`, `HookResult` types appended
- `web/src/lib/api/hooks.ts` — new file with 5 exported async functions wrapping the hooks API
