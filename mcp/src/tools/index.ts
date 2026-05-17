/**
 * Tool barrel — Phase 34 Plan 34-05.
 *
 * `registerAllTools(server, client)` registers all 12 device-farm tools in a
 * stable order matching the RESEARCH §Tool catalog (lines 619-633). Call this
 * exactly once during server bootstrap.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';

import { registerDeviceLease } from './device-lease.js';
import { registerDeviceRelease } from './device-release.js';
import { registerDeviceList } from './device-list.js';
import { registerDeviceTap } from './device-tap.js';
import { registerDeviceTapByDescription } from './device-tap-by-description.js';
import { registerDeviceType } from './device-type.js';
import { registerDeviceSwipe } from './device-swipe.js';
import { registerDeviceKey } from './device-key.js';
import { registerDeviceScreenshot } from './device-screenshot.js';
import { registerDeviceInstall } from './device-install.js';
import { registerDeviceLaunch } from './device-launch.js';
import { registerDeviceUninstall } from './device-uninstall.js';

export const TOOL_NAMES = [
  'device_lease',
  'device_release',
  'device_list',
  'device_tap',
  'device_tap_by_description',
  'device_type',
  'device_swipe',
  'device_key',
  'device_screenshot',
  'device_install',
  'device_launch',
  'device_uninstall',
] as const;

export function registerAllTools(server: McpServer, client: DeviceFarmClient): void {
  registerDeviceLease(server, client);
  registerDeviceRelease(server, client);
  registerDeviceList(server, client);
  registerDeviceTap(server, client);
  registerDeviceTapByDescription(server, client);
  registerDeviceType(server, client);
  registerDeviceSwipe(server, client);
  registerDeviceKey(server, client);
  registerDeviceScreenshot(server, client);
  registerDeviceInstall(server, client);
  registerDeviceLaunch(server, client);
  registerDeviceUninstall(server, client);
}

export {
  registerDeviceLease,
  registerDeviceRelease,
  registerDeviceList,
  registerDeviceTap,
  registerDeviceTapByDescription,
  registerDeviceType,
  registerDeviceSwipe,
  registerDeviceKey,
  registerDeviceScreenshot,
  registerDeviceInstall,
  registerDeviceLaunch,
  registerDeviceUninstall,
};
