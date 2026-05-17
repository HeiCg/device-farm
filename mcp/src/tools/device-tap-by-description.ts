/**
 * device_tap_by_description tool — Phase 34 Plan 34-05.
 *
 * Sends a `tapByDescription` WS envelope; the server-side resolver
 * (MaestroAI or ClaudeVision) maps the natural-language target to (x, y) and
 * dispatches the tap.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { tapByDescriptionInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface TapByDescriptionArgs {
  sessionId: string;
  target: string;
}

export function registerDeviceTapByDescription(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_tap_by_description',
    {
      title: 'Tap device by natural-language description',
      description:
        'Tap a UI element by describing it in natural language (e.g., "Sign In button", "search bar"). The server resolves the description to coordinates using vision/heuristics.',
      inputSchema: tapByDescriptionInputShape,
    },
    async ({ sessionId, target }: TapByDescriptionArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'tapByDescription', target, id: randomUUID() });
        return { content: [{ type: 'text', text: `Tapped "${target}"` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_tap_by_description failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
