# PR Review Bot — Agent Skeleton

**Phase 34 Plan 34-08 stub.** Breadcrumb for Phase 37 Track C (GitHub PR
comment integration). This file documents the agent prompt + tool
sequence using only the Phase 34 MCP surface; the full implementation
(GitHub App pairing, webhook HMAC verification, comment edit-in-place)
lands in Phase 37.

## Use case

A PR opens against a mobile app repo. CI builds the APK / IPA artifact
and uploads it to device-farm. A bot agent leases a device, installs the
build, walks a fixed list of "must verify" screens, captures
screenshots, and reports any visual regressions back into the PR as a
comment.

## Agent prompt skeleton

> You are a PR review bot for the [APP NAME] mobile app. Given:
>
> - An uploaded build artifact id (APK or IPA): `<artifactId>`
> - A bundle id: `<bundleId>`
> - A screen list (ordered tap descriptions to navigate): `<screens>`
>
> Drive the build through every screen in order:
>
> 1. Lease an `android` (or `ios`) device for 600 seconds.
> 2. Install the artifact.
> 3. Launch the bundle id.
> 4. For each screen in the list:
>    - Take a screenshot.
>    - Tap on the next screen's description.
>    - Wait briefly for the navigation to settle (~500ms).
> 5. Take a final screenshot of the last screen.
> 6. Release the device.
> 7. Output a JSON summary: `{screensVisited, screenshotArtifactIds[], errors[]}`.
>
> If any tap returns `resolver_failed`, log the screen description and
> continue to the next screen. If `device_install` fails, abort and
> return the install error.

## Tool sequence (Phase 34 MCP surface only)

```
device_lease(platform="android", ttlSeconds=600)
  -> {sessionId, deviceId, wsUrl, ...}

device_install(sessionId, artifactId="<APK_UUID>")
device_launch(sessionId, bundleId="com.example.app")

# Per-screen loop:
device_screenshot(sessionId)
  -> {url, width, height} + base64 image content
device_tap_by_description(sessionId, target="Sign In button")
# ... navigate to next screen ...
device_screenshot(sessionId)
device_tap_by_description(sessionId, target="Settings gear icon")
# ... continue ...

device_release(sessionId)
```

## What Phase 37 adds

- GitHub App pairing + webhook signature verification.
- `--github-pr <number>` flag that posts the agent output as a PR
  comment (and edits it in place on subsequent runs of the same PR).
- Visual diff: compare current run's screenshots against the most
  recent main-branch baseline.
- Failure surfacing: red ❌ inline on the comment for any screen with a
  resolver failure or visual diff > threshold.

## Recommended `SESSION_RESOLVER` setting

`claude-vision` — PR review screens often have varied layouts where the
Maestro AI XML heuristic falls below the 0.5 confidence gate. The
FallbackResolver chain handles the cost overhead by trying Maestro AI
first; Claude Vision fires only on low-confidence misses. See
`docs/runbooks/session-resolver-costs.md`.

## Status

**Phase 34: SKELETON ONLY.** Full implementation lands in Phase 37 Track
C per the roadmap. Phase 34 ships the MCP tool surface this agent
depends on.
