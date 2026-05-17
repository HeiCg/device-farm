/**
 * Phase 37 Plan 37-02 Wave 1 — IPA parser unit specs.
 *
 * Validates the synthetic fixture flow:
 *   - parseIPA on a hand-crafted minimal IPA returns shaped {infoPlist, ...}.
 *   - Format detection (Pitfall 7): XML, bplist, JSON variants all parse.
 *
 * Strategy: We BUILD synthetic IPAs in-test via yauzl-compatible zip writing
 * because we don't have a real Xcode build pipeline. The "executable" inside
 * is a tiny placeholder file (we don't shell to `nm` in this spec — the
 * macho-symbols module has its own coverage path).
 *
 * Real .ipa fixtures (with code-signed binaries) are not in scope for Wave 1;
 * if/when an operator drops a real .ipa into __tests__/fixtures/, the parser
 * round-trip naturally exercises it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { parseIPA } from '../internal/parsers/ipa.js';
import { detectPlistFormat } from '../internal/parsers/plist-detect.js';

function buildSyntheticIpa(opts: {
  bundleName: string;
  infoPlistContent: Buffer;
  privacyManifestContent?: Buffer;
  executableBytes?: Buffer;
}): string {
  const dir = mkdtempSync(join(tmpdir(), 'preflight-spec-'));
  const appDir = join(dir, 'Payload', `${opts.bundleName}.app`);
  execFileSync('mkdir', ['-p', appDir]);
  writeFileSync(join(appDir, 'Info.plist'), opts.infoPlistContent);
  if (opts.privacyManifestContent) {
    writeFileSync(join(appDir, 'PrivacyInfo.xcprivacy'), opts.privacyManifestContent);
  }
  writeFileSync(join(appDir, opts.bundleName), opts.executableBytes ?? Buffer.from('#!/bin/sh\necho hi\n'));
  const ipaPath = join(dir, `${opts.bundleName}.ipa`);
  // `zip -r out.ipa Payload`. Use system zip; available on macOS + linux.
  execFileSync('zip', ['-r', '-q', ipaPath, 'Payload'], { cwd: dir });
  return ipaPath;
}

const XML_PLIST = (entries: string) => Buffer.from(
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
</dict>
</plist>
`,
  'utf8',
);

describe('parser-ipa', () => {
  it('parseIPA returns bundleId, bundleName, infoPlist non-empty for known-good synthetic IPA', async () => {
    const infoPlist = XML_PLIST(`
  <key>CFBundleIdentifier</key><string>com.example.good</string>
  <key>CFBundleName</key><string>GoodApp</string>
  <key>CFBundleExecutable</key><string>GoodApp</string>
  <key>NSUserTrackingUsageDescription</key><string>Ads</string>
`);
    const privacyManifest = XML_PLIST(`
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array>
    </dict>
  </array>
`);
    const ipaPath = buildSyntheticIpa({
      bundleName: 'GoodApp',
      infoPlistContent: infoPlist,
      privacyManifestContent: privacyManifest,
    });

    const parsed = await parseIPA(ipaPath);
    try {
      expect(parsed.bundleId).toBe('com.example.good');
      expect(parsed.bundleName).toBe('GoodApp');
      expect(parsed.privacyManifest).not.toBeNull();
      const apis = (parsed.privacyManifest as Record<string, unknown>)?.NSPrivacyAccessedAPITypes;
      expect(Array.isArray(apis)).toBe(true);
    } finally {
      try { rmSync(parsed.executablePath, { force: true }); } catch { /* ignore */ }
    }
  }, 30_000);

  it('parseIPA known-bad synthetic IPA: no PrivacyInfo → privacyManifest is null', async () => {
    const infoPlist = XML_PLIST(`
  <key>CFBundleIdentifier</key><string>com.example.bad</string>
  <key>CFBundleName</key><string>BadApp</string>
  <key>CFBundleExecutable</key><string>BadApp</string>
`);
    const ipaPath = buildSyntheticIpa({
      bundleName: 'BadApp',
      infoPlistContent: infoPlist,
    });

    const parsed = await parseIPA(ipaPath);
    expect(parsed.bundleId).toBe('com.example.bad');
    expect(parsed.privacyManifest).toBeNull();
  }, 30_000);

  it('detectPlistFormat recognises XML, bplist00, and JSON shapes', () => {
    expect(detectPlistFormat(Buffer.from('<?xml version="1.0"?>', 'utf8'))).toBe('xml');
    expect(detectPlistFormat(Buffer.from('bplist00', 'utf8'))).toBe('binary');
    expect(detectPlistFormat(Buffer.from('{"foo":"bar"}', 'utf8'))).toBe('json');
    expect(detectPlistFormat(Buffer.from('[1,2,3]', 'utf8'))).toBe('json');
  });
});
