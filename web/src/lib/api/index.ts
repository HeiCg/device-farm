// web/src/lib/api/index.ts — barrel for web API types.
//
// generated-types.ts is emitted by openapi-typescript from server/openapi.json.
// Regenerate via `npm run web:types` at repo root. Do not hand-edit.
//
// Usage:
//   import type { components, paths } from '$lib/api';
//   type Hook = components['schemas']['Hook'];
//   type CreateHookResponse = paths['/api/hooks']['post']['responses']['201']['content']['application/json'];
//
// Phase 29 will add a runtime openapi-fetch client alongside these type-only re-exports.
export type { components, paths, operations } from './generated-types.js';
