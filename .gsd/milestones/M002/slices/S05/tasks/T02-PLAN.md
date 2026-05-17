---
estimated_steps: 5
estimated_files: 2
---

# T02: Reskin Devices page and DeviceCard with summary counters and platform-grouped card grid

**Slice:** S05 — Remaining Pages — Runners, Settings, Login
**Milestone:** M002

## Description

Transform the Devices page from a flat bordered table-row layout (18 `farm-*` refs in page, 7 in DeviceCard = 25 total) into a Kinetic Console fleet management view with summary state counters, platform-grouped sections, and a responsive card grid with state-specific card content.

The page's script logic is complex and must be preserved exactly: `fetchDevices()` polling with 5s interval, `handleRestart(id)`, `getDevicesByPlatform()`, `countByState()`, `stateIndicators` array, `onMount`/`onDestroy` lifecycle. Only templates and class names change.

**Key design patterns:**
- D016: All state-dependent styling via static Record lookup maps (border colors, card styles, counter styles)
- D017: Use `$derived` at component top level; `{@const}` only inside `{#each}` / `{#if}` blocks
- R024: No divide-y, no 1px solid sectioning borders — tonal shifts and ghost borders only
- R025: Status colors — secondary/green (running/idle), tertiary/red (error), primary/purple (booting), outline-variant (offline)

**Device type has only 6 fields:** `id`, `name`, `platform`, `state`, `emulatorId`, `currentJobId`. State-specific card content must adapt to what's available — no fake OS version, host, or error codes.

**Relevant skill:** `frontend-design` — load for design guidance if needed.

## Steps

1. **Rewrite `web/src/lib/components/devices/DeviceCard.svelte`** — Keep the `<script>` block's props and imports. Transform from horizontal flex row to vertical card.

   **Add state-dependent style Records** (D016 compliant) in the script section:
   ```typescript
   const cardBorderStyles: Record<string, string> = {
     running: 'border-primary/30',
     error: 'border-tertiary/30',
     booting: 'border-primary/20',
     idle: 'border-outline-variant/10',
     allocated: 'border-primary/20',
     cleanup: 'border-primary/20',
     offline: 'border-outline-variant/10',
   };

   const wrapperStyles: Record<string, string> = {
     offline: 'opacity-60 grayscale',
   };
   ```

   **Card template structure:**
   ```
   {@const borderClass = cardBorderStyles[device.state] ?? 'border-outline-variant/10'}
   {@const wrapperClass = wrapperStyles[device.state] ?? ''}
   <div class="bg-surface-container-high p-4 rounded-lg border {borderClass} {wrapperClass} transition-colors">
     <!-- Header row: name + StatusBadge -->
     <div class="flex items-center justify-between mb-3">
       <span class="text-sm font-medium text-on-surface">{device.name}</span>
       <StatusBadge status={device.state} />
     </div>

     <!-- Platform badge -->
     <div class="mb-3">
       <span class="text-[10px] px-2 py-0.5 rounded bg-surface-container-low text-on-surface-variant font-headline tracking-widest uppercase">
         {device.platform === 'android' ? 'Android' : 'iOS'}
       </span>
     </div>

     <!-- State-specific content -->
     {#if device.state === DeviceState.Running || device.state === DeviceState.Allocated || device.state === DeviceState.Cleanup}
       <div class="text-xs text-on-surface-variant space-y-1">
         <p class="font-mono text-on-surface-variant/70">{device.emulatorId}</p>
         {#if device.currentJobId}
           <p>Job: <a href="/jobs/{device.currentJobId}" class="text-primary hover:text-primary/80 font-mono">{device.currentJobId.slice(0, 8)}</a></p>
         {/if}
       </div>
     {:else if device.state === DeviceState.Error}
       <div class="space-y-2">
         <p class="text-xs font-mono text-on-surface-variant/70">{device.emulatorId}</p>
         {#if onrestart}
           <button
             onclick={() => onrestart?.(device.id)}
             class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-tertiary bg-tertiary/10 border border-tertiary/20 rounded-lg hover:bg-tertiary/15 transition-colors"
           >
             <span class="material-symbols-outlined text-sm">restart_alt</span>
             RESTART
           </button>
         {/if}
       </div>
     {:else if device.state === DeviceState.Booting}
       <div class="space-y-1">
         <p class="text-xs font-mono text-on-surface-variant/70">{device.emulatorId}</p>
         <div class="flex items-center gap-2">
           <div class="h-1 flex-1 bg-surface-container-low rounded-full overflow-hidden">
             <div class="h-full w-1/2 bg-primary/40 rounded-full animate-pulse"></div>
           </div>
           <span class="text-[10px] text-primary tracking-widest">BOOTING</span>
         </div>
       </div>
     {:else if device.state === DeviceState.Offline}
       <div class="space-y-1">
         <p class="text-xs font-mono text-on-surface-variant/70">{device.emulatorId}</p>
         <span class="text-[10px] text-outline-variant tracking-widest uppercase">MAINTENANCE</span>
       </div>
     {:else}
       <!-- Idle and other states: show emulator info -->
       <div class="text-xs text-on-surface-variant space-y-1">
         <p class="font-mono text-on-surface-variant/70">{device.emulatorId}</p>
       </div>
     {/if}
   </div>
   ```

   All 7 `farm-*` refs removed. No `border-b border-farm-border`, no `bg-farm-subtle`, no `text-farm-fg/accent`.

