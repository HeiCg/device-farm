/**
 * Wires the DSL→MCP tool registry onto an McpServer, and builds a
 * @device-stream/dsl session from environment config.
 *
 * The session is resolved lazily (on first tool call) via the provider, so
 * registration never blocks on a device connection.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DeviceStreamSession, SessionOptions } from '@device-stream/dsl';
import { createSession } from '@device-stream/dsl';
import { DeviceMutexManager } from '@device-stream/core';
import { registerTool } from '../tools/_helpers.js';
import { buildDslToolRegistry } from './registry.js';
import { SCRIPT_TOOL_NAME, scriptToolDescription, scriptInputShape, executeScript } from './script-tool.js';

export type DslSessionProvider = () => Promise<DeviceStreamSession>;

export interface RegisterDslOptions {
  /** Env the `dsl_run_script` tool reads its device config from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Project root that owns `node_modules/.bin/tsx` + the `.df-hook-tmp` scratch dir. */
  cwd?: string;
  /**
   * Per-device mutex shared by every DSL tool so a `dsl_run_script` body and a
   * stray `dsl_tap` can't interleave on the same device. Defaults to a fresh one.
   */
  mutex?: DeviceMutexManager;
}

export function registerDslTools(
  server: McpServer,
  getSession: DslSessionProvider,
  options: RegisterDslOptions = {},
): void {
  const env = options.env ?? process.env;
  const cwd = options.cwd;
  const mutex = options.mutex ?? new DeviceMutexManager();

  for (const tool of buildDslToolRegistry()) {
    registerTool(
      server,
      tool.name,
      { title: tool.name, description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown> | undefined) => {
        const session = await getSession();
        return mutex.withDeviceLock(session.serial, () => tool.execute(session, args ?? {}));
      },
    );
  }

  // Agent-authored typed scripts. Serialized against the atomic tools above via
  // the same per-device mutex; device config comes from the same env vars the
  // memoized session was built from.
  registerTool(
    server,
    SCRIPT_TOOL_NAME,
    { title: SCRIPT_TOOL_NAME, description: scriptToolDescription, inputSchema: scriptInputShape },
    async (args: Record<string, unknown> | undefined) => {
      const session = await getSession();
      const sessionConfig = sessionConfigFromEnv(env);
      return mutex.withDeviceLock(session.serial, () => executeScript(args ?? {}, sessionConfig, cwd));
    },
  );
}

/**
 * Build a DSL session from env vars:
 *   DEVICE_STREAM_SERIAL   (required)
 *   DEVICE_STREAM_PLATFORM 'android' | 'ios' (required)
 *   DEVICE_STREAM_ANDROID_SERVER_URL  (android, default http://localhost:9008)
 *   DEVICE_STREAM_WDA_URL             (ios, default http://localhost:8100)
 *   DEVICE_STREAM_IOS_KIND 'simulator' | 'device'  (ios, default simulator)
 */
export function sessionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SessionOptions {
  const serial = env.DEVICE_STREAM_SERIAL;
  const platform = env.DEVICE_STREAM_PLATFORM as SessionOptions['platform'] | undefined;
  if (!serial) throw new Error('DEVICE_STREAM_SERIAL is required');
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error("DEVICE_STREAM_PLATFORM must be 'android' or 'ios'");
  }
  return {
    serial,
    platform,
    androidServerUrl: env.DEVICE_STREAM_ANDROID_SERVER_URL,
    wdaUrl: env.DEVICE_STREAM_WDA_URL,
    iosKind: (env.DEVICE_STREAM_IOS_KIND as SessionOptions['iosKind']) ?? undefined,
  };
}

export async function createSessionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DeviceStreamSession> {
  return createSession(sessionConfigFromEnv(env));
}

/**
 * Cache a single session per provider so repeated tool calls reuse one
 * connection (and one WDA session) instead of reconnecting each time.
 */
export function memoizeSession(factory: DslSessionProvider): DslSessionProvider {
  let cached: Promise<DeviceStreamSession> | undefined;
  return () => {
    if (cached) return cached;
    // Cache the in-flight/resolved promise, but drop it on rejection so a
    // transient connect failure doesn't brick every DSL tool forever. The
    // error still propagates to this caller.
    const p = factory();
    cached = p;
    p.catch(() => {
      if (cached === p) cached = undefined;
    });
    return p;
  };
}
