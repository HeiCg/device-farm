/**
 * Phase 37 Plan 37-02 — Mach-O symbol extraction via `nm` shell-out.
 *
 * `nm -gU` lists DEFINED EXTERNAL symbols only (filters undefined imports and
 * local statics). This narrows the surface to symbols the binary actually
 * ships — reducing false positives from forbidden-symbol scans.
 *
 * Pitfall 10 (SwiftUI framework internals): symbols may be defined by linked
 * SwiftUI/UIKit framework code rather than the app itself. The
 * `moduleNameFromSymbol` heuristic extracts the Swift mangled module prefix
 * so the rule engine can filter framework-internal symbols out of matches.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Set of framework modules whose internals should NEVER trigger app-level
 * preflight blockers (Pitfall 10). When a symbol's mangled module belongs
 * to one of these, treat the symbol as a framework internal — even if it
 * lexically matches a forbidden-symbol rule.
 */
export const FRAMEWORK_INTERNAL_MODULES = new Set<string>([
  'SwiftUI',
  'UIKit',
  'UIKitCore',
  'Foundation',
  'CoreFoundation',
  '_FoundationCollections',
  'CoreGraphics',
  'CoreServices',
  'Combine',
]);

export async function extractSymbols(executablePath: string): Promise<string[]> {
  // `-g`: only globally-visible symbols. `-U`: defined symbols only.
  // 64MB buffer accommodates large apps.
  try {
    const { stdout } = await execAsync(`nm -gU "${executablePath}"`, {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout
      .split('\n')
      .map((l) => {
        const trimmed = l.trim();
        if (!trimmed) return '';
        // `nm` output format: "0000000100008000 T _main" — the symbol is the last token.
        const parts = trimmed.split(/\s+/);
        return parts[parts.length - 1] ?? '';
      })
      .filter(Boolean);
  } catch (err) {
    // `nm` not available (non-macOS dev box) or binary unreadable: return empty
    // list. The rule engine treats absent symbols as "no match" rather than
    // failing the scan outright.
    return [];
  }
}

/**
 * Extract the Swift mangled module name from a symbol.
 *
 * Swift symbols are mangled as `$sNN<module><rest>` where NN is the length
 * of `<module>`. Common prefixes:
 *   `$s7SwiftUI...`  →  'SwiftUI'   (NN=7)
 *   `$s9UIKitCore...` → 'UIKitCore' (NN=9)
 *
 * Returns null when the symbol is not a Swift mangled name (e.g. ObjC class
 * symbols start with `_OBJC_CLASS_$_`). In that case the rule engine treats
 * the symbol as belonging to the app itself (no framework filter).
 */
export function moduleNameFromSymbol(symbol: string): string | null {
  // Strip leading underscore so both `$s7SwiftUI...` and `_$s7SwiftUI...` work.
  const sym = symbol.startsWith('_$s') ? symbol.slice(1) : symbol;
  const m = sym.match(/^\$s(\d+)([A-Za-z_][A-Za-z0-9_]*)/);
  if (!m) return null;
  const len = parseInt(m[1], 10);
  const rest = m[2];
  if (rest.length < len) return null;
  return rest.slice(0, len);
}

/**
 * Build a symbol→module map for an array of symbols. Symbols not matching
 * the Swift mangling regex map to `null` (app-owned by default).
 */
export function buildSymbolModuleMap(symbols: string[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const s of symbols) {
    out[s] = moduleNameFromSymbol(s);
  }
  return out;
}
