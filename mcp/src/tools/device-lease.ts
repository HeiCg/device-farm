/**
 * device_lease tool — Phase 34 Plan 34-05.
 *
 * Forwards to DeviceFarmClient.lease(). The returned sessionRef shape includes
 * the wsUrl that the client caches internally for subsequent action calls; we
 * surface the same shape to the MCP caller via `structuredContent`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient, LeaseRequestBody } from '../client.js';
import { leaseInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface LeaseArgs {
  platform: 'android' | 'ios';
  ttlSeconds?: number;
  deviceQuery?: { deviceId?: string; name?: string };
  metadata?: Record<string, unknown>;
}

export function registerDeviceLease(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_lease',
    {
      title: 'Lease a device',
      description:
        'Lease an Android emulator or iOS simulator for an interactive session. Returns sessionId, deviceId, deviceName, wsUrl, and leaseUntil. Use device_release when finished.',
      inputSchema: leaseInputShape,
    },
    async (args: LeaseArgs) => {
      try {
        const body: LeaseRequestBody = {
          platform: args.platform,
          ttlSeconds: args.ttlSeconds,
          deviceQuery: args.deviceQuery,
          metadata: args.metadata,
        };
        const ref = await client.lease(body);
        return {
          content: [
            {
              type: 'text',
              text: `Leased ${ref.deviceName} (${ref.platform}). sessionId=${ref.sessionId}, leaseUntil=${ref.leaseUntil}`,
            },
          ],
          structuredContent: ref as unknown as Record<string, unknown>,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_lease failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
