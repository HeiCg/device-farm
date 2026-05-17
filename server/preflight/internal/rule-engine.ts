/**
 * Phase 37 Plan 37-02 — preflight rule engine.
 *
 * Runs versioned rule pack against a ParsedIpa, returns a PreflightReport.
 * Status grades:
 *   - 'blocked'             when ≥1 blocker
 *   - 'pass_with_warnings'  when 0 blockers but ≥1 warning
 *   - 'pass'                when 0 of either
 *
 * Android: short-circuit with a single ANDROID-COMING-V31 warning.
 *
 * rules_version is copied from the rule pack `rules_updated` field and
 * surfaced on every report (Pitfall 6 — operators need to see the rule pack
 * date alongside the verdict).
 */

import rulePackRaw from '../rules/__data__/forbidden-symbols.json' with { type: 'json' };
import { applyInfoPlistRules } from './rules/ios-info-plist.js';
import { applyPrivacyManifestRules } from './rules/ios-privacy-manifest.js';
import { applyForbiddenSymbolRules } from './rules/ios-forbidden-symbols.js';
import type { ParsedIpa } from './parsers/ipa.js';
import type { RulePack, RuleFinding } from './rules/types.js';

const rulePack: RulePack = rulePackRaw as unknown as RulePack;

export type Severity = 'blocker' | 'warning';

export interface PreflightReport {
  status: 'pass' | 'pass_with_warnings' | 'blocked';
  rules_version: string;
  platform: 'ios' | 'android';
  blockers: RuleFinding[];
  warnings: RuleFinding[];
}

export function runRules(bundle: ParsedIpa, platform: 'ios' | 'android'): PreflightReport {
  if (platform !== 'ios') {
    return {
      status: 'pass_with_warnings',
      rules_version: rulePack.rules_updated,
      platform,
      blockers: [],
      warnings: [
        {
          rule_id: 'ANDROID-COMING-V31',
          severity: 'warning',
          message: 'Android preflight rules ship in v3.1 — this scan returned no checks.',
        },
      ],
    };
  }

  const findings: RuleFinding[] = [
    ...applyInfoPlistRules(bundle, rulePack),
    ...applyPrivacyManifestRules(bundle, rulePack),
    ...applyForbiddenSymbolRules(bundle, rulePack),
  ];

  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');

  let status: PreflightReport['status'];
  if (blockers.length > 0) status = 'blocked';
  else if (warnings.length > 0) status = 'pass_with_warnings';
  else status = 'pass';

  return {
    status,
    rules_version: rulePack.rules_updated,
    platform,
    blockers,
    warnings,
  };
}

/** Expose the bundled rule pack metadata for routes/reporting. */
export function getRulePackMetadata(): { schema_version: number; rules_updated: string; rules_count: number } {
  return {
    schema_version: rulePack.schema_version,
    rules_updated: rulePack.rules_updated,
    rules_count: rulePack.rules.length,
  };
}
