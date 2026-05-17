---
estimated_steps: 5
estimated_files: 3
---

# T03: Reskin StepList, MetricsPanel, and LogViewer subcomponents

**Slice:** S04 — Jobs — Build History Cards + Job Detail
**Milestone:** M002

## Description

Three independent subcomponents all rendered inside Job Detail's sidebar and main content area. Together they contain 30 `farm-*` tokens plus hardcoded hex colors in LogViewer. All three need full Kinetic Console reskin but have no cross-dependencies — they can be modified in any order.

**StepList** has the most tokens (17) and gets the biggest visual change: rows become dark cards with status-colored left borders and icons in tinted circles. **MetricsPanel** has 13 tokens and replaces M001 bar colors (`bg-slate-200`, `bg-purple-500`, `bg-farm-success`) with dark tonal bars. **LogViewer** has 0 `farm-*` tokens but uses hardcoded hex colors that need alignment to `@theme` tokens plus a macOS-style dots header.

**Relevant skill:** `frontend-design` — load if you need guidance on dark component patterns.

## Steps

1. **Reskin StepList summary header** — Replace the top summary bar:
   - Container: replace `bg-farm-subtle border-b border-farm-border` with `bg-surface-container-high`
   - Step count label: replace `text-farm-fg` with `text-on-surface`
   - Passed counter: replace `text-farm-success` with `text-secondary`
   - Failed counter: replace `text-farm-danger` with `text-tertiary`
   - Running counter: replace `text-farm-warning` with `text-primary`
   - Remove `border-b border-farm-border` from summary (use tonal shift only — R024)

2. **Reskin StepList step rows** — Replace each step row's styling:
   - Outer container: replace `border border-farm-border` with `border border-outline-variant/10` (ghost border)
   - Row background: replace `bg-farm-canvas` wrapper with nothing (rows sit directly in container)
   - Each step row: replace `border-b border-farm-border hover:bg-farm-subtle` with `hover:bg-surface-container transition-colors` and add `border-l-2` with status-colored left border
   - Create a local `stepBorderStyles` Record (same D016 pattern as JobCard T01):
     ```typescript
     const stepBorderStyles: Record<string, string> = {
       passed: 'border-l-secondary',
       failed: 'border-l-tertiary',
       running: 'border-l-primary',
       pending: 'border-l-outline',
     };
     ```
     Use via `{@const borderClass = stepBorderStyles[step.status] ?? 'border-l-outline'}` in the `{#each}` loop.
     Note: `border-l-secondary` means border-left color is secondary. Combine with `border-l-2` on the element: `border-l-2 {borderClass}`. However, since Tailwind uses `border-l-{color}` syntax, verify this works. Alternative: use the same pattern as JobCard with `border-l-2` on the element and separate border-color classes. The safest approach is a lookup returning full class strings like `'border-l-2 border-secondary'` etc.
   - Icon colors: replace `text-farm-success` → `text-secondary`, `text-farm-danger` → `text-tertiary`, `text-farm-warning` → `text-primary`, `text-farm-muted` → `text-outline`
   - Add tinted icon circle backgrounds: wrap each icon in a `<span class="w-6 h-6 rounded-full flex items-center justify-center">` with status-tinted background (e.g., `bg-secondary/10` for passed, `bg-tertiary/10` for failed, `bg-primary/10` for running). Use if/else blocks (not ternary) for the icon+circle block.
   - Flow name: replace `text-farm-fg` with `text-on-surface`
   - Command text: replace `text-farm-accent` with `text-on-surface-variant`
   - Duration: replace `text-farm-accent` with `text-on-surface-variant`
   - Chevron: replace `text-farm-accent/50` with `text-outline-variant`
   - Empty state: replace `text-farm-accent` with `text-on-surface-variant`
   - Keep `FlakeyBadge` import as `$lib/components/FlakeyBadge.svelte` (NOT `shared/`)

