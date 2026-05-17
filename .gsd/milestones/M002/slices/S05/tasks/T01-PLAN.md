---
estimated_steps: 4
estimated_files: 2
---

# T01: Reskin Login page to cinematic dark auth screen

**Slice:** S05 — Remaining Pages — Runners, Settings, Login
**Milestone:** M002

## Description

Rewrite the Login page from its Jenkins-era light theme (74 lines, 9 `farm-*` token refs) to a cinematic Kinetic Console dark auth screen. This is the app's first impression — it renders outside the app shell (`+layout.svelte` bypasses Header/Nav/MobileNav when `onLoginPage` is true, so the login page must provide its own full-screen container). Also adds a `.kinetic-gradient` CSS class to `app.css` for the radial gradient background effect.

All auth logic stays identical — `handleSubmit`, `setApiKey`, `clearApiKey`, `apiFetch('/admin/keys')`, error handling, submitting state. Only the template and styling change.

**Relevant decisions:** D010 (branding is "DEVICE_FARM" not "KINETIC_CONSOLE"), D016 (static class strings in lookup maps), R024 (no 1px solid sectioning borders).

**Relevant skill:** `frontend-design` — load for design guidance if needed.

## Steps

1. **Add `.kinetic-gradient` CSS class to `web/src/app.css`** — Insert after the `.glass-card` block (around line 101). This is a custom CSS class with a dark radial gradient using the primary color token:
   ```css
   .kinetic-gradient {
     background: radial-gradient(ellipse at top, rgba(195, 155, 255, 0.08) 0%, transparent 50%),
                 radial-gradient(ellipse at bottom right, rgba(0, 253, 147, 0.03) 0%, transparent 40%),
                 var(--color-background);
   }
   ```

2. **Rewrite `web/src/routes/login/+page.svelte` template** — Keep the entire `<script lang="ts">` block exactly as-is (lines 1–31). Replace the template (lines 33–74) with the Kinetic Console design:

   **Outer container:** `<div class="min-h-screen bg-background kinetic-gradient flex items-center justify-center p-4 relative overflow-hidden">`

   **Ambient blur orbs** (decorative, absolute positioned inside the container):
   - `<div class="absolute top-1/4 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>`
   - `<div class="absolute bottom-1/4 -right-32 w-64 h-64 bg-secondary/5 rounded-full blur-3xl"></div>`

   **Card:** `<div class="relative w-full max-w-sm">` wrapping a `<div class="bg-surface-container-high/80 backdrop-blur-xl rounded-2xl p-8 border border-outline-variant/10 shadow-2xl">`

   **Card content (top to bottom):**
   - Terminal icon: `<div class="flex justify-center mb-6"><div class="p-3 bg-primary/10 rounded-xl"><span class="material-symbols-outlined text-3xl text-primary">terminal</span></div></div>`
   - Headline: `<h1 class="text-center font-headline text-xl font-bold text-on-surface tracking-wide mb-1">DEVICE_FARM</h1>`
   - Subtitle: `<p class="text-center text-on-surface-variant text-xs tracking-[0.2em] uppercase mb-8">COMMAND CENTER AUTHORIZATION</p>`
   - Form (wrap in `<form onsubmit={handleSubmit}>`):
     - Label: `<label for="api-key" class="block text-xs font-headline tracking-widest text-on-surface-variant uppercase mb-2">SYSTEM ACCESS KEY</label>`
     - Input wrapper: `<div class="relative mb-4">` containing:
       - Icon: `<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant">key</span>`
       - Input: `<input id="api-key" type="password" bind:value={apiKeyInput} placeholder="Enter access key" class="w-full pl-10 pr-4 py-3 text-sm bg-surface-container-low border border-outline-variant/10 rounded-lg text-on-surface placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-colors" disabled={submitting} />`
     - Error (conditional): `{#if errorMsg}<div class="mb-4 px-3 py-2.5 rounded-lg bg-tertiary/10 border border-tertiary/20"><p class="text-xs text-tertiary">{errorMsg}</p></div>{/if}`
     - Button: `<button type="submit" disabled={submitting} class="w-full py-3 px-4 text-sm font-headline font-bold tracking-widest text-white bg-gradient-to-r from-primary to-primary/70 rounded-lg hover:from-primary/90 hover:to-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all">{submitting ? 'AUTHENTICATING...' : 'INITIALIZE_SESSION'}</button>`

   **System status footer** (outside card, inside outer container):
   - `<div class="mt-6 flex items-center justify-center gap-2"><span class="relative flex h-2 w-2"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span><span class="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span></span><span class="text-xs text-on-surface-variant tracking-widest uppercase">SYSTEM_ONLINE</span></div>`

