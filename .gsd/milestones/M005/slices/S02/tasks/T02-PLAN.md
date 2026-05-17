---
estimated_steps: 1
estimated_files: 3
skills_used: []
---

# T02: SourceSelector UI — 4th option + disabled state

Update SourceSelector.svelte to show 4 options. Add 'appium' with disabled state when Appium not available (check via /api/appium/status). Update HierarchySource type in web types. Show tooltip on disabled option explaining how to install Appium.

## Inputs

- `web/src/lib/components/inspector/SourceSelector.svelte`

## Expected Output

- `web/src/lib/components/inspector/SourceSelector.svelte`
- `web/src/lib/api/types.ts`

## Verification

npx svelte-check --threshold error && npm run web:build
