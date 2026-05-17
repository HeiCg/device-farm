#!/usr/bin/env node
/**
 * @device-stream/mcp — MCP stdio server entrypoint for device-farm.
 *
 * Per RESEARCH §MCP Package lines 549-579. Boots an MCP server over stdio
 * with the 12 device tools and the device-farm://devices resource. Reads:
 *
 *   - DEVICE_FARM_URL   (default http://localhost:3000)
 *   - DEVICE_FARM_TOKEN (REQUIRED; exits 1 with stderr message if unset)
 *
 * Install via `claude mcp add device-stream npx @device-stream/mcp` (see README).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DeviceFarmClient } from './client.js';
import { registerAllTools } from './tools/index.js';
import { registerDevicesResource } from './resources/devices.js';

async function main(): Promise<void> {
  const baseUrl = process.env.DEVICE_FARM_URL ?? 'http://localhost:3000';
  const token = process.env.DEVICE_FARM_TOKEN;
  if (!token) {
    process.stderr.write(
      'device-stream-mcp: DEVICE_FARM_TOKEN env var is required.\n' +
        'Get an API key from your device-farm admin, then export it before launching the MCP server.\n',
    );
    process.exit(1);
  }

  const client = new DeviceFarmClient({ baseUrl, token });

  const server = new McpServer(
    { name: 'device-stream', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } },
  );

  registerAllTools(server, client);
  registerDevicesResource(server, client);

  const transport = new StdioServerTransport();

  // Graceful shutdown — close WS connections + transport on signals.
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`device-stream-mcp: received ${signal}, shutting down.\n`);
    try {
      await client.closeAll();
    } catch {
      /* best-effort */
    }
    try {
      await server.close();
    } catch {
      /* best-effort */
    }
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await server.connect(transport);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`device-stream-mcp: fatal error: ${message}\n`);
  process.exit(1);
});
