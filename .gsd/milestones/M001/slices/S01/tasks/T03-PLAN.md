---
estimated_steps: 5
estimated_files: 2
---

# T03: Build WeatherIcon and AlertBanner components

**Slice:** S01 — Design tokens + base components
**Milestone:** M001

## Description

Create two new shared components that the reference design uses heavily and downstream slices (S03 dashboard, S05 devices) depend on: WeatherIcon (health percentage → weather metaphor) and AlertBanner (colored left-border alert strips).

## Steps

1. Create WeatherIcon.svelte — accepts `healthPercent` prop, renders Material Symbol icon: `sunny` (>80%), `cloudy` (50-80%), `rainy` (<50%). Color: sunny=text-yellow-500, cloudy=text-slate-400, rainy=text-slate-300. Size matches reference (text-sm).
2. Create AlertBanner.svelte — accepts `variant` ('critical'|'warning'|'info') and `message` prop. Renders reference pattern: colored left border (border-l-4), tinted background, Material Symbol icon, bold label prefix, message text. Support optional `href` prop for "Details »" link.
3. Add optional `children` snippet support in AlertBanner for custom content after the message
4. Verify both components have no `gh-*` or Lucide references
5. Verify both files are substantive (>20 lines)

## Must-Haves

- [ ] WeatherIcon renders sunny/cloudy/rainy based on healthPercent thresholds (>80 / 50-80 / <50)
- [ ] AlertBanner renders critical (red), warning (yellow), info (blue) variants matching reference styles
- [ ] Both components use Material Symbols Outlined exclusively
- [ ] Both components use `farm-*` tokens where applicable
- [ ] Both files are >20 lines with real implementation

## Verification

- Both files exist: `ls web/src/lib/components/shared/WeatherIcon.svelte web/src/lib/components/shared/AlertBanner.svelte`
- `grep -r 'lucide-svelte\|gh-' web/src/lib/components/shared/WeatherIcon.svelte web/src/lib/components/shared/AlertBanner.svelte` returns nothing
- `wc -l` for both files shows >20 lines each

## Inputs

- Reference HTML for visual patterns (alert banners, weather icons)
- T01 output: `app.css` with aligned `farm-*` tokens

## Expected Output

- `web/src/lib/components/shared/WeatherIcon.svelte` — weather metaphor component (new file)
- `web/src/lib/components/shared/AlertBanner.svelte` — alert banner component (new file)
