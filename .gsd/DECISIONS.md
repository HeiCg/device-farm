# Decisions Register

<!-- Append-only. Never edit or remove existing rows.
     To reverse a decision, add a new row that supersedes it.
     Read this file at the start of any planning or research phase. -->

| # | When | Scope | Decision | Choice | Rationale | Revisable? | Made By |
|---|------|-------|----------|--------|-----------|------------|---------|
| D001 | M001 | convention | Icon library | Material Symbols Outlined | Reference design uses it exclusively; already loaded via CDN | No | agent |
| D002 | M001 | convention | CSS token namespace | `farm-*` prefix | Already partially established in app.css; matches project name | No | agent |
| D003 | M001 | convention | Status indicator style | Jenkins status balls (colored circles) + weather metaphor | User chose full Jenkins metaphor over simplified dots | No | agent |
| D004 | M001 | convention | UI density | Jenkins-utilitarian — dense, information-first, no decorative fluff | User explicitly chose "Jenkins utilitarian" over "modernized Jenkins" | No | agent |
| D005 | M001 | convention | Dashboard content pattern | Adopt reference patterns (health widget, alerts, device table, quick actions) | User chose to adopt reference content patterns over visual-only reskin | No | agent |
| D006 | M001 | arch | Top navbar | Full dark navy top bar with breadcrumbs, user section, search icon | User confirmed; matches reference exactly | No | agent |
| D007 | M002 | convention | Design system | Kinetic Console — obsidian dark command-center aesthetic | Supersedes D003, D004: user provided complete reference designs (6 screens + DESIGN.md) with dark theme, glass cards, tonal layering | No | agent |
| D008 | M002 | convention | Color token system | Reference Tailwind config as source of truth (~40 tokens: background #0e0e0e, primary #c39bff, secondary #00fd93, tertiary #ff7168, surface-container tiers) | User chose "Use as source of truth" over loose interpretation | No | agent |
| D009 | M002 | convention | Typography | Space Grotesk (headlines/labels) + Inter (body/data) via Google Fonts CDN | Design system specifies dual-font for technical clarity; user confirmed both | No | agent |
| D010 | M002 | convention | Branding | "Device Farm" everywhere — not "KINETIC_CONSOLE" | Visual language transfers from reference, product identity stays | No | agent |
| D011 | M002 | convention | Navigation items | Real routes only (Dashboard, Jobs, Devices, Settings) | No placeholders for Analytics/Reports/Test Suites/Logs — user chose clean over matching reference | No | agent |
| D012 | M002 | convention | RUN_NEW_JOB button | Not included — no sidebar CTA, no FAB | Job submission is CLI-only; no dead buttons | No | agent |
| D013 | M002 | convention | Mock data surfaces | Not included — no CPU Load, RAM Usage, Network Profiler, Memory Heap, Leak Detection | User said "remove these mocks" — only real API data gets a UI surface | No | agent |
| D014 | M002 | convention | Mobile navigation | Bottom nav bar included | Responsive support — user wants dashboard usable from phone | No | agent |
| D015 | M002 | convention | Status indicator style | Tinted pill badges with colored backgrounds/borders | Supersedes D003: new reference uses pill badges, not solid circles | No | agent |
| D016 | M002/S01 | convention | Tailwind v4 class construction pattern | Full static class strings in lookup maps — never template-string interpolation like `bg-${color}/10` | Tailwind v4 JIT scans source files for complete class name strings at build time. Dynamically-constructed names are invisible to the scanner and produce no CSS output. Especially critical with custom @theme tokens that have no fallback. | No | agent |
| D017 | M002/S04/T01 | convention | Reactive lookup pattern for Svelte 5 template-level computed values | Use `$derived` instead of `{@const}` for reactive Record lookups in component top-level template | Svelte 5 restricts `{@const}` to block contexts ({#if}, {#each}, etc.) — it cannot be used at top-level template scope. `$derived` achieves the same D016-safe result (full static class string via Record lookup) while being reactive and valid at any scope level. | No | agent |
| D018 | M003 | arch | Hierarchy viewer default source | Maestro CLI (`maestro hierarchy --device`) as default, with APK (device-server) and native (adb/idb) as switchable alternatives | Maestro's hierarchy parser differs from raw UiAutomator — showing Maestro's view by default ensures selectors in flows match what the user sees during inspection | No | agent |
| D019 | M003 | arch | Hierarchy overlay rendering | SVG over screenshot (not Canvas) | SVG gives free hover/click events on elements; hierarchy trees rarely exceed ~500 visible elements, so perf is fine. Canvas would require manual hit-testing. | Yes — if perf becomes an issue with very deep trees | agent |
| D020 | M003 | arch | Device interaction from browser | Out of scope for M003 | User explicitly deferred tap/swipe/type from browser. Inspector is read-only. | Yes — future milestone | agent |
| D021 | M003/S03 | convention | Destructive action confirmation pattern | Two-click inline pattern (first click shows Yes/No confirmation replacing action buttons) instead of modal dialog | Inline confirmation keeps the user's attention on the item being deleted without a disruptive modal overlay. HookList passes deleteConfirm state from parent to control which row is in confirmation mode. Simpler than a shared modal component and consistent with the dense, information-first UI philosophy (D004/D007). | Yes | agent |
| D022 | M005 | architecture | Appium role in Device Farm | Appium used only for hierarchy fetching (getPageSource), NOT for test execution | User explicitly stated Maestro remains the sole test executor. Appium provides a 4th hierarchy source — better than raw adb uiautomator dump because Appium maintains a persistent UiAutomator2 server on device, and supports iOS via XCUITest driver. | Yes | human |
