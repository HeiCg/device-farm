/**
 * device_list tool — Phase 34 Plan 34-05.
 *
 * Lists pool devices via GET /api/devices. Read-only; does NOT touch the
 * wsUrl cache.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { listInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

export function registerDeviceList(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_list',
    {
      title: 'List pool devices',
      description: 'List all devices currently registered in the device-farm pool, including their state and platform.',
      inputSchema: listInputShape,
    },
    async () => {
      try {
        const devices = await client.listDevices();
        return {
          content: [{ type: 'text', text: JSON.stringify(devices, null, 2) }],
          structuredContent: devices as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_list failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