3. **Reskin MetricsPanel container and header**:
   - Outer container: replace `border border-farm-border` with `border-l-2 border-primary bg-surface-container-low rounded-lg overflow-hidden` (left purple accent border)
   - Header: replace `bg-farm-subtle border-b border-farm-border` with `bg-surface-container-high px-4 py-2.5`
   - Title: replace `text-farm-fg` with `text-on-surface`
   - Sample count: replace `text-farm-accent` with `text-on-surface-variant`
   - Remove header bottom border (tonal shift sufficient — R024)

4. **Reskin MetricsPanel memory bars**:
   - Bar labels: replace `text-farm-accent` with `text-on-surface-variant`
   - Value readout: replace `text-farm-fg` with `text-on-surface`
   - Bar tracks: replace `bg-slate-200` with `bg-surface-variant` (all three bars)
   - Bar fills — use distinct semantic colors with glow:
     - Total PSS: replace `bg-farm-accent` with `bg-primary shadow-[0_0_8px_rgba(195,155,255,0.3)]`
     - Native Heap: replace `bg-purple-500` with `bg-primary-dim shadow-[0_0_8px_rgba(145,76,242,0.3)]`
     - Java Heap: replace `bg-farm-success` with `bg-secondary shadow-[0_0_8px_rgba(0,253,147,0.3)]`
   - Empty state: replace `text-farm-accent` with `text-on-surface-variant`
   - Confirm no CPU/RAM/Network Profiler/Memory Heap/Leak Detection labels (R026)

5. **Reskin LogViewer**:
   - Header bar: replace `bg-[#161b22] border-b border-[#30363d]` with `bg-surface-container-high border-b border-outline-variant/20`
   - Add macOS-style dots before the "Output" label: three `<span>` circles `w-2 h-2 rounded-full` in `bg-tertiary` (red), `bg-primary` (yellow/purple — using primary since no yellow token), `bg-secondary` (green), with `gap-1.5 mr-3`
   - Header text "Output": replace `text-[#e6edf3]` with `text-on-surface`
   - Line count: replace `text-[#7d8590]` with `text-on-surface-variant`
   - Outer container border: replace `border-[#30363d]` with `border-outline-variant/20`
   - Terminal background: keep `bg-[#0d1117]` (per R020 — log viewer keeps existing dark theme)
   - Line number color: keep `text-[#484f58]` (fine as-is — matches near-dark aesthetic)
   - Hover row: keep `hover:bg-[#161b22]` or replace with `hover:bg-surface-container-high`
   - Waiting text: keep `text-[#484f58]` or replace with `text-outline-variant`
   - stderr color: keep `text-[#f85149]` (close to tertiary — acceptable)
   - stdout color: keep `text-[#e6edf3]` (close to on-surface — acceptable)
   - The `.log-viewer` scrollbar styles are already updated in `app.css` by S01

## Must-Haves

