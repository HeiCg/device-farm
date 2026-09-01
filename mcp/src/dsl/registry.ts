/**
 * DSL→MCP tool registry.
 *
 * Maps @device-stream/dsl session verbs onto MCP tools, so an agent can drive a
 * real device with rich selectors (contains/regex/visible), scroll-until-visible,
 * a normalized `describe` tree, field fills, and flow replay — the capabilities
 * the legacy pixel/NL tools lack.
 *
 * `execute(session, args)` is pure dispatch and is unit-tested against a fake
 * session. The thin McpServer wiring lives in ./register.ts.
 */
import type { DeviceStreamSession, Selector } from '@device-stream/dsl';
import { parseFlow, executeFlow } from '@device-stream/dsl';
import * as S from './schemas.js';

export interface DslToolResultContent {
  type: 'text' | 'image';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface DslToolResult {
  content: DslToolResultContent[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface DslTool {
  name: string;
  description: string;
  // zod raw shape (Record<string, ZodType>)
  inputSchema: Record<string, unknown>;
  execute(session: DeviceStreamSession, args: Record<string, unknown>): Promise<DslToolResult>;
}

/** Default screenshot capture scale — keeps a 1080×2400 frame to ~25 KB base64. */
const DEFAULT_SCREENSHOT_SCALE = 0.25;
/** Max encoded (base64) screenshot payload before we refuse rather than return the blob. */
const SCREENSHOT_BYTE_CAP = 1024 * 1024;

function text(t: string): DslToolResult {
  return { content: [{ type: 'text', text: t }] };
}

/** Wrap a handler so any throw becomes an `isError` result instead of rejecting. */
function guarded(
  name: string,
  fn: (session: DeviceStreamSession, args: Record<string, unknown>) => Promise<DslToolResult>,
): DslTool['execute'] {
  return async (session, args) => {
    try {
      return await fn(session, args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `${name} failed: ${message}` }], isError: true };
    }
  };
}

const TOOLS: DslTool[] = [
  {
    name: 'dsl_tap',
    description: 'Tap the element matching a selector (id/text/contentDescription/className, with contains/regex/caseInsensitive). Waits for it to appear.',
    inputSchema: S.tapShape,
    execute: guarded('dsl_tap', async (s, a) => {
      await s.tapOn(a.selector as Selector);
      return text('ok');
    }),
  },
  {
    name: 'dsl_fill',
    description: 'Tap a field matching the selector and type text into it.',
    inputSchema: S.fillShape,
    execute: guarded('dsl_fill', async (s, a) => {
      await s.get(a.selector as Selector).fill(a.text as string);
      return text('ok');
    }),
  },
  {
    name: 'dsl_long_press',
    description: 'Long-press the element matching a selector.',
    inputSchema: S.longPressShape,
    execute: guarded('dsl_long_press', async (s, a) => {
      await s.get(a.selector as Selector).longPress(a.durationMs as number | undefined);
      return text('ok');
    }),
  },
  {
    name: 'dsl_element_text',
    description: 'Return the text of the element matching a selector.',
    inputSchema: S.elementTextShape,
    execute: guarded('dsl_element_text', async (s, a) => text(await s.copyText(a.selector as Selector))),
  },
  {
    name: 'dsl_press_key',
    description: 'Press a hardware key (back/home/enter/menu/volumeUp/volumeDown/power).',
    inputSchema: S.pressKeyShape,
    execute: guarded('dsl_press_key', async (s, a) => {
      await s.pressKey(a.key as never);
      return text('ok');
    }),
  },
  {
    name: 'dsl_swipe',
    description: 'Swipe in raw screen coordinates.',
    inputSchema: S.swipeShape,
    execute: guarded('dsl_swipe', async (s, a) => {
      await s.swipe(a as never);
      return text('ok');
    }),
  },
  {
    name: 'dsl_scroll',
    description: 'Scroll the screen one page in a direction (content-travel direction).',
    inputSchema: S.scrollShape,
    execute: guarded('dsl_scroll', async (s, a) => {
      await s.scroll(a.direction as never, { distance: a.distance as number | undefined, durationMs: a.durationMs as number | undefined });
      return text('ok');
    }),
  },
  {
    name: 'dsl_scroll_until_visible',
    description: 'Scroll in a direction until a (visible) element matching the selector appears; returns it.',
    inputSchema: S.scrollUntilVisibleShape,
    execute: guarded('dsl_scroll_until_visible', async (s, a) => {
      const el = await s.scrollUntilVisible(a.selector as Selector, {
        direction: a.direction as never,
        maxScrolls: a.maxScrolls as number | undefined,
      });
      return { content: [{ type: 'text', text: JSON.stringify(el) }] };
    }),
  },
  {
    name: 'dsl_wait_for_idle',
    description: 'Block until the UI stops changing (or the timeout elapses).',
    inputSchema: S.waitForIdleShape,
    execute: guarded('dsl_wait_for_idle', async (s, a) => {
      await s.waitForIdle(a.timeoutMs as number | undefined);
      return text('ok');
    }),
  },
  {
    name: 'dsl_describe',
    description: 'Return a compact, normalized, visible-only outline of the screen (ids/text/center coords) for navigation.',
    inputSchema: S.emptyShape,
    execute: guarded('dsl_describe', async (s) => text(await s.describeText())),
  },
  {
    name: 'dsl_screenshot',
    description: 'Capture a PNG screenshot (default scale 0.25 to keep the payload small; pass scale 0.05–1 for more/less detail).',
    inputSchema: S.screenshotShape,
    execute: guarded('dsl_screenshot', async (s, a) => {
      const scale = (a.scale as number | undefined) ?? DEFAULT_SCREENSHOT_SCALE;
      const buf = await s.screenshot({ scale });
      const data = buf.toString('base64');
      if (data.length > SCREENSHOT_BYTE_CAP) {
        const kb = Math.round(data.length / 1024);
        return {
          content: [{
            type: 'text',
            text: `Screenshot too large: ${kb} KB base64 (cap ${SCREENSHOT_BYTE_CAP / 1024} KB). Lower \`scale\` (e.g. 0.25 or less) and retry.`,
          }],
          isError: true,
        };
      }
      return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
    }),
  },
  {
    name: 'dsl_launch_app',
    description: 'Launch an app by package name (Android) or bundle id (iOS).',
    inputSchema: S.launchAppShape,
    execute: guarded('dsl_launch_app', async (s, a) => {
      await s.launchApp(a.id as string);
      return text('ok');
    }),
  },
  {
    name: 'dsl_stop_app',
    description: 'Force-stop an app by package name / bundle id.',
    inputSchema: S.launchAppShape,
    execute: guarded('dsl_stop_app', async (s, a) => {
      await s.stopApp(a.id as string);
      return text('ok');
    }),
  },
  {
    name: 'dsl_open_url',
    description: 'Open a URL or deep link.',
    inputSchema: S.openUrlShape,
    execute: guarded('dsl_open_url', async (s, a) => {
      await s.openUrl(a.url as string);
      return text('ok');
    }),
  },
  {
    name: 'dsl_install_app',
    description: 'Install an app (APK on Android, .app bundle on iOS simulator).',
    inputSchema: S.installAppShape,
    execute: guarded('dsl_install_app', async (s, a) => {
      await s.installApp(a.path as string);
      return text('ok');
    }),
  },
  {
    name: 'dsl_grant_permissions',
    description: "Grant runtime permissions to an app ('*' grants all declared).",
    inputSchema: S.grantPermissionsShape,
    execute: guarded('dsl_grant_permissions', async (s, a) => {
      await s.grantPermissions(a.packageName as string, a.permissions as string[] | '*' | undefined);
      return text('ok');
    }),
  },
  {
    name: 'dsl_set_location',
    description: 'Set the device GPS location.',
    inputSchema: S.setLocationShape,
    execute: guarded('dsl_set_location', async (s, a) => {
      await s.setLocation(a.latitude as number, a.longitude as number);
      return text('ok');
    }),
  },
  {
    name: 'dsl_run_flow',
    description: 'Replay a recorded device-stream flow (YAML) step by step.',
    inputSchema: S.runFlowShape,
    execute: guarded('dsl_run_flow', async (s, a) => {
      const flow = parseFlow(a.flowYaml as string);
      await executeFlow(s, flow);
      return text(`replayed ${flow.steps.length} step(s)`);
    }),
  },
];

export function buildDslToolRegistry(): DslTool[] {
  return TOOLS;
}

export function getDslTool(name: string): DslTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export const DSL_TOOL_NAMES = TOOLS.map((t) => t.name);
