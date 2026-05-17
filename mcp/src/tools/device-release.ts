/**
 * device_release tool — Phase 34 Plan 34-05.
 *
 * Forwards to DeviceFarmClient.release(). Idempotent from the MCP caller's
 * perspective — if the session is already released, the server returns 404
 * which we surface as isError.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { releaseInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface ReleaseArgs {
  sessionId: string;
}

export function registerDeviceRelease(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_release',
    {
      title: 'Release a device session',
      description: 'Release a previously-leased device session. The device returns to the pool.',
      inputSchema: releaseInputShape,
    },
    async ({ sessionId }: ReleaseArgs) => {
      try {
        const result = await client.release(sessionId);
        return {
          content: [{ type: 'text', text: `Released session ${sessionId}` }],
          structuredContent: { sessionId, released: true, server: result } as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_release failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
