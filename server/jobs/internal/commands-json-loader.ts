import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Schema we tolerate from Maestro's commands-*.json.
 *
 * Maestro does not document the file format publicly. We treat unknown fields
 * as no-ops and only act when both startedAtMs and endedAtMs are present and
 * numeric. If the format changes in a future Maestro release, the worst case
 * is we silently fall back to the parser wallclock map.
 */
interface CommandEntry {
  command?: string;
  startedAtMs?: number;
  endedAtMs?: number;
}

export async function loadCommandTimestamps(
  outputDir: string,
): Promise<Map<string, { startedAt: Date; endedAt: Date }>> {
  const out = new Map<string, { startedAt: Date; endedAt: Date }>();

  let files: string[];
  try {
    files = await readdir(outputDir);
  } catch {
    return out;
  }

  const commandFiles = files.filter(
    (f) => f.startsWith('commands-') && f.endsWith('.json'),
  );

  for (const file of commandFiles) {
    try {
      const raw = await readFile(join(outputDir, file), 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed as CommandEntry[]) {
        if (
          typeof entry?.command === 'string' &&
          typeof entry?.startedAtMs === 'number' &&
          typeof entry?.endedAtMs === 'number'
        ) {
          out.set(entry.command, {
            startedAt: new Date(entry.startedAtMs),
            endedAt:   new Date(entry.endedAtMs),
          });
        }
      }
    } catch {
      // malformed file — skip silently
    }
  }

  return out;
}
