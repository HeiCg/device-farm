---
id: S05
milestone: M001
provides:
  - DeviceCard using StatusBadge + Material Symbols (restart_alt icon)
  - Devices page with StatusBadge summary dots, farm-* tokens
  - Settings page fully on farm-* tokens
  - Login page with Material Symbols icon, farm-* tokens
  - lucide-svelte removed from package.json (220 → 0 lucide modules)
requires:
  - slice: S01
    provides: StatusBadge, farm-* tokens, Material Symbols pattern
affects: []
key_files:
  - web/src/lib/components/devices/DeviceCard.svelte
  - web/src/routes/devices/+page.svelte
  - web/src/routes/settings/+page.svelte
  - web/src/routes/login/+page.svelte
  - web/package.json
key_decisions:
  - "DeviceCard uses StatusBadge instead of Lucide Circle for status dots"
  - "Devices page summary uses StatusBadge at size=10 for compact dots"
  - "Login uses settings_input_component icon (matches header)"
patterns_established: []
drill_down_paths: []
duration: 10min
verification_result: pass
completed_at: 2026-03-16T02:30:00Z
---

# S05: Devices, Settings, Login + final cleanup

**All remaining pages migrated to farm-* tokens + Material Symbols; lucide-svelte removed; zero gh-*/lucide references in codebase**

## What Happened

Migrated the final 4 files: DeviceCard (Lucide Circle/RotateCcw → StatusBadge + Material Symbols restart_alt), devices page (Lucide Circle → StatusBadge, all gh-* → farm-*), settings page (pure gh-* → farm-* sed replacement, 60+ token swaps), login page (Lucide Cpu → Material Symbols settings_input_component, gh-* → farm-*). Uninstalled lucide-svelte — build module count dropped from ~3500 to ~490 (client).

## Verification

- `grep -r 'gh-' web/src/ --include='*.svelte' --include='*.ts' | grep -v .svelte-kit` → zero hits
- `grep -r 'lucide-svelte' web/src/` → zero hits
- `grep 'lucide' web/package.json` → not found
- `npm run web:build` → passes (220 server modules, 490 client modules)

## Deviations

None.

## Files Created/Modified

- `web/src/lib/components/devices/DeviceCard.svelte` — StatusBadge + Material Symbols
- `web/src/routes/devices/+page.svelte` — StatusBadge summary dots, farm-* tokens
- `web/src/routes/settings/+page.svelte` — farm-* tokens (60+ replacements)
- `web/src/routes/login/+page.svelte` — Material Symbols icon, farm-* tokens
- `web/package.json` — lucide-svelte removed
