/**
 * Phase 31 Plan 31-01 — Android logcat threadtime parser + crash detection.
 *
 * Pure transformation module. No Fastify deps, no DB writes, no bus emits.
 * The streaming subscriber (server/streaming/internal/module.ts) calls
 * `parseLogcatLine` inline per log event and decides what to do with the
 * `isCrash` flag (first-detection gate, DB update, WS event).
 *
 * 3-of-3 crash defense (per CONTEXT.md locked decision):
 *   1. Threadtime regex matches (implicit — null returned otherwise)
 *   2. Level is exactly 'E' (NOT 'F', NOT other priorities — CONTEXT mandate)
 *   3. At least one crash marker (FATAL EXCEPTION / Fatal signal N /
 *      beginning of crash / AndroidRuntime: FATAL) matches the RAW input line
 *
 * Markers are tested against the FULL line (not just `msg`) because some
 * crash signatures appear inside the tag-or-msg boundary (e.g. the
 * "AndroidRuntime: FATAL" subclass case where the literal "AndroidRuntime"
 * appears in the message body, not the tag column).
 */

const THREADTIME_RE = /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):\s?(.*)$/;

const CRASH_MARKERS: readonly RegExp[] = [
  /FATAL EXCEPTION/i,
  /Fatal signal \d+/i,
  /beginning of crash/i,
  /AndroidRuntime: FATAL/i,
];

export interface ParsedLogcat {
  level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
  tag: string;
  msg: string;
  isCrash: boolean;
}

/**
 * Parse a single Android threadtime-formatted logcat line.
 *
 * Returns null for non-matching lines (no false-positive crash detection on
 * non-logcat lines like user-app stdout, scrcpy output, or brief-format
 * logcat output).
 */
export function parseLogcatLine(line: string): ParsedLogcat | null {
  const m = THREADTIME_RE.exec(line);
  if (!m) return null;
  const level = m[4] as ParsedLogcat['level'];
  const tag = m[5].trim();
  const msg = m[6];
  const isCrash = level === 'E' && CRASH_MARKERS.some((re) => re.test(line));
  return { level, tag, msg, isCrash };
}