- [ ] Zero `farm-*` tokens in all three files
- [ ] Zero `bg-slate-200`, `bg-purple-500`, or `bg-farm-success` in MetricsPanel
- [ ] Zero CPU/RAM Usage/Network Profiler/Memory Heap/Leak Detection labels in MetricsPanel (R026)
- [ ] StepList uses D016-safe Record lookup for step border colors (full static strings)
- [ ] StepList step icons use if/else blocks (not ternary) for tinted circle styling
- [ ] FlakeyBadge import path stays as `$lib/components/FlakeyBadge.svelte`
- [ ] LogViewer has macOS-style colored dots (three circles) in header
- [ ] MetricsPanel bar fills use `bg-primary`, `bg-primary-dim`, `bg-secondary` with glow shadows
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/lib/components/jobs/StepList.svelte web/src/lib/components/jobs/MetricsPanel.svelte web/src/lib/components/jobs/LogViewer.svelte` returns 0 matches
- `grep -rn 'bg-slate-200\|bg-purple-500' web/src/lib/components/jobs/MetricsPanel.svelte` returns 0 matches
- `grep -i 'cpu\|ram usage\|network profiler\|memory heap\|leak detection' web/src/lib/components/jobs/MetricsPanel.svelte` returns 0 matches
- `grep -n 'bg-surface-variant' web/src/lib/components/jobs/MetricsPanel.svelte` returns matches (bar tracks)
- `grep -n 'bg-surface-container-high' web/src/lib/components/jobs/LogViewer.svelte` returns a match (header)
- `grep -n 'rounded-full' web/src/lib/components/jobs/LogViewer.svelte` returns matches (macOS dots)
- `grep -n 'FlakeyBadge' web/src/lib/components/jobs/StepList.svelte` returns `$lib/components/FlakeyBadge.svelte` (not `shared/`)
- `grep -n 'bg-surface-container-low' web/src/lib/components/jobs/StepList.svelte` returns matches

## Inputs

- `web/src/lib/components/jobs/StepList.svelte` — 72 lines, 17 `farm-*` tokens. Props: `{ steps: StepData[], flakyMap?: Map<string, number> }`. Imports: `StepData` type, `FlakeyBadge`. Has derived counters for passed/failed/running, local `formatDuration()`. Summary header + step rows + empty state.
- `web/src/lib/components/jobs/MetricsPanel.svelte` — 62 lines, 13 `farm-*` tokens + `bg-slate-200`, `bg-purple-500`. Props: `{ metrics: MetricsData[] }`. Shows memory bars for Total PSS, Native Heap, Java Heap only. Has derived `latest`, `maxPss`, `maxNative`, `maxJava`, helper functions `toMB()`, `pct()`.
- `web/src/lib/components/jobs/LogViewer.svelte` — 40 lines, 0 `farm-*` tokens but hardcoded hex colors: `#30363d` (borders), `#161b22` (header bg), `#0d1117` (terminal bg), `#e6edf3` (text), `#7d8590` (line count), `#484f58` (line numbers, waiting text), `#f85149` (stderr). Props: `{ logs: LogData[] }`. Has visible logs slicing (last 1000) and auto-scroll effect.
- Token reference from `app.css`: `surface-container-high` (#1f1f1f), `surface-container-low` (#131313), `surface-variant` (#262626), `primary` (#c39bff), `primary-dim` (#914cf2), `secondary` (#00fd93), `tertiary` (#ff7168), `outline-variant` (#484848), `on-surface` (#ffffff), `on-surface-variant` (#ababab).
- D016 pattern: same `{@const}` + Record lookup as established in T01's JobCard and S03's dashboard. Full static strings in Record values.
- R026: MetricsPanel currently shows only PSS/Native Heap/Java Heap from real `MetricsData` — this is correct and must stay. Verify no new mock labels are introduced.

## Observability Impact

- **StepList status borders:** Inspect any step row in DevTools — look for `border-l-2 border-secondary` (passed), `border-l-2 border-tertiary` (failed), `border-l-2 border-primary` (running). Tinted icon circles visible as `bg-secondary/10`, `bg-tertiary/10`, `bg-primary/10`.
- **MetricsPanel glow bars:** Inspect bar fill elements — each has a `shadow-[0_0_8px_...]` glow. Bar tracks are `bg-surface-variant`. Left accent border is `border-l-2 border-primary`.
- **LogViewer macOS dots:** Three `<span>` circles in the header with `bg-tertiary`, `bg-primary`, `bg-secondary` classes. Terminal background preserved as `bg-[#0d1117]`.
- **Failure state:** All three components render empty states with `text-on-surface-variant` when no data is present. No visible breakage on empty props.

## Expected Output

- `web/src/lib/components/jobs/StepList.svelte` — Dark step cluster with `bg-surface-container-high` summary, `bg-surface-container-low` step rows, status-colored left borders, tinted icon circles, `text-secondary`/`text-tertiary`/`text-primary` status colors. Zero `farm-*` tokens.
- `web/src/lib/components/jobs/MetricsPanel.svelte` — Dark memory panel with `bg-surface-container-low`, `border-l-2 border-primary` accent, `bg-surface-variant` bar tracks, semantic color fills with glow shadows. Zero `farm-*` tokens, zero M001 holdover colors.
- `web/src/lib/components/jobs/LogViewer.svelte` — Terminal viewer with macOS-style colored dots header, `bg-surface-container-high` header, `border-outline-variant/20` ghost borders. Terminal background preserved.
