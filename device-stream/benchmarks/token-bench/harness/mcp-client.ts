/**
 * Thin MCP stdio client wrapper used to drive a target server (argent or
 * device-stream) as a real MCP client: spawn it, initialize, `tools/list`, and
 * `tools/call`. The harness records the raw responses; token counting happens in
 * the capture/metrics layers.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpToolResult } from './capture.js';

export interface SpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: Record<string, unknown>;
}

export class McpTarget {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(spec: SpawnSpec, clientName = 'token-bench') {
    this.transport = new StdioClientTransport({
      command: spec.command,
      args: spec.args,
      env: { ...(process.env as Record<string, string>), ...(spec.env ?? {}) },
      cwd: spec.cwd,
      stderr: 'inherit',
    });
    this.client = new Client({ name: clientName, version: '0.0.0' }, { capabilities: {} });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  /** The server's `instructions` string from the initialize result, if any. */
  instructions(): string | undefined {
    return this.client.getInstructions();
  }

  async listTools(): Promise<ListedTool[]> {
    const res = await this.client.listTools();
    return res.tools as ListedTool[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const res = await this.client.callTool({ name, arguments: args });
    return { content: (res.content ?? []) as McpToolResult['content'], isError: res.isError as boolean | undefined };
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* best-effort */
    }
  }
}

/**
 * The exact MCP wire object a tool contributes to `tools/list` — this is what the
 * model actually pays for as fixed context. Rebuilt from the listed tool so the
 * byte/token measurement matches the serialized protocol payload.
 */
export function toolWireObject(t: ListedTool): Record<string, unknown> {
  return {
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    inputSchema: t.inputSchema ?? { type: 'object' },
    ...(t._meta ? { _meta: t._meta } : {}),
  };
}

/** True when the tool is marked `anthropic/alwaysLoad` (argent's progressive-loading opt-out). */
export function isAlwaysLoad(t: ListedTool): boolean {
  return Boolean(t._meta && (t._meta as Record<string, unknown>)['anthropic/alwaysLoad']);
}
