/**
 * Phase 37 Plan 37-02 — internal rule + rule-pack types.
 */

export interface RulePackRule {
  id: string;
  kind: string;
  severity: 'blocker' | 'warning';
  trigger_symbols: string[];
  required_api_type?: string;
  required_reason_options?: string[];
  required_info_plist_key?: string;
  always_applies?: boolean;
  message: string;
  remediation?: string;
}

export interface RulePack {
  schema_version: number;
  rules_updated: string;
  platform: string;
  rules: RulePackRule[];
}

export interface RuleFinding {
  rule_id: string;
  severity: 'blocker' | 'warning';
  message: string;
  remediation?: string;
}
