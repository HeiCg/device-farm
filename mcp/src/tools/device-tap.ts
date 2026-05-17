/**
 * device_tap tool — Phase 34 Plan 34-05.
 *
 * Sends a `tap` WS envelope with pixel coordinates. The WS handler dispatches
 * to the platform-specific tap primitive (AndroidDeviceService.tap / simctl).
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { tapInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface TapArgs {
  sessionId: string;
  x: number;
  y: number;
}

export function registerDeviceTap(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_tap',
    {
      title: 'Tap device at coordinates',
      description:
        'Tap a device by absolute pixel coordinates. For NL targeting (e.g., "Sign In button"), use device_tap_by_description.',
      inputSchema: tapInputShape,
    },
    async ({ sessionId, x, y }: TapArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'tap', x, y, id: randomUUID() });
        return { content: [{ type: 'text', text: `Tapped (${x}, ${y})` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_tap failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
