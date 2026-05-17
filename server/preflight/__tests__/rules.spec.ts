/**
 * Phase 37 Plan 37-02 Wave 1 — preflight rule engine specs.
 *
 * Feeds hand-crafted ParsedIpa objects into runRules() to verify:
 *  - known-bad → status='blocked' with rule_id ITMS-91053-USERDEFAULTS in blockers
 *  - known-good → status='pass' with empty blockers
 *  - rule pack version surfaced via PreflightReport.rules_version
 *  - SwiftUI internal symbols (Pitfall 10) do NOT trigger blockers
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runRules } from '../internal/rule-engine.js';
import type { ParsedIpa } from '../internal/parsers/ipa.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulePackPath = join(__dirname, '../rules/__data__/forbidden-symbols.json');

describe('preflight rules', () => {
  it('rule pack is well-formed JSON with required fields', () => {
    const pack = JSON.parse(readFileSync(rulePackPath, 'utf8'));
    expect(pack.schema_version).toBe(1);
    expect(typeof pack.rules_updated).toBe('string');
    expect(Array.isArray(pack.rules)).toBe(true);
    expect(pack.rules.length).toBeGreaterThanOrEqual(5);
  });

  it('every rule has id, kind, severity, message', () => {
    const pack = JSON.parse(readFileSync(rulePackPath, 'utf8'));
    for (const rule of pack.rules) {
      expect(typeof rule.id).toBe('string');
      expect(typeof rule.kind).toBe('string');
      expect(['blocker', 'warning']).toContain(rule.severity);
      expect(typeof rule.message).toBe('string');
    }
  });

  it('known-bad bundle (uses NSUserDefaults, missing privacy manifest) → blocked + ITMS-91053-USERDEFAULTS', () => {
    const bundle: ParsedIpa = {
      infoPlist: {
        CFBundleIdentifier: 'com.example.bad',
        CFBundleName: 'BadApp',
        CFBundleExecutable: 'BadApp',
      },
      privacyManifest: null,
      executablePath: '/tmp/BadApp',
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults', '_main'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': null, '_main': null },
      bundleId: 'com.example.bad',
      bundleName: 'BadApp',
    };

    const report = runRules(bundle, 'ios');
    expect(report.status).toBe('blocked');
    expect(report.blockers.some((b) => b.rule_id === 'ITMS-91053-USERDEFAULTS')).toBe(true);
    expect(typeof report.rules_version).toBe('string');
    expect(report.rules_version.length).toBeGreaterThan(0);
  });

  it('known-good bundle (privacy manifest declares NSUserDefaults reason) → pass with 0 blockers', () => {
    const bundle: ParsedIpa = {
      infoPlist: {
        CFBundleIdentifier: 'com.example.good',
        CFBundleName: 'GoodApp',
        CFBundleExecutable: 'GoodApp',
        NSUserTrackingUsageDescription: 'Used for personalised ads',
        ITSAppUsesNonExemptEncryption: false,
      },
      privacyManifest: {
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
            NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
          },
        ],
      },
      executablePath: '/tmp/GoodApp',
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults', '_main'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': null, '_main': null },
      bundleId: 'com.example.good',
      bundleName: 'GoodApp',
    };

    const report = runRules(bundle, 'ios');
    expect(report.blockers).toHaveLength(0);
    // status is either 'pass' or 'pass_with_warnings' depending on warning rules
    expect(['pass', 'pass_with_warnings']).toContain(report.status);
  });

  it('SwiftUI internal symbol does NOT trigger blocker (Pitfall 10 — module filter)', () => {
    // Symbol that LOOKS like NSUserDefaults usage but its module is SwiftUI (internal).
    // ModuleNameFromSymbol returns 'SwiftUI' which is in the framework-internal set.
    const bundle: ParsedIpa = {
      infoPlist: {
        CFBundleIdentifier: 'com.example.swiftui',
        CFBundleExecutable: 'SwiftUIApp',
        CFBundleName: 'SwiftUIApp',
      },
      privacyManifest: null,
      executablePath: '/tmp/SwiftUIApp',
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': 'SwiftUI' },
      bundleId: 'com.example.swiftui',
      bundleName: 'SwiftUIApp',
    };

    const report = runRules(bundle, 'ios');
    // The privacy-manifest rule should be filtered out because the symbol belongs to SwiftUI.
    expect(report.blockers.some((b) => b.rule_id === 'ITMS-91053-USERDEFAULTS')).toBe(false);
  });

  it('android bundle returns pass_with_warnings with ANDROID-COMING-V31 warning', () => {
    const bundle: ParsedIpa = {
      infoPlist: {},
      privacyManifest: null,
      executablePath: '',
      binarySymbols: [],
      symbolModules: {},
      bundleId: 'com.example.android',
      bundleName: 'AndroidApp',
    };
    const report = runRules(bundle, 'android');
    expect(report.platform).toBe('android');
    expect(report.status).toBe('pass_with_warnings');
    expect(report.warnings.some((w) => w.rule_id === 'ANDROID-COMING-V31')).toBe(true);
  });

  it('ENCRYPTION-EXPORT-MISSING warning fires when ITSAppUsesNonExemptEncryption is absent', () => {
    const bundle: ParsedIpa = {
      infoPlist: {
        CFBundleIdentifier: 'com.example.crypto',
        CFBundleExecutable: 'CryptoApp',
        CFBundleName: 'CryptoApp',
      },
      privacyManifest: {
        NSPrivacyAccessedAPITypes: [],
      },
      executablePath: '/tmp/CryptoApp',
      binarySymbols: [],
      symbolModules: {},
      bundleId: 'com.example.crypto',
      bundleName: 'CryptoApp',
    };
    const report = runRules(bundle, 'ios');
    expect(report.warnings.some((w) => w.rule_id === 'ENCRYPTION-EXPORT-MISSING')).toBe(true);
  });
});
