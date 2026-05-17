/**
 * Phase 37 Plan 37-02 Wave 1 — privacy-manifest rule unit specs.
 *
 * 4 cases:
 *   1) missing reason  → blocker fires
 *   2) wrong reason code → blocker fires
 *   3) correct reason  → no blocker
 *   4) SwiftUI internal symbol → blocker filtered out (Pitfall 10)
 */
import { describe, it, expect } from 'vitest';

import { applyPrivacyManifestRules } from '../internal/rules/ios-privacy-manifest.js';
import type { ParsedIpa } from '../internal/parsers/ipa.js';
import type { RulePack } from '../internal/rules/types.js';
import rulePackRaw from '../rules/__data__/forbidden-symbols.json' with { type: 'json' };

const rulePack = rulePackRaw as unknown as RulePack;

const baseBundle: ParsedIpa = {
  infoPlist: {},
  privacyManifest: null,
  executablePath: '',
  binarySymbols: [],
  symbolModules: {},
  bundleId: 'com.example.test',
  bundleName: 'TestApp',
};

describe('privacy-manifest rules', () => {
  it('missing reason → ITMS-91053-USERDEFAULTS blocker', () => {
    const bundle: ParsedIpa = {
      ...baseBundle,
      privacyManifest: null, // entirely missing manifest
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': null },
    };
    const findings = applyPrivacyManifestRules(bundle, rulePack);
    expect(findings.some((f) => f.rule_id === 'ITMS-91053-USERDEFAULTS')).toBe(true);
  });

  it('wrong reason code → blocker fires', () => {
    const bundle: ParsedIpa = {
      ...baseBundle,
      privacyManifest: {
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
            NSPrivacyAccessedAPITypeReasons: ['ZZ99.9'], // none of the valid codes
          },
        ],
      },
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': null },
    };
    const findings = applyPrivacyManifestRules(bundle, rulePack);
    expect(findings.some((f) => f.rule_id === 'ITMS-91053-USERDEFAULTS')).toBe(true);
  });

  it('correct reason → no blocker', () => {
    const bundle: ParsedIpa = {
      ...baseBundle,
      privacyManifest: {
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
            NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
          },
        ],
      },
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': null },
    };
    const findings = applyPrivacyManifestRules(bundle, rulePack);
    expect(findings.some((f) => f.rule_id === 'ITMS-91053-USERDEFAULTS')).toBe(false);
  });

  it('SwiftUI internal symbol → blocker filtered (Pitfall 10)', () => {
    const bundle: ParsedIpa = {
      ...baseBundle,
      privacyManifest: null,
      binarySymbols: ['_OBJC_CLASS_$_NSUserDefaults'],
      symbolModules: { '_OBJC_CLASS_$_NSUserDefaults': 'SwiftUI' },
    };
    const findings = applyPrivacyManifestRules(bundle, rulePack);
    expect(findings.some((f) => f.rule_id === 'ITMS-91053-USERDEFAULTS')).toBe(false);
  });
});