2. **Rewrite `web/src/routes/devices/+page.svelte` template** — Keep the entire `<script>` block exactly as-is (lines 1–63). Replace the template.

   **Add state counter style Record** in the script section (after `stateIndicators`):
   ```typescript
   const counterBorderStyles: Record<string, string> = {
     [DeviceState.Idle]: 'border-l-secondary/40',
     [DeviceState.Running]: 'border-l-primary/40',
     [DeviceState.Booting]: 'border-l-primary/30',
     [DeviceState.Error]: 'border-l-tertiary/40',
     [DeviceState.Offline]: 'border-l-outline-variant/30',
   };

   const counterTextStyles: Record<string, string> = {
     [DeviceState.Idle]: 'text-secondary',
     [DeviceState.Running]: 'text-primary',
     [DeviceState.Booting]: 'text-primary/70',
     [DeviceState.Error]: 'text-tertiary',
     [DeviceState.Offline]: 'text-outline-variant',
   };
   ```

   **New template structure:**

   a. **Header:** `<div class="mb-6">` with `<h1 class="font-headline text-lg font-bold text-on-surface tracking-wide">FLEET_MANAGEMENT</h1>` and subtitle `<p class="text-xs text-on-surface-variant mt-1">` with device count.

   b. **Summary counters** (only when loaded and devices exist): `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-8">` with an `{#each stateIndicators as ind}` block. Each counter:
   ```
   {@const count = countByState(ind.state)}
   {@const borderClass = counterBorderStyles[ind.state] ?? 'border-l-outline-variant/30'}
   {@const textClass = counterTextStyles[ind.state] ?? 'text-outline-variant'}
   <div class="bg-surface-container-low p-4 rounded-lg border-l-2 {borderClass}">
     <p class="text-2xl font-bold {textClass}">{count}</p>
     <p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">{ind.label}</p>
   </div>
   ```

   c. **Loading skeleton:** 3 placeholder cards using `bg-surface-container-high rounded-lg p-4 animate-pulse` in a grid.

   d. **Error state:** `<div class="rounded-lg bg-tertiary/10 border border-tertiary/20 px-4 py-3 text-sm text-tertiary">`

   e. **Empty state:** `<div class="rounded-lg bg-surface-container-low px-4 py-16 text-center">` with `text-on-surface-variant` text.

   f. **Platform sections:** For each platform (android then ios), if devices exist:
   ```
   <div class="mb-8">
     <div class="flex items-center gap-3 mb-4">
       <div class="p-2 bg-primary/10 rounded-lg">
         <span class="material-symbols-outlined text-primary">
           {platform === 'android' ? 'android' : 'phone_iphone'}
         </span>
       </div>
       <h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">
         {platform === 'android' ? 'ANDROID_ECOSYSTEM' : 'IOS_SUITE'}
       </h2>
       <span class="text-xs text-on-surface-variant">({platformDevices.length})</span>
     </div>
     <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
       {#each platformDevices as device (device.id)}
         <DeviceCard {device} onrestart={handleRestart} />
       {/each}
     </div>
   </div>
   ```

   All 18 `farm-*` refs removed. Zero `border-b border-farm-border`, zero `divide-y`.

3. **Verify no `farm-*` or light-theme remnants** in both files.

4. **Build check** — `npm run web:build` exits 0.

