---
estimated_steps: 5
estimated_files: 1
---

# T03: Rewrite Nav sidebar with COMMAND_CENTER header and restyled data sections

**Slice:** S02 — App Shell — Top Navbar, Sidebar, Mobile Nav, Layout
**Milestone:** M002

## Description

Complete reskin of `Nav.svelte` from Jenkins light sidebar to Kinetic Console dark sidebar (R016). This is the most complex task in the slice — the current file is 145 lines with substantial data logic (health API polling, queue depth derivation, executor device state mapping, health percentage calculation) that must be preserved exactly while the entire visual layer is replaced.

The script section stays almost entirely intact. The `deviceStateLabel` function's class strings change from `farm-*` tokens to Kinetic Console tokens. The template is restructured: new COMMAND_CENTER header section, restyled nav items with active right-border instead of white background, and all three data sections (queue, executor, health) restyled to dark tonal palette.

**Relevant skill:** `frontend-design` — load for Svelte 5 / Tailwind v4 component patterns.

## Steps

1. **Update script section** — minimal changes, preserve all logic:
   - Keep ALL imports: `page`, `onMount`, `onDestroy`, `getHealth`, types, `DeviceState`
   - Update `links` array labels: `Dashboard` stays, `Build History` → `Jobs`, `Runners` → `Devices`, `Manage` → `Settings`. Update icons: `history` → `terminal`, `devices` → `developer_board`, `manage_accounts` → `tune`. `dashboard` icon stays.
   - Keep `isActive()` function exactly as-is
   - Keep `health`, `intervalId`, `fetchHealth()`, `queueDepth`, `executorDevices`, `healthPercent` — all unchanged
   - Update `deviceStateLabel()` class strings (these are the `farm-*` token replacements):
     - `DeviceState.Running`: `'text-farm-accent font-medium'` → `'text-secondary font-medium'` (green for active)
     - `DeviceState.Idle`: `'text-slate-400 italic'` → `'text-on-surface-variant italic'`
     - `DeviceState.Booting`: `'text-yellow-500'` → `'text-primary'` (purple for transitional)
     - `DeviceState.Allocated`: `'text-farm-accent'` → `'text-primary'`
     - `DeviceState.Cleanup`: `'text-orange-500'` → `'text-primary/70'`
     - `DeviceState.Error`: `'text-farm-danger font-medium'` → `'text-tertiary font-medium'` (red)
     - `DeviceState.Offline`: `'text-slate-400 italic'` → `'text-outline-variant italic'`
     - Default: `'text-slate-400'` → `'text-on-surface-variant'`
   - Keep `onMount()` and `onDestroy()` exactly as-is

2. **Rewrite template** — `<aside>` element:
   - Outer aside: `fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 bg-background border-r border-primary/10 hidden md:flex flex-col z-40`
     - Note: `top-16` (aligns below h-16 navbar), `h-[calc(100vh-4rem)]` (fills remaining height), `hidden md:flex` (hidden on mobile)
   - **COMMAND_CENTER header** (new section, top of sidebar):
     ```html
     <div class="px-6 py-4 border-b border-outline-variant/10">
       <div class="flex items-center gap-2">
         <div class="w-2 h-2 rounded-full bg-secondary animate-pulse"></div>
         <span class="font-headline font-bold text-primary text-sm tracking-wider">DEVICE_FARM</span>
       </div>
       <div class="text-[10px] text-on-surface-variant font-mono mt-1">COMMAND_CENTER v1.0</div>
     </div>
     ```
     - Note: Brand says "DEVICE_FARM" per D010, not "KINETIC_CONSOLE"
   - **Nav items** section:
     ```html
     <nav class="flex flex-col py-2">
       {#each links as link}
         <a href={link.href}
            class={isActive(link.href, page.url.pathname)
              ? 'flex items-center px-6 py-3 gap-3 bg-primary/10 text-primary border-r-4 border-primary transition-colors'
              : 'flex items-center px-6 py-3 gap-3 text-on-surface-variant hover:bg-white/5 transition-colors group'}>
           <span class="material-symbols-outlined text-lg group-hover:translate-x-1 transition-transform">{link.icon}</span>
           <span class="text-sm font-medium">{link.label}</span>
         </a>
       {/each}
     </nav>
     ```
     - Active state: `bg-primary/10 text-primary border-r-4 border-primary` (full static string)
     - Inactive: `text-on-surface-variant hover:bg-white/5` with `group` for icon hover translate
     - Note: The `group-hover:translate-x-1` on the icon only applies in the inactive branch where `group` is present. The active branch doesn't need `group`.

