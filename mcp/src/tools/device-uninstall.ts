/**
 * device_uninstall tool — Phase 34 Plan 34-05.
 *
 * Sends an `uninstallApp` WS envelope to remove an app by bundle / package id.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { uninstallInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface UninstallArgs {
  sessionId: string;
  bundleId: string;
}

export function registerDeviceUninstall(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_uninstall',
    {
      title: 'Uninstall an app',
      description: 'Uninstall an app by bundle id (iOS) or package id (Android).',
      inputSchema: uninstallInputShape,
    },
    async ({ sessionId, bundleId }: UninstallArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'uninstallApp', bundleId, id: randomUUID() });
        return { content: [{ type: 'text', text: `Uninstalled ${bundleId}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_uninstall failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
