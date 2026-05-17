/**
 * device_type tool — Phase 34 Plan 34-05.
 *
 * Sends a `type` WS envelope to type a string into the currently-focused
 * input field on the device.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { typeInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface TypeArgs {
  sessionId: string;
  text: string;
}

export function registerDeviceType(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_type',
    {
      title: 'Type text into the device',
      description: "Type text into the device's currently-focused input field. Maximum 4096 characters.",
      inputSchema: typeInputShape,
    },
    async ({ sessionId, text }: TypeArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'type', text, id: randomUUID() });
        return { content: [{ type: 'text', text: `Typed ${text.length} chars` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_type failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