3. **Restyle Build Queue section**:
   ```html
   <div class="px-6 mt-4">
     <h4 class="font-headline text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-2 flex items-center justify-between">
       Build Queue
       <button class="material-symbols-outlined text-xs cursor-pointer hover:text-primary transition-colors text-on-surface-variant" onclick={fetchHealth} aria-label="Refresh queue">refresh</button>
     </h4>
     <div class="text-[11px] text-on-surface-variant bg-surface-container-low rounded-lg p-3 italic">
       {#if queueDepth > 0}
         {queueDepth} job{queueDepth !== 1 ? 's' : ''} in the queue.
       {:else}
         No builds in the queue.
       {/if}
     </div>
   </div>
   ```

4. **Restyle Build Executor Status + Node Health sections**:
   - Build Executor Status:
     ```html
     {#if executorDevices.length > 0}
       <div class="px-6 mt-4">
         <h4 class="font-headline text-[10px] tracking-[0.2em] uppercase text-on-surface-variant mb-2">Build Executor Status</h4>
         <table class="w-full text-xs">
           <tbody>
             {#each executorDevices as device, i}
               {@const state = deviceStateLabel(device)}
               <tr class={i < executorDevices.length - 1 ? 'border-b border-outline-variant/10' : ''}>
                 <td class="py-1.5 w-4 text-on-surface-variant">{i + 1}</td>
                 <td class="py-1.5 {state.class}">
                   {#if device.state === DeviceState.Running && device.currentJobId}
                     <a href="/jobs/{device.currentJobId}" class="hover:underline">{state.text}</a>
                   {:else}
                     {state.text}
                   {/if}
                 </td>
               </tr>
             {/each}
           </tbody>
         </table>
       </div>
     {/if}
     ```
     - Row borders: `border-outline-variant/10` (ghost border)
     - Index numbers: `text-on-surface-variant`
   - Node Health (pinned to bottom with `mt-auto`):
     ```html
     <div class="mt-auto px-6 py-4 border-t border-outline-variant/10">
       <div class="flex items-center gap-2 text-xs text-on-surface-variant">
         <span class="material-symbols-outlined text-sm">cloud</span>
         <span>Node Health: <strong class="text-secondary">{healthPercent}.0%</strong></span>
       </div>
       <div class="w-full bg-surface-container-highest h-1.5 rounded-full mt-2">
         <div class="bg-secondary h-full rounded-full transition-all duration-500" style="width: {healthPercent}%" title="{healthPercent}% Healthy"></div>
       </div>
     </div>
     ```
     - Bar: `bg-secondary` (green) on `bg-surface-container-highest` track
     - Percentage text: `text-secondary` highlight

5. **Verify build and tokens**: Run `npm run web:build` (exit 0) and `grep -rn 'farm-\|bg-white\b\|text-slate\|bg-slate\|text-yellow\|text-orange\|bg-blue' web/src/lib/components/layout/Nav.svelte` → confirm zero results for all old-theme token patterns.

## Must-Haves

