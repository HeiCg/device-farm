/**
 * device_key tool — Phase 34 Plan 34-05.
 *
 * Sends a `key` WS envelope to press a physical/system key on the device
 * (home/back/enter/etc.).
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { keyInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface KeyArgs {
  sessionId: string;
  code: 'home' | 'back' | 'enter' | 'volup' | 'voldown' | 'power' | 'menu' | 'recent';
}

export function registerDeviceKey(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_key',
    {
      title: 'Press a physical/system key',
      description: 'Press a physical or system key on the device (home, back, enter, volup, voldown, power, menu, recent).',
      inputSchema: keyInputShape,
    },
    async ({ sessionId, code }: KeyArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'key', code, id: randomUUID() });
        return { content: [{ type: 'text', text: `Pressed ${code}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_key failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