5. **Run all grep verifications** from the slice plan for the devices page.

## Must-Haves

- [ ] Zero `farm-*` token references in `devices/+page.svelte` (was 18)
- [ ] Zero `farm-*` token references in `DeviceCard.svelte` (was 7)
- [ ] Summary counter bar with 5 state counts (Idle/Running/Booting/Error/Offline)
- [ ] Counter border-l-2 colors via D016 Record lookup map
- [ ] ANDROID_ECOSYSTEM / IOS_SUITE platform section headers with icon
- [ ] Responsive card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`)
- [ ] DeviceCard shows state-specific content (running→job link, error→restart, booting→indicator, offline→maintenance+opacity-60)
- [ ] DeviceCard border color varies by state via D016 Record lookup map
- [ ] Zero `divide-y`, zero `border-farm-border`, zero `bg-red-50` (R024)
- [ ] All script logic preserved (fetchDevices, handleRestart, getDevicesByPlatform, countByState, polling, onDestroy cleanup)
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -c 'farm-' web/src/routes/devices/+page.svelte` returns 0
- `grep -c 'farm-' web/src/lib/components/devices/DeviceCard.svelte` returns 0
- `grep -c 'bg-red-50\|divide-y' web/src/routes/devices/+page.svelte` returns 0
- `grep 'ANDROID_ECOSYSTEM' web/src/routes/devices/+page.svelte` matches
- `grep 'IOS_SUITE' web/src/routes/devices/+page.svelte` matches
- `grep 'grid-cols' web/src/routes/devices/+page.svelte` matches (responsive grid)
- `grep 'border-l-2' web/src/routes/devices/+page.svelte` matches (counter borders)
- `grep 'StatusBadge' web/src/routes/devices/+page.svelte` matches (import present)
- `grep 'StatusBadge' web/src/lib/components/devices/DeviceCard.svelte` matches
- `grep 'opacity-60' web/src/lib/components/devices/DeviceCard.svelte` matches (offline treatment)

## Inputs

- `web/src/routes/devices/+page.svelte` — Current 135-line file. Script block (lines 1–63) must be preserved except for adding Record lookup maps.
- `web/src/lib/components/devices/DeviceCard.svelte` — Current 40-line file. Script block imports and props must be preserved.
- `DeviceState` enum from `$lib/api/types.js`: `Booting, Idle, Allocated, Running, Cleanup, Error, Offline`
- `Device` type: `{ id, name, platform, state, emulatorId, currentJobId }`
- `StatusBadge` from `$lib/components/shared/StatusBadge.svelte` — already reskinned in S01, accepts `status` prop
- Nav sidebar state colors from S02: `text-secondary` (Running), `text-on-surface-variant` (Idle), `text-primary` (Booting), `text-tertiary` (Error), `text-outline-variant` (Offline)

## Observability Impact

- **Device card state borders:** Each DeviceCard's outer `<div>` gets a state-specific border class from the `cardBorderStyles` Record (e.g., `border-primary/30` for running, `border-tertiary/30` for error). Inspect via browser DevTools on the card element's class list.
- **Summary counters:** The 5 counter cards each have a `border-l-2` with state-specific color from `counterBorderStyles` Record and a large count number with color from `counterTextStyles`. Verify counter values match actual device state distribution.
- **Platform sections:** ANDROID_ECOSYSTEM and IOS_SUITE sections render conditionally — only if devices exist for that platform. Each section header has a Material Symbols icon (`android` / `phone_iphone`) and a device count in parentheses.
- **Offline treatment:** Offline device cards get `opacity-60 grayscale` from `wrapperStyles` Record — visually distinguishable from active cards.
- **Error card restart:** Error-state cards show a RESTART button styled with `bg-tertiary/10 text-tertiary border-tertiary/20`. Button click triggers `onrestart` callback → `handleRestart(id)` → `restartDevice(id)` API call → `fetchDevices()` refresh.
- **Build gate:** `npm run web:build` catches any Svelte compilation error, missing import, or type error. Zero `farm-*` grep matches confirm complete token migration.

## Expected Output

- `web/src/routes/devices/+page.svelte` — Reskinned with summary counters, platform sections, responsive grid, zero `farm-*` tokens
- `web/src/lib/components/devices/DeviceCard.svelte` — Reskinned as vertical card with state-specific content, zero `farm-*` tokens