- [ ] Sidebar is `w-64` (not `w-60`) with `hidden md:flex` visibility
- [ ] Sidebar top offset is `top-16` matching new navbar height
- [ ] COMMAND_CENTER header with green pulse dot (`bg-secondary animate-pulse`) and "DEVICE_FARM" brand
- [ ] Nav items: Dashboard, Jobs, Devices, Settings — exactly 4, no extras (R028)
- [ ] Active nav state: `bg-primary/10 text-primary border-r-4 border-primary` (full static strings)
- [ ] Icon hover micro-interaction: `group-hover:translate-x-1 transition-transform`
- [ ] Build Queue section restyled: `bg-surface-container-low`, `text-on-surface-variant`
- [ ] Build Executor table restyled: `border-outline-variant/10` row borders, state colors use Kinetic Console tokens
- [ ] Node Health bar: `bg-secondary` on `bg-surface-container-highest` track, `text-secondary` percentage
- [ ] `fetchHealth()`, `setInterval(fetchHealth, 5000)`, `onDestroy` cleanup all preserved
- [ ] `queueDepth`, `executorDevices`, `healthPercent` derived values preserved
- [ ] All `deviceStateLabel` class strings are full static strings (Tailwind v4 JIT rule)
- [ ] No RUN_NEW_JOB button (D012, R027)
- [ ] No DOCUMENTATION/SUPPORT links (D011, R028)
- [ ] Zero `farm-*`, `text-slate-*`, `bg-white`, `bg-blue-*`, `border-slate-*` token references
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -rn 'farm-' web/src/lib/components/layout/Nav.svelte` → zero results
- `grep -rn 'bg-white\|text-slate\|bg-slate\|text-yellow-500\|text-orange-500\|bg-blue-600\|border-slate' web/src/lib/components/layout/Nav.svelte` → zero results
- `grep 'hidden md:flex' web/src/lib/components/layout/Nav.svelte` → found
- `grep 'w-64' web/src/lib/components/layout/Nav.svelte` → found
- `grep 'COMMAND_CENTER' web/src/lib/components/layout/Nav.svelte` → found
- `grep 'fetchHealth' web/src/lib/components/layout/Nav.svelte` → found
- `grep 'setInterval' web/src/lib/components/layout/Nav.svelte` → found
- `grep 'onDestroy' web/src/lib/components/layout/Nav.svelte` → found
- `grep -c 'RUN_NEW_JOB\|DOCUMENTATION\|SUPPORT' web/src/lib/components/layout/Nav.svelte` → zero

## Observability Impact

- **Health API polling preserved:** `setInterval(fetchHealth, 5000)` continues to fire every 5s; `/api/health` calls visible in Network tab. No change in polling frequency or error handling.
- **Sidebar data sections:** Queue depth, executor device states, and health percentage bar all derive from `health` reactive state — same derivation logic, new visual tokens. If the health API is unreachable, sidebar shows stale/zero data (existing silent-catch behavior).
- **Inspection:** Check sidebar COMMAND_CENTER header renders with green pulse dot (`bg-secondary animate-pulse`). Inspect executor rows for correct state color tokens (`text-secondary` for Running, `text-tertiary` for Error, etc.). Health bar should animate width transitions (`transition-all duration-500`).
- **Failure state:** If `fetchHealth()` throws, the `catch {}` block silently swallows — sidebar remains in last-known-good state. No new failure modes introduced.

## Inputs

- `web/src/lib/components/layout/Nav.svelte` — Current 145-line file with health API wiring, 8 `farm-*` token references, light theme styling
- T01 completed: layout now uses `pt-16` and `md:pl-64`, sidebar should use `top-16` to align below navbar
- S01 tokens available: `bg-background`, `text-primary`, `bg-primary/10`, `text-secondary`, `text-tertiary`, `text-on-surface-variant`, `bg-surface-container-low`, `bg-surface-container-highest`, `border-outline-variant`, `border-primary`, `font-headline`

## Expected Output

- `web/src/lib/components/layout/Nav.svelte` — Complete reskin: ~160 lines, COMMAND_CENTER header, dark-themed nav items with active right-border, restyled queue/executor/health sections, all health API wiring preserved, zero `farm-*` or light-theme tokens
