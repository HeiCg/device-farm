/**
 * device-farm://devices resource — Phase 34 Plan 34-05.
 *
 * Static MCP resource that returns the pool device list as JSON. Useful when
 * an agent wants to enumerate the pool without spending a tool call.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';

export function registerDevicesResource(server: McpServer, client: DeviceFarmClient): void {
  server.registerResource(
    'device-farm-devices',
    'device-farm://devices',
    {
      title: 'Available devices',
      description: 'List of devices currently registered in the device-farm pool',
      mimeType: 'application/json',
    },
    async (uri) => {
      const devices = await client.listDevices();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(devices, null, 2),
          },
        ],
      };
    },
  );
}
