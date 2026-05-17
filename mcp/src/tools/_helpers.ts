/**
 * Tool registration helper — Phase 34 Plan 34-05.
 *
 * Wraps `McpServer.registerTool` with explicit `any`-typed input shape to
 * sidestep TS2589 ("type instantiation is excessively deep") errors caused
 * by the SDK's dual-zod (v3 + v4) generic inference exploding on certain
 * raw-shape compositions (nested objects, enums, optionals).
 *
 * Runtime semantics are unchanged — the SDK still validates inputs against
 * the shape at call time. We just opt out of static inference on the
 * registration boundary; tool callbacks declare their own argument types.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface RegisterToolConfig {
  title?: string;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema?: Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolHandler = (args: any) => Promise<any>;

export function registerTool(server: McpServer, name: string, config: RegisterToolConfig, handler: ToolHandler): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server.registerTool as any)(name, config, handler);
}