3. **Remove all `farm-*` class references** — Verify zero remain. The original had: `bg-farm-subtle`, `bg-farm-sidebar`, `text-farm-fg` (×3), `border-farm-border` (×2), `bg-farm-canvas` (×2), `focus:ring-farm-accent`, `focus:border-farm-accent`, `border-farm-danger/30`, `bg-red-50`, `text-farm-danger`, `bg-farm-success`, `focus:ring-farm-success`. ALL of these must be gone from the rewritten template.

4. **Build and verify** — Run `npm run web:build` and all grep checks.

## Must-Haves

- [ ] `.kinetic-gradient` CSS class added to `app.css`
- [ ] Zero `farm-*` token references in login page
- [ ] "DEVICE_FARM" headline present (D010)
- [ ] "COMMAND CENTER AUTHORIZATION" subtitle present
- [ ] "SYSTEM ACCESS KEY" label present
- [ ] "INITIALIZE_SESSION" button text present
- [ ] System status footer with green pulse dot + "SYSTEM_ONLINE"
- [ ] Purple gradient button (`bg-gradient-to-r from-primary`)
- [ ] Error state uses tertiary tokens (not `bg-red-50` or `farm-danger`)
- [ ] Auth logic (`handleSubmit`, `setApiKey`, `clearApiKey`, `apiFetch`) unchanged
- [ ] `npm run web:build` exits 0

## Verification

- `npm run web:build` exits 0
- `grep -c 'farm-' web/src/routes/login/+page.svelte` returns 0
- `grep -c 'bg-red-50' web/src/routes/login/+page.svelte` returns 0
- `grep 'DEVICE_FARM' web/src/routes/login/+page.svelte` matches
- `grep 'INITIALIZE_SESSION' web/src/routes/login/+page.svelte` matches
- `grep 'COMMAND CENTER AUTHORIZATION' web/src/routes/login/+page.svelte` matches
- `grep 'kinetic-gradient' web/src/routes/login/+page.svelte` matches
- `grep 'kinetic-gradient' web/src/app.css` matches
- `grep 'bg-background' web/src/routes/login/+page.svelte` matches

## Inputs

- `web/src/routes/login/+page.svelte` — Current 74-line file with 9 `farm-*` refs. Script block (lines 1–31) must be preserved exactly.
- `web/src/app.css` — Has `.glass-card` class (line 95). New `.kinetic-gradient` class goes after it.
- Auth store imports: `$lib/auth/auth-store.svelte.js` (`setApiKey`, `clearApiKey`), `$lib/api/client.js` (`apiFetch`) — these imports stay unchanged.

## Expected Output

- `web/src/app.css` — `.kinetic-gradient` CSS class added (~5 lines)
- `web/src/routes/login/+page.svelte` — Fully reskinned with cinematic dark auth, zero `farm-*` tokens, all auth logic preserved

## Observability Impact

- **Auth error visibility:** Error messages now render in a `bg-tertiary/10 border-tertiary/20` banner instead of `bg-red-50 border-farm-danger/30`. The error text content is unchanged — a future agent can inspect via `browser_find` for text containing "Invalid API key" or by checking for the tertiary-styled error div.
- **Login page inspection:** The page is self-contained (no app shell). Key landmarks: `<h1>` with "DEVICE_FARM", form with `id="api-key"` input, submit button with "INITIALIZE_SESSION" text. All discoverable via accessibility tree.
- **CSS class addition:** `.kinetic-gradient` in `app.css` is a passive background class. It has no runtime behavior — purely visual. Can be verified via `grep kinetic-gradient web/src/app.css`.
- **No new runtime signals:** This task changes only template/styling. No new console logs, network requests, or error paths are introduced. The existing auth flow (`apiFetch('/admin/keys')`) is unchanged.
