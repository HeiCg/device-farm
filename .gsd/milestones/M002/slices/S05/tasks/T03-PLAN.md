---
estimated_steps: 5
estimated_files: 1
---

# T03: Reskin Settings page with bento grid config sections

**Slice:** S05 — Remaining Pages — Runners, Settings, Login
**Milestone:** M002

## Description

Reskin the Settings page from its current Jenkins-era vertical stack of bordered key-value sections (174 lines, 69 `farm-*` token refs, heavy use of `divide-y divide-farm-border`) into a Kinetic Console bento grid layout with 4 modular config sections. This is the highest farm-* count of any file and the most `divide-y` violations of R024.

The page reads config from `/api/config` via `apiFetch`. The script block stays exactly as-is. Only template and class names change. Every `divide-y divide-farm-border` must become `space-y-3` (or equivalent spacing). Every `border-farm-border` section border becomes `border border-white/5`.

**Key constraints:**
- Data comes only from the real `/api/config` endpoint — no mock metrics (D013)
- No uptime, no storage capacity bar, no IO/CPU/network stats
- D016: static class strings only
- R024: zero divide-y, zero 1px solid sectioning borders

**Config API shape:**
```
server: { host, port }
pool: { max_devices, android: { enabled, max_instances, headless, api_level, device_profile, ram_mb }, ios: { enabled, max_instances, runtime, device_type } }
storage: { artifacts: { path, retention_days, compress_after_days, format, max_storage_gb }, logs: { path, retention_days } }
jobs: { timeout_minutes, max_queue_size, cleanup_completed_after_days }
auth: { enabled }
```

**Relevant skill:** `frontend-design` — load for design guidance if needed.

## Steps

1. **Rewrite the Settings page header** — Replace:
   ```html
   <div class="pb-4 border-b border-farm-border mb-6">
     <h1 class="text-[20px] font-semibold text-farm-fg">Settings</h1>
     <p class="text-[12px] text-farm-accent mt-0.5">Current server configuration (read-only)</p>
   </div>
   ```
   With:
   ```html
   <div class="mb-8">
     <div class="flex items-center gap-3">
       <h1 class="font-headline text-lg font-bold text-on-surface tracking-wide">DEVICE_FARM_CONFIG</h1>
       <span class="text-[10px] font-headline tracking-widest px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/20">READ_ONLY</span>
     </div>
     <p class="text-xs text-on-surface-variant mt-2">System configuration parameters — values sourced from server runtime</p>
   </div>
   ```

2. **Replace loading/error states** with dark tokens:
   - Loading: `<div class="text-sm text-on-surface-variant py-12 text-center">Loading configuration...</div>`
   - Error: `<div class="rounded-lg bg-tertiary/10 border border-tertiary/20 px-4 py-3 text-sm text-tertiary">{error}</div>`

