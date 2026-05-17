# ADR-002: Repo-wide File-Naming Convention

## Status

Accepted — 2026-04-17. Supersedes nothing; establishes convention referenced by ADR-001 Pillar 5.

## Context

ADR-001 locked the v3.0 module shape (`MODULE.md`, `index.ts` barrel, `events.ts`, `queue.ts`, `schemas.ts`, factory `createXModule(deps)`). As Phase 16 pilots the pattern on `server/hooks/` and Phases 20–30 replicate it across every server module, the file-naming rule MUST be locked now — otherwise each module adopts its own spelling (`hookDefinition.ts` vs `hook-definition.ts` vs `HookDefinition.ts`) and LLM agents can't read the tree without walking every directory.

The rule needs to cover: casing (kebab vs camel vs Pascal), singular vs plural, co-location of tests, reserved module filenames, and `.spec.ts` vs sibling-folder conventions.

## Decision

### Casing

- **Filenames** are `kebab-case`: `hook-executor.ts`, not `hookExecutor.ts` or `HookExecutor.ts`.
- **Exports from inside** filenames use whatever TS convention applies (Pascal for classes/types, camel for values).

### Singular vs Plural

- **Singular for concepts** (one thing the file describes): `envelope.ts`, `hook-executor.ts`.
  - Exception: `schemas.ts` is plural by historical convention (the file hosts multiple Zod schemas). This is the ONLY plural "concept" file. Everything else follows singular-for-concepts.
- **Plural for collectors** (the file aggregates multiple instances of a thing): `handlers.ts`, `subscribers.ts`, `migrations/`.

### Reserved Module Filenames

Within any `server/<module>/` directory, the following filenames have reserved meaning:

- `index.ts` — barrel. Exports only the public API. Deep imports into the module from outside `server/<module>/` forbidden by `dependency-cruiser`.
- `MODULE.md` — LLM-first contract. Fixed sections per MOD-01.
- `events.ts` — Zod schemas + emit helpers + event-name constants. The ONLY legitimate caller of `bus.emit(...)` (enforced by ESLint `no-direct-bus-emit`).
- `queue.ts` — pg-boss queue(s) the module produces or consumes.
- `schemas.ts` — Zod source of truth for the module's public types.
- `plugin.ts` — Fastify plugin thin wrapper (factory output + decorate + onClose).

### Test Co-location

- **Colocated `__tests__/` directories**, not sibling `.test.ts` / `.spec.ts` files: `server/hooks/__tests__/hook-executor.spec.ts`, not `server/hooks/hook-executor.spec.ts`.
- Extension is `.spec.ts` (matches existing `server/bus/__tests__/`, `server/queue/__tests__/`, etc.).
- Test files may aggregate by behavior (e.g., `events.spec.ts` covers the module's event emission surface) — they don't need 1:1 correspondence with source files (MOD-04, enforced Phase 30).

### Module-Private Code

- Code the module doesn't re-export from `index.ts` lives under `server/<module>/internal/`.
- The `internal/` directory name is the `dependency-cruiser` denylist scope (Phase 16 onward).

## Consequences

### Positive

- LLM agents can navigate the tree by filename alone (`MODULE.md` always the contract, `events.ts` always the emit surface, etc.).
- Deep-import violations fail CI before review.
- Refactors don't require directory-walks to find "where does this module define its events?"

### Negative

- One-time rename cost per existing module during its refactor phase (the old `hooks-plugin` becomes `hooks/plugin.ts` — naming constant; internal file `hook-executor.ts` moves to `internal/hook-executor.ts`).
- `schemas.ts` is the one plural-named concept file; deviates from the "singular for concepts" rule. Accepted cost for historical clarity.

### Out of Scope

- Directory structure BEYOND the reserved filenames — modules may create `helpers/`, `adapters/`, etc. under `internal/` at their discretion.
- Typescript symbol naming (class vs interface vs type casing) — governed by TS convention + existing `@typescript-eslint` config.

### References

- ADR-001: v3.0 Spec-Driven + Event-Driven Architecture (Pillar 5 — LLM-first modules)
- MOD-01 through MOD-06 in `.planning/REQUIREMENTS.md`
