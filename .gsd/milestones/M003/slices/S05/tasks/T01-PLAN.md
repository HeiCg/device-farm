---
estimated_steps: 5
estimated_files: 3
---

# T01: Build MaestroOptionsPanel and wire into job detail

**Slice:** S05 — Maestro Options & Debug Artifacts
**Milestone:** M003

## Description

Create a `MaestroOptionsPanel` component that extracts known Maestro execution option keys from a job's `metadata` jsonb field and displays them in a styled card. Wire it into the job detail page below the header and above the tabs. The panel must gracefully render nothing when no Maestro options are present.

The `job.metadata` field is `Record<string, unknown> | null` — it may contain arbitrary CI metadata. The panel defensively extracts known Maestro keys: `includeTags`, `excludeTags`, `reportFormat`, `debugOutput`, `shards`. Type guards are necessary since these keys may not exist.

**Design system notes:** The project uses a "Kinetic Console" dark theme with glass cards, ghost borders, and tonal layering. Follow the patterns in existing job detail components (MetricsPanel, StepList). Use static Tailwind class strings in Record lookups (D016 — no dynamic interpolation). Use `$derived` for reactive computations (D017). Svelte 5 runes — `$props()`, `$state`, `$derived` — no legacy `export let`.

**Relevant skill:** `frontend-design` — load this skill for design system guidance.

## Steps

1. **Add `MaestroOptions` type and `extractMaestroOptions` helper to `web/src/lib/api/types.ts`:**
   ```typescript
   export interface MaestroOptions {
     includeTags: string[];
     excludeTags: string[];
     reportFormat: string | null;
     debugOutput: boolean;
     shards: number | null;
   }

   export function extractMaestroOptions(metadata: Record<string, unknown> | null): MaestroOptions | null {
     if (!metadata) return null;
     const includeTags = Array.isArray(metadata.includeTags) ? metadata.includeTags.filter((t): t is string => typeof t === 'string') : [];
     const excludeTags = Array.isArray(metadata.excludeTags) ? metadata.excludeTags.filter((t): t is string => typeof t === 'string') : [];
     const reportFormat = typeof metadata.reportFormat === 'string' ? metadata.reportFormat : null;
     const debugOutput = metadata.debugOutput === true;
     const shards = typeof metadata.shards === 'number' ? metadata.shards : null;
     // Return null if nothing is populated
     if (includeTags.length === 0 && excludeTags.length === 0 && !reportFormat && !debugOutput && shards === null) {
       return null;
     }
     return { includeTags, excludeTags, reportFormat, debugOutput, shards };
   }
   ```

2. **Create `web/src/lib/components/jobs/MaestroOptionsPanel.svelte`:**
   - Accept `let { options }: { options: MaestroOptions | null } = $props();`
   - If `options` is null, render nothing (empty fragment or return early with `{#if options}` guard)
   - Render a card with the same styling as MetricsPanel (glass border, bg-surface-container-low, bg-surface-container-high header bar)
   - Header: icon (tune or settings) + "Maestro Options" title
   - Body grid with option rows:
     - **Tags (include):** Show each tag as a small pill/chip with `bg-secondary/10 text-secondary` styling. Show nothing if empty.
     - **Tags (exclude):** Show each tag as a pill/chip with `bg-tertiary/10 text-tertiary` styling. Show nothing if empty.
     - **Report Format:** Show the format string (e.g., "junit", "html") as text. Show nothing if null.
     - **Debug Output:** Show "Enabled" / chip only when `debugOutput === true`.
     - **Shards:** Show the count when non-null.
   - Use static Tailwind classes in Record lookups — NO template interpolation (D016).

3. **Wire MaestroOptionsPanel into `web/src/routes/jobs/[id]/+page.svelte`:**
   - Add imports: `import MaestroOptionsPanel from '$lib/components/jobs/MaestroOptionsPanel.svelte'` and `import { extractMaestroOptions } from '$lib/api/types.js'` (add `extractMaestroOptions` to the existing type imports, use `type` import for `MaestroOptions` if needed separately).
   - Add a `$derived` variable: `let maestroOptions = $derived(extractMaestroOptions(job?.metadata ?? null));`
   - Render `<MaestroOptionsPanel options={maestroOptions} />` below the header div (after the closing `</div>` of the border-b header section) and before the tabs div. Add a `mb-6` margin if needed for spacing.

4. **Verify:** Run `cd web && npx svelte-check --tsconfig ./tsconfig.json` — must produce zero errors.

5. **Verify:** Run `npm run web:build` — must complete successfully.

## Must-Haves

- [ ] `MaestroOptions` interface and `extractMaestroOptions()` function added to `web/src/lib/api/types.ts`
- [ ] `extractMaestroOptions` returns null when metadata has no Maestro keys — panel renders nothing
- [ ] `MaestroOptionsPanel.svelte` renders include/exclude tags as colored pills, format/debug/shards as labeled values
- [ ] Panel uses static Tailwind class strings (D016), `$derived` for reactivity (D017), Svelte 5 runes
- [ ] Panel is rendered in job detail page between header and tabs
- [ ] `svelte-check` and `web:build` pass cleanly

## Verification

- `cd web && npx svelte-check --tsconfig ./tsconfig.json` — zero errors
- `npm run web:build` — zero errors

## Inputs

- `web/src/routes/jobs/[id]/+page.svelte` — existing job detail page with header → tabs → content structure
- `web/src/lib/api/types.ts` — existing types file with `Job`, `Artifact`, `JobStep` interfaces
- `web/src/lib/components/jobs/MetricsPanel.svelte` — reference for glass card styling pattern (border-l-2, bg-surface-container-low/high)
- `web/src/lib/components/jobs/StepList.svelte` — reference for chip/pill styling and static class Record pattern

## Observability Impact

- **New inspection surface:** `extractMaestroOptions()` is a pure function — testable in isolation by passing a mock `metadata` object. Returns `null` when no Maestro keys are set, making the conditional rendering deterministic.
- **How to inspect:** On any job detail page, the MaestroOptionsPanel DOM node (card with "Maestro Options" heading) is present only when the job's metadata has at least one Maestro key. Absence = correct no-op.
- **Failure state:** If the panel renders with empty/wrong data, check `GET /api/jobs/:id` → `metadata` field. The extraction logic uses explicit type guards — type mismatches (e.g., `includeTags` is a string instead of array) are silently skipped, which is intentional defensive behavior.
- **No backend changes:** This task is UI-only; no new API endpoints, logs, or metrics are introduced.

## Expected Output

- `web/src/lib/api/types.ts` — augmented with `MaestroOptions` interface and `extractMaestroOptions()` function
- `web/src/lib/components/jobs/MaestroOptionsPanel.svelte` — new component rendering Maestro execution options
- `web/src/routes/jobs/[id]/+page.svelte` — updated with MaestroOptionsPanel import and rendering between header and tabs
