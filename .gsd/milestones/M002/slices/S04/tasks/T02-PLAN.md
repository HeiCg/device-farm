---
estimated_steps: 4
estimated_files: 1
---

# T02: Reskin Job Detail page header, tabs, and states with Kinetic Console tokens

**Slice:** S04 — Jobs — Build History Cards + Job Detail
**Milestone:** M002

## Description

Pure token substitution across the Job Detail page (`[id]/+page.svelte`). The file has 13 `farm-*` token references across the header, tabs, loading state, and error state. The sidebar + LogViewer grid layout (`grid-cols-1 xl:grid-cols-[320px_1fr]`) is already correct and stays untouched. All script logic stays intact.

The critical change beyond token replacement is converting the tab active/inactive styling from ternary expressions to if/else blocks. The current code uses inline ternary like `{activeTab === 'logs' ? 'text-farm-fg border-farm-accent' : 'text-farm-accent ...'}` — this must become Svelte if/else blocks so Tailwind v4 JIT can scan complete static class strings (D016 compliance, established in S01/S02/S03).

**Relevant skill:** `frontend-design` — load if you need guidance on dark theme token application.

## Steps

1. **Replace header tokens** — In the header section (`<!-- Header -->`):
   - Page title wrapper: replace `border-b border-farm-border` with `border-b border-outline-variant/10` (ghost border per R024)
   - StatusBadge stays as-is (already S01-reskinned)
   - Job ID `<h1>`: replace `text-farm-fg` with `text-on-surface`, add `font-headline` class
   - Status label: replace `text-farm-accent` with `text-on-surface-variant`
   - Metadata row icons: replace `text-farm-accent` with `text-on-surface-variant`, add `text-primary` to the icon `<span>` elements for colored icons
   - Keep all conditional content (deviceId block, platform ternary, formatDuration, formatDate) exactly as-is

2. **Convert tabs from ternary to if/else blocks** — The three tab buttons currently use inline ternary for class switching. Replace each with Svelte if/else:
   ```svelte
   <!-- BEFORE (broken for D016): -->
   <button class="... {activeTab === 'logs' ? 'text-farm-fg border-farm-accent' : 'text-farm-accent border-transparent ...'}">

   <!-- AFTER (D016-safe): -->
   {#if activeTab === 'logs'}
     <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px text-on-surface border-primary"
       onclick={() => (activeTab = 'logs')}>Logs</button>
   {:else}
     <button class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20"
       onclick={() => (activeTab = 'logs')}>Logs</button>
   {/if}
   ```
   - Apply the same pattern to Steps and Preview tabs
   - Tab container bottom border: replace `border-b border-farm-border` with `border-b border-outline-variant/10`
   - Active state: `text-on-surface border-primary` (purple underline)
   - Inactive state: `text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/20`

3. **Replace error state tokens**:
   - Replace `border-farm-danger/30 bg-red-50 text-farm-danger` with `border-tertiary/20 bg-tertiary/10 text-tertiary rounded-lg`

4. **Replace loading state tokens**:
   - Replace `text-farm-accent` with `text-on-surface-variant`

## Must-Haves

- [ ] Zero `farm-*` tokens in `[id]/+page.svelte`
- [ ] Zero `bg-red-50` occurrences
- [ ] All tab buttons use if/else blocks (not ternary) for active/inactive styling
- [ ] `font-headline` applied to job ID heading
- [ ] Ghost borders (`border-outline-variant/10`) replace solid `border-farm-border`
- [ ] All script logic preserved exactly — no changes to fetchJob, fetchArtifacts, fetchLogs, fetchFlaky, stream, onMount, $effect
- [ ] Grid layout `grid-cols-1 xl:grid-cols-[320px_1fr]` preserved exactly
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/routes/jobs/\[id\]/+page.svelte` returns 0 matches
- `grep -n 'bg-red-50' web/src/routes/jobs/\[id\]/+page.svelte` returns 0 matches
- `grep -n 'font-headline' web/src/routes/jobs/\[id\]/+page.svelte` returns a match
- `grep -c '{#if activeTab' web/src/routes/jobs/\[id\]/+page.svelte` returns 3 (one if/else block per tab)
- `grep -n 'border-primary' web/src/routes/jobs/\[id\]/+page.svelte` returns matches (active tab underline)
- `grep -n 'grid-cols-1 xl:grid-cols-\[320px_1fr\]' web/src/routes/jobs/\[id\]/+page.svelte` returns a match (grid preserved)

## Inputs

- `web/src/routes/jobs/[id]/+page.svelte` — Current Job Detail page, 170 lines. 13 `farm-*` tokens across header, tabs, loading, error. Script imports: `onMount`, `page`, `apiFetch`, types, `createJobStream`, `DevicePreview`, `LogViewer`, `StepList`, `VideoPlayer`, `MetricsPanel`, `StatusBadge`. Complex reactive state and WebSocket stream logic. Layout: header → tabs → tab content with sidebar grid.
- The tab content section (Logs/Steps/Preview) renders `StepList`, `MetricsPanel`, `LogViewer`, `DevicePreview`, `VideoPlayer` — these components are reskinned in T03, but their invocations in this file stay unchanged.
- Token reference: `text-on-surface` (white text), `text-on-surface-variant` (gray text), `border-primary` (purple), `border-outline-variant` (dark gray for ghost borders), `bg-tertiary` (red), `text-tertiary` (red text).
- D016 pattern for tabs: if/else blocks with complete static class strings on each branch. The duplicate `<button>` is intentional — each branch must have the full element with all classes visible to Tailwind JIT scanner.

## Observability Impact

- **Tab active state inspection:** Active tab button has `text-on-surface border-primary` classes; inactive tabs have `text-on-surface-variant border-transparent`. Inspect in DevTools Elements panel to verify active/inactive switching.
- **Ghost border verification:** Header and tab container `border-b` uses `border-outline-variant/10` (10% opacity). Visible as a faint divider on dark backgrounds — inspect computed border-color to confirm.
- **Error state visibility:** Error banner renders with `bg-tertiary/10 border-tertiary/20 text-tertiary` — red-on-dark styling. Force an error by navigating to `/jobs/nonexistent-id` and inspect the banner element.
- **Loading state:** Force loading by throttling network in DevTools — "Loading..." text uses `text-on-surface-variant`.
- **No runtime signal changes:** All API fetch, WebSocket stream, and $effect logic is untouched. Network tab requests and WebSocket frames remain identical to pre-reskin behavior.

## Expected Output

- `web/src/routes/jobs/[id]/+page.svelte` — Dark-themed Job Detail with `font-headline` job ID, purple active tab indicators via if/else blocks, ghost borders, dark error/loading states. Zero `farm-*` tokens. All script logic and grid layout unchanged.
