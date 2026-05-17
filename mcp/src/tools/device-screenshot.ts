/**
 * device_screenshot tool — Phase 34 Plan 34-05.
 *
 * Special tool: returns MCP `content` with BOTH an inline base64 PNG (so the
 * Claude agent can see the screen) AND a text description (artifact id + url
 * + dimensions). This matches the kittyfarm pattern from
 * LocalControlMCPHandler.swift lines 185-207.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceFarmClient } from '../client.js';
import { screenshotInputShape } from '../schemas.js';
import { registerTool } from './_helpers.js';

interface ScreenshotArgs {
  sessionId: string;
}

interface ScreenshotResult {
  artifactId: string;
  url: string;
  width: number;
  height: number;
}

export function registerDeviceScreenshot(server: McpServer, client: DeviceFarmClient): void {
  registerTool(
    server,
    'device_screenshot',
    {
      title: 'Capture device screenshot',
      description:
        'Capture a PNG screenshot of the device. Returns the image inline (base64) for visual reasoning plus the artifact id and download URL.',
      inputSchema: screenshotInputShape,
    },
    async ({ sessionId }: ScreenshotArgs) => {
      try {
        const result = (await client.sendAction(sessionId, { type: 'screenshot', id: randomUUID() })) as ScreenshotResult;
        if (!result || typeof result !== 'object' || !result.url) {
          throw new Error(`screenshot ack missing url field: ${JSON.stringify(result)}`);
        }

        const isHttp = /^https?:\/\//i.test(result.url);
        const headers: Record<string, string> = {};
        if (isHttp) headers.Authorization = `Bearer ${client.opts.token}`;

        const res = await fetch(result.url, { headers });
        if (!res.ok) {
          throw new Error(`failed to fetch screenshot bytes: ${res.status} ${res.statusText}`);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        const base64 = bytes.toString('base64');

        return {
          content: [
            { type: 'image', data: base64, mimeType: 'image/png' },
            {
              type: 'text',
              text: `Screenshot ${result.width}x${result.height}, artifactId=${result.artifactId}, url=${result.url}`,
            },
          ],
          structuredContent: {
            artifactId: result.artifactId,
            url: result.url,
            width: result.width,
            height: result.height,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text', text: `device_screenshot failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
