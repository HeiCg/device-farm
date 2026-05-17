/**
 * device_swipe tool — Phase 34 Plan 34-05.
 *
 * Sends a `swipe` WS envelope with start/end coordinates and optional
 * duration. Defaults to 500ms server-side.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { swipeInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface SwipeArgs {
  sessionId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
}

export function registerDeviceSwipe(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_swipe',
    {
      title: 'Swipe on the device',
      description: 'Swipe on the device from (x1,y1) to (x2,y2) over an optional duration (50–5000ms; default 500).',
      inputSchema: swipeInputShape,
    },
    async ({ sessionId, x1, y1, x2, y2, durationMs }: SwipeArgs) => {
      try {
        const payload: Record<string, unknown> & { type: string } = { type: 'swipe', x1, y1, x2, y2, id: randomUUID() };
        if (durationMs !== undefined) payload.durationMs = durationMs;
        await client.sendAction(sessionId, payload);
        return { content: [{ type: 'text', text: `Swiped (${x1},${y1}) → (${x2},${y2})` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_swipe failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
