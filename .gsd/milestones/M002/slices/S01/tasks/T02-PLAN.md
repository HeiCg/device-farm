---
estimated_steps: 8
estimated_files: 6
---

# T02: Reskin shared components and update statusStyle utility

**Slice:** S01 — Design Foundation — Tokens, Fonts, Shared Components
**Milestone:** M002

## Description

Migrate all 5 shared components + FlakeyBadge + `format.ts` from `farm-*` tokens to the new Kinetic Console design tokens. The most significant change is StatusBadge — structural rewrite from a solid color circle (`.status-ball`) to a tinted pill badge with status text. The other components are token swaps with minor markup adjustments. Build must pass after all changes.

**Relevant skill:** `frontend-design` — load if you need guidance on component styling patterns.

## Steps

1. **Read all 6 target files** to understand current markup and `farm-*` usage:
   - `web/src/lib/components/shared/StatusBadge.svelte`
   - `web/src/lib/components/shared/AlertBanner.svelte`
   - `web/src/lib/components/shared/Filters.svelte`
   - `web/src/lib/components/shared/Pagination.svelte`
   - `web/src/lib/components/FlakeyBadge.svelte`
   - `web/src/lib/utils/format.ts`

2. **Rewrite StatusBadge.svelte** — Replace the `.status-ball` circle div with a tinted pill `<span>`:
   - Pill pattern: `bg-{color}/10 text-{color} border border-{color}/20 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter`
   - Status→color mapping (use `$derived` for the color lookup):
     - `passed`, `online`, `idle` → `secondary` (green #00fd93)
     - `failed`, `error`, `timeout` → `tertiary` (red #ff7168)
     - `running` → `primary` (purple #c39bff)
     - `queued`, `cancelled`, `booting` → uses `bg-surface-variant/50 text-on-surface-variant border-outline-variant/20`
     - `offline`, `maintenance` → uses `bg-outline-variant/10 text-outline-variant border-outline-variant/20`
   - Keep `size` prop in the interface (as optional, type `number`) but do NOT use it in the template — this avoids TypeScript errors in 5 consumer files that pass `size`. S03–S05 will clean those callers up.
   - Render the status label text inside the badge (capitalize or uppercase).
   - Use Svelte 5 runes: `let { status, size }: { status: string; size?: number } = $props();`

3. **Update AlertBanner.svelte** — Replace light background/border tokens with dark tinted variants:
   - Critical/error: `bg-tertiary-container/10 border border-tertiary/20 text-on-surface` with `text-tertiary` for the label
   - Warning: `bg-primary-container/10 border border-primary/20 text-on-surface` with `text-primary` for the label (or use tertiary-dim for warning distinction)
   - Info: `bg-surface-container-high border border-outline-variant/20 text-on-surface` with `text-on-surface-variant` for the label
   - Replace `farm-*` classes in any icon, text, or container elements
   - Use `font-headline` for the alert label/title text

4. **Update Filters.svelte** — Replace all `farm-*` tokens:
   - Select background: `bg-surface-container`
   - Border: `border-outline-variant/20`
   - Text: `text-on-surface`
   - Focus ring: `focus:ring-primary/30` or `focus:border-primary`
   - Label text: `text-on-surface-variant`

5. **Update Pagination.svelte** — Replace all `farm-*` tokens:
   - Button background: `bg-surface-container-high`
   - Border: `border-outline-variant/30`
   - Text: `text-on-surface-variant`
   - Hover: `hover:bg-surface-container-highest` or `hover:bg-surface-bright`
   - Focus: `focus:ring-primary/30`

6. **Update FlakeyBadge.svelte** (located at `web/src/lib/components/FlakeyBadge.svelte`, NOT in `shared/`):
   - Replace `farm-warning-subtle` / `farm-warning` tokens
   - New pattern: `bg-tertiary/10 text-tertiary border border-tertiary/20`
   - Keep existing layout and content

7. **Update `statusStyle()` in `web/src/lib/utils/format.ts`** — change returned class names:
   - `passed` → `{ color: 'text-secondary', bg: 'bg-secondary', label: 'Passed' }`
   - `failed` → `{ color: 'text-tertiary', bg: 'bg-tertiary', label: 'Failed' }`
   - `running` → `{ color: 'text-primary', bg: 'bg-primary', label: 'Running' }`
   - `queued` → `{ color: 'text-on-surface-variant', bg: 'bg-surface-variant', label: 'Queued' }`
   - `cancelled` → `{ color: 'text-on-surface-variant', bg: 'bg-surface-variant', label: 'Cancelled' }`
   - `timeout` → `{ color: 'text-tertiary', bg: 'bg-tertiary', label: 'Timeout' }`
   - `error` → `{ color: 'text-tertiary', bg: 'bg-tertiary', label: 'Error' }`
   - Default/unknown → `{ color: 'text-on-surface-variant', bg: 'bg-surface-variant', label: status }`
   - Note: `statusStyle()` is currently not imported by any `.svelte` file — only `formatRelativeTime` and `platformLabel` are used. But it must be updated now for S04 which will use it.

8. **Run `npm run web:build`** and fix any errors. Common issues: broken class references, import issues, TypeScript errors from StatusBadge prop changes. If build fails, read the error output and fix.

## Must-Haves

- [ ] StatusBadge renders as tinted pill badge, not solid circle — with text label inside
- [ ] StatusBadge `size` prop kept as optional but unused (no breaking change for consumers)
- [ ] StatusBadge status→color mapping matches R025: secondary=passed/active, tertiary=failed/error, primary=running, surface-variant=queued/cancelled
- [ ] AlertBanner uses dark tinted backgrounds with tertiary/primary tokens
- [ ] Filters uses `surface-container` + `outline-variant` + `on-surface` tokens
- [ ] Pagination uses `surface-container-high` + `outline-variant` + `on-surface-variant` tokens
- [ ] FlakeyBadge uses `tertiary/10` bg + `tertiary` text + `tertiary/20` border
- [ ] `statusStyle()` returns new token class names for all status values
- [ ] Zero `farm-*` occurrences in any of the 6 modified files
- [ ] `npm run web:build` passes with zero errors

## Verification

- `npm run web:build` → passes with zero errors
- `grep -rn 'farm-' web/src/lib/components/shared/StatusBadge.svelte web/src/lib/components/shared/AlertBanner.svelte web/src/lib/components/shared/Filters.svelte web/src/lib/components/shared/Pagination.svelte web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts` → zero results
- `grep 'status-ball' web/src/lib/components/shared/StatusBadge.svelte` → zero results (old class removed)
- `grep 'secondary' web/src/lib/components/shared/StatusBadge.svelte` → matches (confirms new token usage)
- `grep 'tertiary' web/src/lib/components/FlakeyBadge.svelte` → matches (confirms new token usage)

## Inputs

- `web/src/app.css` — T01 output: complete `@theme` block with all 51 tokens, fonts, radii, `.glass-card` class
- `web/src/lib/components/shared/StatusBadge.svelte` — current file using `.status-ball` circle with `farm-*` tokens
- `web/src/lib/components/shared/AlertBanner.svelte` — current file using light `bg-red-50` style backgrounds
- `web/src/lib/components/shared/Filters.svelte` — current file using `farm-border`, `farm-subtle`, etc.
- `web/src/lib/components/shared/Pagination.svelte` — current file using `farm-border`, `farm-subtle`, etc.
- `web/src/lib/components/FlakeyBadge.svelte` — current file using `farm-warning-subtle`, `farm-warning`
- `web/src/lib/utils/format.ts` — current file with `statusStyle()` returning `farm-*` class names

## Expected Output

- `web/src/lib/components/shared/StatusBadge.svelte` — tinted pill badge using secondary/tertiary/primary/surface-variant tokens; `size` prop optional but unused
- `web/src/lib/components/shared/AlertBanner.svelte` — dark tinted variants using tertiary-container/primary-container/surface-container tokens
- `web/src/lib/components/shared/Filters.svelte` — dark select dropdowns using surface-container/outline-variant/on-surface tokens
- `web/src/lib/components/shared/Pagination.svelte` — dark button using surface-container-high/outline-variant/on-surface-variant tokens
- `web/src/lib/components/FlakeyBadge.svelte` — dark badge using tertiary/10 bg + tertiary text
- `web/src/lib/utils/format.ts` — `statusStyle()` returns new token class names (text-secondary/bg-secondary for passed, etc.)
- Build passes: `npm run web:build` succeeds

## Observability Impact

- **Visual inspection:** StatusBadge renders as a tinted pill with uppercase text label (not a solid circle). Open any page that renders job status or device status and confirm pill shape with correct color mapping.
- **Token traceability:** In browser DevTools, inspect a StatusBadge element → computed styles should resolve to Kinetic Console palette values (e.g., `#00fd93` for passed, `#ff7168` for failed, `#c39bff` for running).
- **Zero farm-* residue:** `grep -rn 'farm-' web/src/lib/components/shared/ web/src/lib/components/FlakeyBadge.svelte web/src/lib/utils/format.ts` must return zero results. Any match means a token was missed.
- **Build signal:** `npm run web:build` exit code is the primary CI-visible signal. Non-zero means a token reference is broken or Svelte compilation failed.
- **statusStyle() contract:** `format.ts` exports updated class names. Downstream S04 consumers will call `statusStyle('passed').color` and expect `text-secondary`. If this returns `text-farm-success`, the migration is incomplete.
