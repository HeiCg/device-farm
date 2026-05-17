/**
 * Phase 37 Plan 37-02 — PrivacyInfo.xcprivacy manifest rules.
 *
 * For each rule with kind='privacy_manifest_missing_reason':
 *   - Skip unless ≥1 trigger_symbol is present in bundle.binarySymbols AND
 *     that symbol is NOT a framework internal (Pitfall 10).
 *   - Inspect bundle.privacyManifest.NSPrivacyAccessedAPITypes (array). For
 *     the rule.required_api_type, the manifest entry must declare at least
 *     one of rule.required_reason_options in NSPrivacyAccessedAPITypeReasons.
 *   - Missing manifest → blocker. Wrong reason code → blocker. Correct → OK.
 */

import { FRAMEWORK_INTERNAL_MODULES } from '../parsers/macho-symbols.js';
import type { ParsedIpa } from '../parsers/ipa.js';
import type { RulePack, RuleFinding } from './types.js';

interface PrivacyApiEntry {
  NSPrivacyAccessedAPIType?: string;
  NSPrivacyAccessedAPITypeReasons?: string[];
  [k: string]: unknown;
}

function appOwnedSymbolMatches(bundle: ParsedIpa, triggers: string[]): boolean {
  if (triggers.length === 0) return false;
  const triggerSet = new Set(triggers);
  for (const sym of bundle.binarySymbols) {
    if (!triggerSet.has(sym)) continue;
    const mod = bundle.symbolModules[sym] ?? null;
    if (mod !== null && FRAMEWORK_INTERNAL_MODULES.has(mod)) continue;
    return true;
  }
  return false;
}

export function applyPrivacyManifestRules(bundle: ParsedIpa, pack: RulePack): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const rule of pack.rules) {
    if (rule.kind !== 'privacy_manifest_missing_reason') continue;
    const apiType = rule.required_api_type;
    const reasonOptions = rule.required_reason_options ?? [];
    if (!apiType) continue;

    if (!appOwnedSymbolMatches(bundle, rule.trigger_symbols)) continue;

    // Symbol fires → check manifest for matching reason.
    const manifest = bundle.privacyManifest;
    let satisfied = false;

    if (manifest) {
      const apis = (manifest.NSPrivacyAccessedAPITypes as PrivacyApiEntry[] | undefined) ?? [];
      for (const entry of apis) {
        if (entry.NSPrivacyAccessedAPIType !== apiType) continue;
        const reasons = entry.NSPrivacyAccessedAPITypeReasons ?? [];
        if (reasons.some((r) => reasonOptions.includes(r))) {
          satisfied = true;
          break;
        }
      }
    }

    if (!satisfied) {
      findings.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: rule.message,
        remediation: rule.remediation,
      });
    }
  }

  return findings;
}
