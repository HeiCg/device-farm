/**
 * Phase 37 Plan 37-02 — APK parser (minimal stub for Wave 1).
 *
 * Wave 1 ships Android rules in v3.1 — for now we return a placeholder
 * ParsedIpa-shaped object so the rule engine can short-circuit on platform.
 *
 * The rule engine treats Android platform separately — emits a single
 * ANDROID-COMING-V31 warning and skips iOS rules entirely.
 *
 * We avoid pulling in an extra zip dep (adm-zip) here; the rule engine never
 * reads AndroidManifest in Wave 1. When Wave 1.5+ Android rules land, swap
 * this body for a yauzl-streamed AndroidManifest.xml extraction + AXML decode.
 */

import { stat } from 'node:fs/promises';
import type { ParsedIpa } from './ipa.js';

export async function parseAPK(apkPath: string): Promise<ParsedIpa> {
  const s = await stat(apkPath).catch(() => null);
  return {
    infoPlist: {
      _androidApkSize: s?.size ?? 0,
    },
    privacyManifest: null,
    executablePath: '',
    binarySymbols: [],
    symbolModules: {},
    bundleId: '',
    bundleName: '',
  };
}
