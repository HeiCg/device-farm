# S05: Devices, Settings, Login + final cleanup — UAT

## Prerequisites
- Device Farm web app running (`npm run web:dev`)

## Visual Checks

### 1. Devices Page (/devices)
- Status summary dots next to "Runners" heading use colored status balls
- Devices grouped by platform (Android / iOS)
- Each device row shows status ball, name, platform badge, emulator ID
- Error devices show "Restart" button with restart icon

### 2. Settings Page (/settings)
- Section cards (Server, Pool, Storage, Jobs) with consistent styling
- No unstyled or broken token references

### 3. Login Page (/login)
- Dark icon with settings_input_component symbol
- "Sign in to Device Farm" heading
- Form with API Key input and Sign in button
- Error state shows red alert on invalid key

## Final Verification
- Run `grep -r 'gh-' web/src/ --include='*.svelte' --include='*.ts' | grep -v .svelte-kit` → zero results
- Run `grep -r 'lucide' web/src/ --include='*.svelte' --include='*.ts' | grep -v .svelte-kit` → zero results
- `npm run web:build` passes