3. **Restructure the config sections as a `grid grid-cols-12 gap-4` bento layout.** The `{:else if config}` block becomes:

   ```html
   <div class="grid grid-cols-12 gap-4">
   ```

   **Section A — Server Parameters (col-span-12 md:col-span-4):**
   ```html
   <section class="col-span-12 md:col-span-4 bg-surface-container-low rounded-xl p-6 border border-white/5">
     <div class="flex items-center gap-3 mb-5">
       <div class="p-2 bg-primary/10 rounded-lg">
         <span class="material-symbols-outlined text-primary">dns</span>
       </div>
       <h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">SERVER_PARAMETERS</h2>
     </div>
     <div class="space-y-3">
       <!-- Each key-value pair: -->
       <div>
         <p class="text-[10px] text-on-surface-variant tracking-widest uppercase">HOST</p>
         <p class="text-sm text-on-surface font-mono mt-0.5">{config.server?.host ?? '-'}</p>
       </div>
       <div>
         <p class="text-[10px] text-on-surface-variant tracking-widest uppercase">PORT</p>
         <p class="text-sm text-on-surface font-mono mt-0.5">{config.server?.port ?? '-'}</p>
       </div>
       <div>
         <p class="text-[10px] text-on-surface-variant tracking-widest uppercase">AUTH_ENABLED</p>
         <p class="text-sm text-on-surface mt-0.5">{config.auth?.enabled ? 'Enabled' : 'Disabled'}</p>
       </div>
     </div>
   </section>
   ```

   **Section B — Pool Orchestration (col-span-12 md:col-span-8):**
   ```html
   <section class="col-span-12 md:col-span-8 bg-surface-container-low rounded-xl p-6 border border-white/5">
     <div class="flex items-center gap-3 mb-5">
       <div class="p-2 bg-primary/10 rounded-lg">
         <span class="material-symbols-outlined text-primary">hub</span>
       </div>
       <h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">POOL_ORCHESTRATION</h2>
     </div>

     <!-- Max Devices accent number -->
     <div class="mb-5 p-3 bg-surface-container rounded-lg">
       <p class="text-[10px] text-on-surface-variant tracking-widest uppercase">MAX_DEVICES</p>
       <p class="text-2xl font-bold text-primary mt-1">{config.pool?.max_devices ?? '-'}</p>
     </div>

     <!-- Android + iOS side by side -->
     <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
       {#if config.pool?.android}
         <div class="bg-surface-container rounded-lg p-4">
           <div class="flex items-center gap-2 mb-3">
             <span class="material-symbols-outlined text-sm text-secondary">android</span>
             <span class="font-headline text-xs tracking-widest text-on-surface font-bold">ANDROID</span>
             <span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary">
               {config.pool.android.enabled ? 'ACTIVE' : 'DISABLED'}
             </span>
           </div>
           <div class="space-y-2 text-xs">
             <div class="flex justify-between"><span class="text-on-surface-variant">Max Instances</span><span class="text-on-surface font-mono">{config.pool.android.max_instances}</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">API Level</span><span class="text-on-surface font-mono">{config.pool.android.api_level}</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">Profile</span><span class="text-on-surface font-mono">{config.pool.android.device_profile}</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">RAM</span><span class="text-on-surface font-mono">{config.pool.android.ram_mb} MB</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">Headless</span><span class="text-on-surface">{config.pool.android.headless ? 'Yes' : 'No'}</span></div>
           </div>
         </div>
       {/if}
       {#if config.pool?.ios}
         <div class="bg-surface-container rounded-lg p-4">
           <div class="flex items-center gap-2 mb-3">
             <span class="material-symbols-outlined text-sm text-on-surface-variant">phone_iphone</span>
             <span class="font-headline text-xs tracking-widest text-on-surface font-bold">IOS</span>
             <span class="text-[10px] px-1.5 py-0.5 rounded bg-on-surface-variant/10 text-on-surface-variant">
               {config.pool.ios.enabled ? 'ACTIVE' : 'DISABLED'}
             </span>
           </div>
           <div class="space-y-2 text-xs">
             <div class="flex justify-between"><span class="text-on-surface-variant">Max Instances</span><span class="text-on-surface font-mono">{config.pool.ios.max_instances}</span></div>
             {#if config.pool.ios.runtime}
               <div class="flex justify-between"><span class="text-on-surface-variant">Runtime</span><span class="text-on-surface font-mono">{config.pool.ios.runtime}</span></div>
             {/if}
             {#if config.pool.ios.device_type}
               <div class="flex justify-between"><span class="text-on-surface-variant">Device Type</span><span class="text-on-surface font-mono">{config.pool.ios.device_type}</span></div>
             {/if}
           </div>
         </div>
       {/if}
     </div>
   </section>
   ```

   **Section C — Job Execution Policy (col-span-12 md:col-span-7):**
   ```html
   <section class="col-span-12 md:col-span-7 bg-surface-container-low rounded-xl p-6 border border-white/5">
     <div class="flex items-center gap-3 mb-5">
       <div class="p-2 bg-primary/10 rounded-lg">
         <span class="material-symbols-outlined text-primary">play_circle</span>
       </div>
       <h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">JOB_EXECUTION_POLICY</h2>
     </div>
     <div class="grid grid-cols-3 gap-3">
       <div class="bg-surface-container rounded-lg p-4 text-center">
         <p class="text-2xl font-bold text-on-surface">{config.jobs?.timeout_minutes ?? '-'}</p>
         <p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">TIMEOUT_MIN</p>
       </div>
       <div class="bg-surface-container rounded-lg p-4 text-center">
         <p class="text-2xl font-bold text-on-surface">{config.jobs?.max_queue_size ?? '-'}</p>
         <p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">QUEUE_DEPTH</p>
       </div>
       <div class="bg-surface-container rounded-lg p-4 text-center">
         <p class="text-2xl font-bold text-on-surface">{config.jobs?.cleanup_completed_after_days ?? '-'}</p>
         <p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">CLEANUP_DAYS</p>
       </div>
     </div>
   </section>
   ```

   **Section D — Storage Subsystem (col-span-12 md:col-span-5):**
   ```html
   <section class="col-span-12 md:col-span-5 bg-surface-container-low rounded-xl p-6 border border-white/5">
     <div class="flex items-center gap-3 mb-5">
       <div class="p-2 bg-primary/10 rounded-lg">
         <span class="material-symbols-outlined text-primary">storage</span>
       </div>
       <h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">STORAGE_SUBSYSTEM</h2>
     </div>
     <div class="space-y-3">
       {#if config.storage?.artifacts}
         <div>
           <p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-2">ARTIFACTS</p>
           <div class="space-y-2 text-xs">
             <div class="flex justify-between"><span class="text-on-surface-variant">Path</span><span class="text-on-surface font-mono truncate ml-2">{config.storage.artifacts.path}</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">Retention</span><span class="text-on-surface">{config.storage.artifacts.retention_days} days</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">Compress After</span><span class="text-on-surface">{config.storage.artifacts.compress_after_days} days</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">Max Storage</span><span class="text-on-surface font-mono">{config.storage.artifacts.max_storage_gb} GB</span></div>
           </div>
         </div>
       {/if}
       {#if config.storage?.logs}
         <div class="pt-3 border-t border-white/5">
           <p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-2">LOGS</p>
           <div class="space-y-2 text-xs">
             <div class="flex justify-between"><span class="text-on-surface-variant">Path</span><span class="text-on-surface font-mono truncate ml-2">{config.storage.logs.path}</span></div>
             <div class="flex justify-between"><span class="text-on-surface-variant">Retention</span><span class="text-on-surface">{config.storage.logs.retention_days} days</span></div>
           </div>
         </div>
       {/if}
     </div>
   </section>
   ```

   Close the grid: `</div>`

