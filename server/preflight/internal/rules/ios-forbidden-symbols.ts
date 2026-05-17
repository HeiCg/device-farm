/**
 * Phase 37 Plan 37-02 — generic forbidden-symbol rules.
 *
 * Reserved for future rule packs that flag the mere presence of a symbol as a
 * blocker / warning (e.g. private API usage). For now this is a thin pass that
 * processes rules with kind='forbidden_symbol' (none in the bundled pack yet).
 *
 * Pitfall 10 filter applies — framework-internal modules never trigger.
 */

import { FRAMEWORK_INTERNAL_MODULES } from '../parsers/macho-symbols.js';
import type { ParsedIpa } from '../parsers/ipa.js';
import type { RulePack, RuleFinding } from './types.js';

export function applyForbiddenSymbolRules(bundle: ParsedIpa, pack: RulePack): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of pack.rules) {
    if (rule.kind !== 'forbidden_symbol') continue;
    const triggers = new Set(rule.trigger_symbols);
    for (const sym of bundle.binarySymbols) {
      if (!triggers.has(sym)) continue;
      const mod = bundle.symbolModules[sym] ?? null;
      if (mod !== null && FRAMEWORK_INTERNAL_MODULES.has(mod)) continue;
      findings.push({
        rule_id: rule.id,
        severity: rule.severity,
        message: rule.message,
        remediation: rule.remediation,
      });
      break;
    }
  }
  return findings;
}
