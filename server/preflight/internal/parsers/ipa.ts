/**
 * Phase 37 Plan 37-02 — IPA parser.
 *
 * Streams an .ipa (zip) via yauzl, extracts:
 *   - Payload/<App>.app/Info.plist
 *   - Payload/<App>.app/PrivacyInfo.xcprivacy (optional)
 *   - Payload/<App>.app/<CFBundleExecutable>  (Mach-O binary)
 *
 * Then runs `nm -gU <binary>` to list defined external symbols.
 *
 * Plist format auto-detected (Pitfall 7): XML, bplist00, or JSON.
 *
 * Temp scratch directory is cleaned up after symbol extraction. The executable
 * path is left on disk and returned in `ParsedIpa.executablePath` so callers
 * (e.g. spec teardown) can rm it.
 */

import { promises as fs, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { open as yauzlOpen, type ZipFile, type Entry } from 'yauzl';
import { parse as parseXmlPlist } from '@plist/parse';
import * as bplist from 'bplist-parser';

import { detectPlistFormat } from './plist-detect.js';
import { extractSymbols, buildSymbolModuleMap } from './macho-symbols.js';

export interface ParsedIpa {
  /** Decoded Info.plist as plain object. */
  infoPlist: Record<string, unknown>;
  /** Decoded PrivacyInfo.xcprivacy, or null if not present. */
  privacyManifest: Record<string, unknown> | null;
  /** Path on disk to extracted executable (caller may rm after use). */
  executablePath: string;
  /** Defined external symbols emitted by `nm -gU`. */
  binarySymbols: string[];
  /** Map symbol→Swift module (or null for non-Swift mangling) — Pitfall 10. */
  symbolModules: Record<string, string | null>;
  /** CFBundleIdentifier from Info.plist. */
  bundleId: string;
  /** CFBundleName (display name fallback to executable). */
  bundleName: string;
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // autoClose: false so the handle stays open while we extract individual
    // entries on demand. We close manually in the parseIPA finally block.
    yauzlOpen(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) return reject(err);
      if (!zip) return reject(new Error('Invalid zip: empty handle'));
      resolve(zip);
    });
  });
}

interface ZipFileMap {
  /** entry path → entry record */
  entries: Map<string, Entry>;
  /** executable app dir (e.g. "Payload/Foo.app"). */
  appDir: string | null;
}

function readAllEntries(zip: ZipFile): Promise<ZipFileMap> {
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Entry>();
    let appDir: string | null = null;
    zip.on('entry', (entry: Entry) => {
      entries.set(entry.fileName, entry);
      // Detect app dir from any path matching Payload/<name>.app/
      if (!appDir) {
        const m = entry.fileName.match(/^(Payload\/[^/]+\.app)\//);
        if (m) appDir = m[1];
      }
      zip.readEntry();
    });
    zip.once('end', () => resolve({ entries, appDir }));
    zip.once('error', reject);
    zip.readEntry();
  });
}

function extractEntryToBuffer(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('readstream null'));
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

async function extractEntryToFile(zip: ZipFile, entry: Entry, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err ?? new Error('readstream null'));
      const out = createWriteStream(destPath);
      pipeline(stream, out).then(resolve).catch(reject);
    });
  });
}

/**
 * Decode a plist buffer using format auto-detection (Pitfall 7).
 * Returns a plain object. Throws on unparseable input.
 */
export function decodePlist(buf: Buffer): Record<string, unknown> {
  const fmt = detectPlistFormat(buf);
  if (fmt === 'binary') {
    // bplist-parser returns an array (one entry per top-level plist).
    const parsed = bplist.parseBuffer(buf);
    if (!Array.isArray(parsed) || (parsed as unknown[]).length === 0) {
      throw new Error('bplist parse returned empty result');
    }
    return parsed[0] as Record<string, unknown>;
  }
  if (fmt === 'json') {
    return JSON.parse(buf.toString('utf8')) as Record<string, unknown>;
  }
  // XML
  return parseXmlPlist(buf.toString('utf8')) as unknown as Record<string, unknown>;
}

export async function parseIPA(ipaPath: string): Promise<ParsedIpa> {
  const scratchDir = join(tmpdir(), `preflight-ipa-${randomUUID()}`);
  await fs.mkdir(scratchDir, { recursive: true });

  let zip: ZipFile | null = null;
  try {
    zip = await openZip(ipaPath);
    const { entries, appDir } = await readAllEntries(zip);
    if (!appDir) {
      throw new Error('Invalid zip: no Payload/<name>.app/ entry found');
    }

    // Find Info.plist
    const infoEntry = entries.get(`${appDir}/Info.plist`);
    if (!infoEntry) {
      throw new Error(`Invalid zip: missing ${appDir}/Info.plist`);
    }
    const infoBuf = await extractEntryToBuffer(zip, infoEntry);
    const infoPlist = decodePlist(infoBuf);

    const bundleId = String(infoPlist.CFBundleIdentifier ?? '');
    const bundleName = String(infoPlist.CFBundleName ?? infoPlist.CFBundleExecutable ?? basename(appDir, '.app'));
    const executableName = String(infoPlist.CFBundleExecutable ?? bundleName);

    // PrivacyInfo (optional)
    let privacyManifest: Record<string, unknown> | null = null;
    const privacyEntry = entries.get(`${appDir}/PrivacyInfo.xcprivacy`);
    if (privacyEntry) {
      const pbuf = await extractEntryToBuffer(zip, privacyEntry);
      try {
        privacyManifest = decodePlist(pbuf);
      } catch {
        privacyManifest = null;
      }
    }

    // Executable
    const exeEntry = entries.get(`${appDir}/${executableName}`);
    let executablePath = '';
    let binarySymbols: string[] = [];
    if (exeEntry) {
      executablePath = join(scratchDir, executableName);
      await extractEntryToFile(zip, exeEntry, executablePath);
      binarySymbols = await extractSymbols(executablePath);
    }

    const symbolModules = buildSymbolModuleMap(binarySymbols);

    return {
      infoPlist,
      privacyManifest,
      executablePath,
      binarySymbols,
      symbolModules,
      bundleId,
      bundleName,
    };
  } catch (err) {
    // On error, clean up scratch dir.
    try { await fs.rm(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
    if (err instanceof Error && /not a valid zip|end of central directory record/i.test(err.message)) {
      throw new Error('Invalid zip: malformed archive');
    }
    throw err;
  } finally {
    if (zip) {
      try { zip.close(); } catch { /* ignore */ }
    }
  }
}
