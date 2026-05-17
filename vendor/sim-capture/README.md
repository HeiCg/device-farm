# vendor/sim-capture — reserved for Swift source vendoring

**Status:** Empty scaffold. Contents deferred to a follow-up plan.

## Background

`cli/cmd/dependencies.go` ships `installSimCapture()`, which builds the
`sim-capture` Swift binary used for iOS simulator screen capture. Today
`installSimCapture` expects a sibling `../device-stream/tools/sim-capture`
directory — the same problem @device-stream/* had before Phase 17 Plan 17-06.

## Scope of Plan 17-06

Plan 17-06 closed the **npm package** portion of DEBT-01 (the three
`@device-stream/*` JavaScript packages). The **Swift source** vendoring
required to make `installSimCapture` work on a fresh-cloned device-farm
WITHOUT a sibling device-stream repo is out of scope for Plan 17-06.

`installSimCapture` is only called from the `device-farm dependencies`
command at user-setup time, not at `npm install` time — so the main
DEBT-01 goal ("fresh-clone + `npm install` succeeds without sibling
repo") is satisfied by Plan 17-06 alone.

## Follow-up

A subsequent plan (likely in Phase 20 Pool Module or Phase 28 CLI
Refactor scope) will:

1. Vendor `tools/sim-capture/` (Package.swift + Sources/) under this
   directory
2. Update `cli/cmd/dependencies.go:installSimCapture()` to look in
   `vendor/sim-capture/` instead of `../device-stream/tools/sim-capture/`
3. Add an integration test that runs `installSimCapture` against the
   vendored source on a clean checkout

See `17-VERIFICATION.md` SC4 — the verification report notes this deferral.
