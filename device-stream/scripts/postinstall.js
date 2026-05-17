// Postinstall hook for @device-stream.
// Builds the sim-capture-private daemon on darwin/arm64 hosts (macOS Apple
// Silicon). Non-blocking: a build failure prints a warning but does not
// abort `npm install` — the TypeScript adapter (SimCapturePrivateClient)
// detects the missing binary and falls back to the sim-capture-avcc path
// at runtime.
//
// Skip gates:
//   DEVICE_STREAM_SKIP_BUILD=1 — explicit skip (CI / dev iteration)
//   process.platform !== 'darwin' — non-macOS host (sim-capture is macOS-only)
//   os.arch() !== 'arm64'        — Intel macs (Apple Silicon required per
//                                  32-RESEARCH.md Risks)
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

function isSupportedHost() {
  if (process.env.DEVICE_STREAM_SKIP_BUILD === '1') return false;
  if (process.platform !== 'darwin') return false;
  if (os.arch() !== 'arm64') return false;
  return true;
}

if (!isSupportedHost()) {
  console.log('[device-stream postinstall] skipping native build (platform=%s arch=%s skip=%s)',
    process.platform, os.arch(), process.env.DEVICE_STREAM_SKIP_BUILD ?? '');
  process.exit(0);
}

const scriptDir = path.resolve(__dirname);

const tasks = [
  ['bash', [path.join(scriptDir, 'build-sim-capture-private.sh')], 'sim-capture-private'],
  // Phase 33: Android gRPC daemon (canary — opt-in via DEVICE_STREAM_ANDROID_GRPC=1).
  // Build is gated on process.platform === 'darwin' (via isSupportedHost above);
  // failure is a WARNING (Node falls back to scrcpy automatically). Wave 5
  // (T-33.8) replaces the script body with a real build.
  ['bash', [path.join(scriptDir, 'build-android-grpc.sh')], 'android-grpc'],
];

for (const [cmd, args, name] of tasks) {
  console.log('[device-stream postinstall] building %s', name);
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env } });
  if (r.status !== 0) {
    console.warn('[device-stream postinstall] %s build failed (status=%d) — install continues; fallback path will be used at runtime',
      name, r.status);
    // Intentionally do NOT exit non-zero — npm install must succeed even
    // when a native build is unavailable (e.g. Xcode not yet installed,
    // xcodegen missing, private-framework symbol-resolution regression on
    // a new Xcode version). The TS adapter handles missing-binary at runtime.
  }
}

// Always exit 0 — non-blocking by contract.
process.exit(0);
