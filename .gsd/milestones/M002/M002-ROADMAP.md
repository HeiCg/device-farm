# M002: Kinetic Console Reskin

**Vision:** Complete visual overhaul of the Device Farm web UI from Jenkins-utilitarian light theme to a dark "Kinetic Console" command-center aesthetic. Every token, component, and layout changes. All data wiring stays intact.

## Success Criteria

- Every route renders with obsidian dark theme — no trace of Jenkins light theme
- Space Grotesk + Inter fonts load and render correctly throughout
- All components use the reference color tokens — no hardcoded Jenkins-era colors remain
- No-Line Rule observed — no 1px solid borders for sectioning
- Mobile bottom nav works on small viewports
- All data is real — no mock metrics, no placeholder sections
- No RUN_NEW_JOB button, no placeholder nav items
- `npm run web:build` succeeds with zero errors

## Key Risks / Unknowns

- Tailwind v4 `@theme` token translation — the reference uses v3 config format; must map correctly to `@theme` CSS custom properties
- Glass card backdrop-filter performance — acceptable tradeoff, but worth confirming renders correctly
- Build History card grid layout — significant structural change from list; must preserve pagination and filter wiring

## Proof Strategy

- Tailwind v4 token translation → retire in S01 by proving all ~40 tokens render as expected utility classes
- Build History card grid → retire in S04 by proving filters, pagination, and card layout work together

## Verification Classes

- Contract verification: `npm run web:build` passes, `grep` confirms no old tokens/colors remain
- Integration verification: all pages show real data from server APIs, WebSocket streams work
- Operational verification: none
- UAT / human verification: visual comparison against reference PNGs for each page

## Milestone Definition of Done

This milestone is complete only when all are true:

- All 6 routes render with obsidian dark theme
- `npm run web:build` succeeds
- Zero occurrences of `farm-canvas`, `farm-subtle`, `farm-border`, `farm-fg`, `farm-accent`, `farm-sidebar` or any M001-era token in component source
- Space Grotesk and Inter fonts load via CDN and render
- Mobile bottom nav visible on viewports < 768px
- All data surfaces wired to real APIs
- Reference design visual fidelity confirmed per-page

## Requirement Coverage

- Covers: R012, R013, R014, R015, R016, R017, R018, R019, R020, R021, R022, R023, R024, R025, R026, R027, R028
- Partially covers: none
- Leaves for later: none
- Orphan risks: none

## Slices

- [x] **S01: Design Foundation — Tokens, Fonts, Shared Components** `risk:high` `depends:[]`
  > After this: open any page and see obsidian background, purple accents, Space Grotesk headlines, glass card surfaces. StatusBadge, AlertBanner, Filters, Pagination, FlakeyBadge all use new token system. Web app builds.

- [x] **S02: App Shell — Top Navbar, Sidebar, Mobile Nav, Layout** `risk:high` `depends:[S01]`
  > After this: top navbar shows "DEVICE_FARM" brand + nav links + search. Sidebar shows nav items + queue + executor status + health bar. Mobile bottom nav appears on small screens. Content area offsets correctly under both shell elements.

- [x] **S03: Dashboard — Bento Grid Fleet Overview** `risk:medium` `depends:[S02]`
  > After this: dashboard shows infrastructure health glass card with green percentage, queue cards per platform, system alert banners, active fleet status table, recent builds column — all wired to real health/jobs data.

- [x] **S04: Jobs — Build History Cards + Job Detail** `risk:medium` `depends:[S02]`
  > After this: Build History shows responsive card grid with status-colored left borders, filter tabs, platform toggle, load-more pagination. Job Detail shows sidebar with steps cluster + real metrics, terminal log viewer, tabs.

- [x] **S05: Remaining Pages — Runners, Settings, Login** `risk:low` `depends:[S02]`
  > After this: Runners shows per-device cards grouped by platform with state-specific content. Settings shows modular data sections. Login shows cinematic dark auth screen with gradient CTA.

## Boundary Map

### S01 → S02

Produces:
- `app.css` — Complete `@theme` block with ~40 color tokens (background, primary, secondary, tertiary, surface-container tiers, on-surface variants, outline variants)
- `app.css` — `font-headline`, `font-body`, `font-label` font families registered
- `app.css` — `.glass-card` CSS utility class
- `app.css` — `.log-viewer` scrollbar styles updated for dark theme
- `app.css` — Custom border radius scale (sm=0.125rem, lg=0.25rem, xl=0.5rem)
- `StatusBadge.svelte` — Tinted pill badges using new token colors (secondary/tertiary/primary/surface-variant)
- `AlertBanner.svelte` — Dark tinted banners using tertiary-container tokens
- `Filters.svelte` — Dark-themed select dropdowns using surface-container tokens
- `Pagination.svelte` — Dark-themed load-more button
- `FlakeyBadge.svelte` — Dark-themed flaky indicator
- `format.ts` — `statusStyle()` updated to return new token class names

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- All shared components listed above, used extensively on dashboard
- Glass card class used for all dashboard cards

Consumes:
- nothing (first slice)

### S01 → S04

Produces:
- StatusBadge, FlakeyBadge for job cards and step list
- AlertBanner for job errors
- Filters, Pagination for build history
- `statusStyle()` for color mapping

Consumes:
- nothing (first slice)

### S01 → S05

Produces:
- StatusBadge for device cards
- Glass card class for settings sections and device cards
- All token colors for login page

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- `+layout.svelte` — New shell with top navbar + sidebar + content area offset (`md:pl-64 pt-16`)
- `Header.svelte` — Rewritten as top navbar with brand, nav links, search, icons
- `Nav.svelte` — Rewritten as left sidebar with COMMAND_CENTER header, nav items, queue, executor status, health bar
- `MobileNav.svelte` — New bottom nav for mobile viewports

Consumes from S01:
- All color tokens (background, primary, surface-container, outline-variant)
- Font families (font-headline, font-body, font-label)
- Glass card class for sidebar sections

### S02 → S04

Produces:
- Layout shell — job pages render inside the new shell structure
- Top navbar — JOBS link shows active state on job pages

Consumes from S01:
- Color tokens, font families

### S02 → S05

Produces:
- Layout shell — all remaining pages render inside new shell
- Login page renders outside shell (no navbar/sidebar)

Consumes from S01:
- Color tokens, font families