4. **Verify zero `farm-*` and zero `divide-y` remnants** — The original had 69 `farm-*` refs and ~10 `divide-y` occurrences. All must be gone.

5. **Build check** — `npm run web:build` exits 0. Run all grep verifications from the slice plan.

## Must-Haves

- [ ] Zero `farm-*` token references in `settings/+page.svelte` (was 69)
- [ ] Zero `divide-y` occurrences (R024)
- [ ] "DEVICE_FARM_CONFIG" headline present
- [ ] READ_ONLY badge present
- [ ] `grid-cols-12` bento layout
- [ ] SERVER_PARAMETERS section with host, port, auth_enabled
- [ ] POOL_ORCHESTRATION section with max_devices accent number + Android/iOS side-by-side
- [ ] JOB_EXECUTION_POLICY section with 3 large metric cards (timeout, queue, cleanup)
- [ ] STORAGE_SUBSYSTEM section with artifacts and logs key-value rows
- [ ] Section header pattern: icon in `p-2 bg-primary/10 rounded-lg` + `font-headline font-bold text-sm tracking-widest`
- [ ] All config data mapping preserved (server, pool, storage, jobs, auth)
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -c 'farm-' web/src/routes/settings/+page.svelte` returns 0
- `grep -c 'divide-y' web/src/routes/settings/+page.svelte` returns 0
- `grep -c 'bg-red-50' web/src/routes/settings/+page.svelte` returns 0
- `grep 'DEVICE_FARM_CONFIG' web/src/routes/settings/+page.svelte` matches
- `grep 'READ_ONLY' web/src/routes/settings/+page.svelte` matches
- `grep 'grid-cols-12' web/src/routes/settings/+page.svelte` matches
- `grep 'SERVER_PARAMETERS' web/src/routes/settings/+page.svelte` matches
- `grep 'POOL_ORCHESTRATION' web/src/routes/settings/+page.svelte` matches
- `grep 'JOB_EXECUTION_POLICY' web/src/routes/settings/+page.svelte` matches (or JOB_EXECUTION)
- `grep 'STORAGE_SUBSYSTEM' web/src/routes/settings/+page.svelte` matches
- `grep 'surface-container-low' web/src/routes/settings/+page.svelte` matches

## Inputs

- `web/src/routes/settings/+page.svelte` — Current 174-line file with 69 `farm-*` refs. Script block (lines 1–17) must be preserved exactly.
- Config API shape: `server: {host, port}`, `pool: {max_devices, android: {...}, ios: {...}}`, `storage: {artifacts: {...}, logs: {...}}`, `jobs: {timeout_minutes, max_queue_size, cleanup_completed_after_days}`, `auth: {enabled}`
- T01 and T02 already completed — login and devices pages reskinned
- Section header pattern from S01 research: icon in `p-2 bg-primary/10 rounded-lg` + `font-headline font-bold text-sm tracking-widest`

## Observability Impact

- **Config load state:** Loading state renders `text-on-surface-variant` centered text; error state renders `bg-tertiary/10 border-tertiary/20 text-tertiary` banner with error message. Both inspectable via DOM.
- **Bento grid structure:** 4 sections in a `grid-cols-12` layout — inspectable via `browser_find` for headings SERVER_PARAMETERS, POOL_ORCHESTRATION, JOB_EXECUTION_POLICY, STORAGE_SUBSYSTEM.
- **Network:** Single `GET /api/config` request populates all sections. Network tab shows request status; failed fetch surfaces error banner.
- **Token migration:** `grep -c 'farm-' web/src/routes/settings/+page.svelte` = 0 confirms complete migration. `grep -c 'divide-y'` = 0 confirms R024 compliance.

## Expected Output

- `web/src/routes/settings/+page.svelte` — Fully reskinned with bento grid layout, 4 modular sections, zero `farm-*` tokens, zero `divide-y` borders
