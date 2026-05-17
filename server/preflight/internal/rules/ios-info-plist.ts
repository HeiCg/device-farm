/**
 * Phase 37 Plan 37-02 — Info.plist key-presence rules.
 *
 * For each rule with kind='info_plist_missing_key':
 *   - If `always_applies: true`: emit finding when key absent from Info.plist.
 *   - Otherwise: emit finding when any trigger_symbol matches AND the
 *     required_info_plist_key is absent.
 *
 * SwiftUI / framework-internal symbol filter (Pitfall 10) applies: trigger
 * symbol must NOT belong to a framework-internal module.
 */

import { FRAMEWORK_INTERNAL_MODULES } from '../parsers/macho-symbols.js';
import type { ParsedIpa } from '../parsers/ipa.js';
import type { RulePack, RuleFinding } from './types.js';

function appOwnedSymbolMatches(
  bundle: ParsedIpa,
  triggers: string[],
): boolean {
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

export function applyInfoPlistRules(bundle: ParsedIpa, pack: RulePack): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of pack.rules) {
    if (rule.kind !== 'info_plist_missing_key') continue;
    const key = rule.required_info_plist_key;
    if (!key) continue;

    const hasKey = Object.prototype.hasOwnProperty.call(bundle.infoPlist, key);

    if (rule.always_applies) {
      if (!hasKey) {
        findings.push({
          rule_id: rule.id,
          severity: rule.severity,
          message: rule.message,
          remediation: rule.remediation,
        });
      }
      continue;
    }

    // Symbol-triggered rule: only fire when an app-owned trigger symbol is present.
    if (!appOwnedSymbolMatches(bundle, rule.trigger_symbols)) continue;
    if (hasKey) continue;

    findings.push({
      rule_id: rule.id,
      severity: rule.severity,
      message: rule.message,
      remediation: rule.remediation,
    });
  }
  return findings;
}
