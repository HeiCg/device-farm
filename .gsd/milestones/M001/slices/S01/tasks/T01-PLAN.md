---
estimated_steps: 5
estimated_files: 2
---

# T01: Align design tokens and migrate shared utilities

**Slice:** S01 — Design tokens + base components
**Milestone:** M001

## Description

Audit and align `app.css` `@theme` tokens against the reference HTML's color palette. Fix any mismatches and ensure the `farm-*` namespace covers everything the reference uses. Then migrate `statusStyle()` in `format.ts` from dead `gh-*` classes to `farm-*`.

## Steps

1. Read the reference HTML's tailwind config to extract every color definition
2. Compare against current `app.css` `@theme` block — identify mismatches and gaps
3. Update `app.css` tokens to match reference exactly, preserving the `farm-*` namespace
4. Replace all `gh-*` references in `format.ts` with `farm-*` equivalents
5. Verify `.jenkins-table`, `.status-ball`, `.sidebar-link` CSS classes match reference styles

## Must-Haves

- [ ] `farm-success` = `#1e40af`, `farm-danger` = `#ef4444`, `farm-unstable` = `#fbbf24`, `farm-aborted` = `#94a3b8`
- [ ] `statusStyle()` returns `farm-*` classes, not `gh-*`
- [ ] Zero `gh-*` occurrences in `app.css` and `format.ts`

## Verification

- `grep -c 'gh-' web/src/app.css` returns 0
- `grep -c 'gh-' web/src/lib/utils/format.ts` returns 0
- Token values in `@theme` match reference HTML's tailwind config

## Inputs

- Reference HTML: `/Users/heicg/Downloads/stitch_acesso_remoto_live_testing/code.html` — tailwind config color definitions
- `web/src/app.css` — current token definitions
- `web/src/lib/utils/format.ts` — `statusStyle()` with `gh-*` classes

## Expected Output

- `web/src/app.css` — tokens aligned with reference, zero `gh-*`
- `web/src/lib/utils/format.ts` — `statusStyle()` using `farm-*` tokens
