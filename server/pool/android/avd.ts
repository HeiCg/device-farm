/**
 * AVD creation and management utilities.
 * Uses execFile (NOT exec) for safe binary execution.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AndroidDeviceConfig } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * List existing AVD names.
 */
export async function listAvds(): Promise<string[]> {
  const { stdout } = await execFileAsync('emulator', ['-list-avds']);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Delete an AVD by name.
 */
export async function deleteAvd(name: string): Promise<void> {
  await execFileAsync('avdmanager', ['delete', 'avd', '-n', name]);
}

/**
 * Ensure an AVD with the given name exists. Creates it if not found.
 * Uses ARM64 system image for Apple Silicon compatibility.
 */
export async function ensureAvdExists(
  name: string,
  config: AndroidDeviceConfig,
): Promise<void> {
  const existing = await listAvds();
  if (existing.includes(name)) {
    return;
  }

  const systemImage = `system-images;android-${config.api_level};${config.system_image_variant};arm64-v8a`;

  await execFileAsync('avdmanager', [
    'create',
    'avd',
    '-n',
    name,
    '-k',
    systemImage,
    '-d',
    config.device_profile,
    '--force',
  ]);
}
