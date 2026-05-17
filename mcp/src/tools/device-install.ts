/**
 * device_install tool — Phase 34 Plan 34-05.
 *
 * Sends an `installApp` WS envelope referencing a pre-uploaded artifact id.
 * The server fetches the APK/IPA from artifact storage and runs the
 * platform-specific install (adb install / simctl install).
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { installInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface InstallArgs {
  sessionId: string;
  artifactId: string;
}

export function registerDeviceInstall(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_install',
    {
      title: 'Install an APK or IPA',
      description:
        'Install a pre-uploaded APK (Android) or IPA (iOS) onto the leased device. Use the artifacts upload API to obtain the artifactId first.',
      inputSchema: installInputShape,
    },
    async ({ sessionId, artifactId }: InstallArgs) => {
      try {
        await client.sendAction(sessionId, { type: 'installApp', artifactId, id: randomUUID() });
        return { content: [{ type: 'text', text: `Installed artifact ${artifactId}` }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_install failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
