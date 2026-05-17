/**
 * DeviceKit chrome loader. Reads Apple's own bezel layout JSON + composite
 * PDF from /Library/Developer/DeviceKit/Chrome/<id>.devicechrome/. Rasterises
 * the PDF to PNG via `sips`. macOS only.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const DEVICE_KIT_ROOT = '/Library/Developer/DeviceKit/Chrome';

export interface ChromeJsonImages {
  sizing: { width: number; height: number };
  devicePadding: { top: number; left: number; bottom: number; right: number };
}

export interface ChromeJson {
  images: ChromeJsonImages;
  screenInsets: { top: number; left: number; bottom: number; right: number };
  outerCornerRadius: number;
  paths?: { simpleOutsideBorder?: string };
  inputs?: Array<{ name: string; offsets?: Record<string, number> }>;
}

export interface ChromeIdLookupDeps {
  readProfilePlist: (deviceTypeName: string) => { chromeIdentifier?: string } | null;
}

/**
 * Validates a chromeId (e.g. "iPhone17,1") to prevent path traversal and
 * returns the sanitized id derived from the regex match — so downstream
 * code only ever uses the match result, not the raw input.
 * Throws if the id contains any character outside [A-Za-z0-9,_-].
 */
function sanitizeChromeId(chromeId: string): string {
  const m = /^([A-Za-z0-9,_-]+)$/.exec(chromeId);
  if (!m) {
    throw new Error(
      `Invalid chromeId "${chromeId}": must match [A-Za-z0-9,_-]+`,
    );
  }
  return m[1];
}

export function chromeIdForDeviceType(
  deviceTypeName: string,
  deps: ChromeIdLookupDeps,
): string | null {
  const plist = deps.readProfilePlist(deviceTypeName);
  return plist?.chromeIdentifier ?? null;
}

export async function loadChromeJson(chromeId: string): Promise<ChromeJson> {
  const safeId = sanitizeChromeId(chromeId);
  const p = path.join(
    DEVICE_KIT_ROOT,
    `${safeId}.devicechrome`,
    'Contents/Resources/chrome.json',
  );
  const raw = await fs.readFile(p, 'utf-8');
  return JSON.parse(raw) as ChromeJson;
}

export async function rasterizeComposite(chromeId: string): Promise<Buffer> {
  if (process.platform !== 'darwin') {
    throw new Error('rasterizeComposite requires macOS (sips)');
  }
  const safeId = sanitizeChromeId(chromeId);
  const pdf = path.join(
    DEVICE_KIT_ROOT,
    `${safeId}.devicechrome`,
    'Contents/Resources/PhoneComposite.pdf',
  );
  const tmp = path.join('/tmp', `chrome-${safeId}-${Date.now()}.png`);
  await execFileAsync('sips', ['-s', 'format', 'png', pdf, '--out', tmp]);
  const png = await fs.readFile(tmp);
  await fs.unlink(tmp).catch(() => {});
  return png;
}
