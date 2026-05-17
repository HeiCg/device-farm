/**
 * device-stream wire protocol v2.
 *
 * Single text-JSON envelope on the upstream channel (browser → server).
 * Single 1-byte-tagged binary envelope on the downstream channel
 * (server → browser) for AVCC. Ported from baguette's stream protocol —
 * see /tmp/baguette/Sources/Baguette/Resources/Web/frame-decoder.js and
 * /tmp/baguette/Sources/Baguette/Resources/Web/baguette/transport.js.
 */

// --- Control messages (stream tuning, snapshot, IDR) ---
export type SetBitrateMessage = { type: 'set_bitrate'; bps: number };
export type SetFpsMessage     = { type: 'set_fps'; fps: number };
export type SetScaleMessage   = { type: 'set_scale'; scale: number };
export type ForceIdrMessage   = { type: 'force_idr' };
export type SnapshotMessage   = { type: 'snapshot' };

export type ControlMessage =
  | SetBitrateMessage
  | SetFpsMessage
  | SetScaleMessage
  | ForceIdrMessage
  | SnapshotMessage;

// --- Gesture messages (input dispatch) ---
export type TapMessage = {
  type: 'tap';
  x: number; y: number;
  width: number; height: number;
  duration?: number;
};

export type SwipeMessage = {
  type: 'swipe';
  startX: number; startY: number;
  endX: number;   endY: number;
  width: number;  height: number;
  duration?: number;
};

export type Touch1Phase = 'touch1-down' | 'touch1-move' | 'touch1-up';
export type Touch1Message = {
  type: Touch1Phase;
  x: number; y: number;
  width: number; height: number;
  edge?: 'top' | 'bottom' | 'left' | 'right';
};

export type Touch2Phase = 'touch2-down' | 'touch2-move' | 'touch2-up';
export type Touch2Message = {
  type: Touch2Phase;
  x1: number; y1: number;
  x2: number; y2: number;
  width: number; height: number;
};

export type ButtonName =
  | 'home' | 'lock' | 'power'
  | 'volume-up' | 'volume-down'
  | 'action' | 'app-switcher' | 'back'
  | 'swipe-to-home' | 'swipe-to-app-switcher'
  | 'pull-down-to-lock-screen' | 'pull-down-to-notification-center'
  | 'digital-crown' | 'side-button' | 'left-side-button';

export type ButtonMessage = {
  type: 'button';
  button: ButtonName;
  duration?: number;
};

export type KeyMessage = {
  type: 'key';
  code: string;                                        // W3C KeyboardEvent.code
  modifiers?: ('shift' | 'control' | 'option' | 'command')[];
  duration?: number;
};

export type TypeMessage = { type: 'type'; text: string };
export type ScrollMessage = {
  type: 'scroll';
  deltaX: number; deltaY: number;
};

export type PinchMessage = {
  type: 'pinch';
  cx: number; cy: number;
  startSpread: number; endSpread: number;
  width: number; height: number;
  duration?: number;
};

export type PanMessage = {
  type: 'pan';
  x1: number; y1: number;
  x2: number; y2: number;
  dx: number;  dy: number;
  width: number; height: number;
  duration?: number;
};

export type GestureMessage =
  | TapMessage | SwipeMessage
  | Touch1Message | Touch2Message
  | ButtonMessage | KeyMessage | TypeMessage
  | ScrollMessage | PinchMessage | PanMessage;

// --- Side channels (request/response on same WS) ---
export type DescribeUiMessage = {
  type: 'describe_ui';
  x?: number; y?: number;
};

// --- Logs subscription (client → server) ---
export type SubscribeLogsMessage = {
  type: 'subscribe_logs';
  level?: 'info' | 'debug' | 'default';
  predicate?: string;
  bundleId?: string;
};
export type StopLogsMessage = { type: 'stop_logs' };

// --- Server → client events ---
export type LogStartedEvent = { type: 'log_started' };
export type LogLineEvent    = { type: 'log'; line: string };
export type LogStoppedEvent = { type: 'log_stopped'; reason: string };

export type AXNode = {
  role: string;
  subrole: string | null;
  label: string | null;
  value: string | null;
  identifier: string | null;
  title: string | null;
  help: string | null;
  frame: { x: number; y: number; width: number; height: number } | null;
  enabled: boolean;
  focused: boolean;
  hidden: boolean;
  children: AXNode[];
};

export type DescribeUiResultEvent =
  | { type: 'describe_ui_result'; ok: true;  tree: AXNode }
  | { type: 'describe_ui_result'; ok: false; error: string };

export type MetadataEvent = {
  type: 'metadata';
  codec: 'h264' | 'mjpeg';
  width: number;
  height: number;
  fps: number;
};

export type ErrorEvent = { type: 'error'; error: string };

export type ServerEvent =
  | LogStartedEvent
  | LogLineEvent
  | LogStoppedEvent
  | DescribeUiResultEvent
  | MetadataEvent
  | ErrorEvent;

export function parseServerEvent(raw: string):
  | { ok: true; value: ServerEvent }
  | { ok: false; error: string }
{
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, error: `malformed JSON: ${(e as Error).message}` }; }
  if (!parsed || typeof parsed.type !== 'string') {
    return { ok: false, error: 'missing string `type` field' };
  }
  return { ok: true, value: parsed as ServerEvent };
}

export type ClientMessageV2 =
  | ControlMessage
  | GestureMessage
  | DescribeUiMessage
  | SubscribeLogsMessage
  | StopLogsMessage;

// --- Parse helpers ---
const CONTROL_TYPES = new Set([
  'set_bitrate', 'set_fps', 'set_scale', 'force_idr', 'snapshot',
]);
const GESTURE_TYPES = new Set([
  'tap', 'swipe',
  'touch1-down', 'touch1-move', 'touch1-up',
  'touch2-down', 'touch2-move', 'touch2-up',
  'button', 'key', 'type', 'scroll', 'pinch', 'pan',
]);
const SIDE_CHANNEL_TYPES = new Set(['describe_ui', 'subscribe_logs', 'stop_logs']);

export type ParseResult =
  | { ok: true; value: ClientMessageV2 }
  | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult {
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, error: `malformed JSON: ${(e as Error).message}` }; }

  if (!parsed || typeof parsed.type !== 'string') {
    return { ok: false, error: 'missing string `type` field' };
  }
  if (
    !CONTROL_TYPES.has(parsed.type) &&
    !GESTURE_TYPES.has(parsed.type) &&
    !SIDE_CHANNEL_TYPES.has(parsed.type)
  ) {
    return { ok: false, error: `unknown envelope type: ${parsed.type}` };
  }
  return { ok: true, value: parsed as ClientMessageV2 };
}

export function isControlMessage(m: ClientMessageV2): m is ControlMessage {
  return CONTROL_TYPES.has(m.type);
}

export function isGestureMessage(m: ClientMessageV2): m is GestureMessage {
  return GESTURE_TYPES.has(m.type);
}

// --- Binary frame envelope (AVCC + JPEG seed) ---
export type AvccFrameKind = 'avcc' | 'keyframe' | 'delta' | 'jpeg-seed';

const AVCC_TAG: Record<AvccFrameKind, number> = {
  'avcc':      0x01,
  'keyframe':  0x02,
  'delta':     0x03,
  'jpeg-seed': 0x04,
};

export function serializeAvccFrame(
  kind: AvccFrameKind,
  payload: Uint8Array
): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = AVCC_TAG[kind];
  out.set(payload, 1);
  return out;
}
