/**
 * device_launch tool — Phase 34 Plan 34-05.
 *
 * Sends a `launchApp` WS envelope to start an app by bundle / package id.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { launchInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface LaunchArgs {
  sessionId: string;
  bundleId: string;
}

export function registerDeviceLaunch(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_launch',
    {
      title: 'Launch an installed app',
      description: 'Launch an installed app by bundle id (iOS) or package id (Android).',
      inputSchema: launchInputShape,
    },
    async ({ sessionId, bundleId }: LaunchArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'launchApp', bundleId, id: randomUUID() });
        return { content: [{ type: 'text', text: `Launched ${bundleId}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_launch failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
