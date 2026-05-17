/**
 * Phase 37 Plan 37-02 — plist format detection (Pitfall 7).
 *
 * Apple Info.plist files are usually XML or binary (bplist00), but some build
 * pipelines emit JSON-shaped plists. We sniff the first non-whitespace byte:
 *   - 0x62 ('b' from "bplist00") → binary
 *   - 0x3C ('<' from "<?xml")    → xml
 *   - 0x7B ('{') or 0x5B ('[')   → json
 *
 * Default: xml (most common in shipped IPAs).
 */

export type PlistFormat = 'binary' | 'xml' | 'json';

export function detectPlistFormat(buf: Buffer): PlistFormat {
  // Skip BOM and whitespace.
  let i = 0;
  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    i = 3;
  }
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) {
      i++;
      continue;
    }
    break;
  }
  const first = buf[i];
  if (first === 0x62) return 'binary'; // 'b' in 'bplist00'
  if (first === 0x3c) return 'xml';    // '<'
  if (first === 0x7b || first === 0x5b) return 'json'; // '{' or '['
  // Fallback: probe for "bplist" anywhere in first 16 bytes (some bplists pad).
  const head = buf.slice(0, Math.min(16, buf.length)).toString('latin1');
  if (head.includes('bplist')) return 'binary';
  return 'xml';
}
