/**
 * Camera WebSocket protocol — discriminated unions for the messages
 * exchanged on `/cameras/:udid/camera`.
 *
 * Ported from baguette (Apache-2.0):
 *   Sources/Baguette/Domain/Camera/CameraMessage.swift
 *
 * Wire format (JSON):
 *   client → server: camera_list | camera_start | camera_stop | camera_set_flags
 *   server → client: camera_devices | camera_state | camera_error
 */

export type CameraFit = 'fit' | 'fill';

export interface CameraFlags {
  fit: CameraFit;
  mirror: boolean;
}

export const DEFAULT_CAMERA_FLAGS: CameraFlags = { fit: 'fit', mirror: false };

// ─── Client → server ───

export interface CameraListMessage {
  type: 'camera_list';
}

export interface CameraStartMessage {
  type: 'camera_start';
  deviceUID: string;
  fit: CameraFit;
  mirror: boolean;
}

export interface CameraStopMessage {
  type: 'camera_stop';
}

export interface CameraSetFlagsMessage {
  type: 'camera_set_flags';
  fit?: CameraFit;
  mirror?: boolean;
}

export type CameraClientMessage =
  | CameraListMessage
  | CameraStartMessage
  | CameraStopMessage
  | CameraSetFlagsMessage;

// ─── Server → client ───

export interface CameraDevice {
  uid: string;
  name: string;
  modelID: string;
  localizedName: string;
}

export interface CameraDevicesMessage {
  type: 'camera_devices';
  devices: CameraDevice[];
}

export interface CameraStateMessage {
  type: 'camera_state';
  phase: 'idle' | 'streaming';
  fps?: number;
  device?: string;
}

export interface CameraErrorMessage {
  type: 'camera_error';
  error: string;
}

export type CameraServerMessage =
  | CameraDevicesMessage
  | CameraStateMessage
  | CameraErrorMessage;

// ─── Parsing ───

export type ParseResult =
  | { ok: true; value: CameraClientMessage }
  | { ok: false; error: string };

function parseFit(raw: unknown): CameraFit {
  return raw === 'fill' ? 'fill' : 'fit';
}

/**
 * Parse a raw inbound WS payload into a `CameraClientMessage`. Returns
 * a tagged result so callers don't have to wrap each call in try/catch.
 */
export function parseCameraMessage(raw: string): ParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `camera message: invalid JSON: ${(err as Error).message}` };
  }
  if (!obj || typeof obj !== 'object') {
    return { ok: false, error: 'camera message: payload is not an object' };
  }
  const o = obj as Record<string, unknown>;
  const type = o.type;
  if (typeof type !== 'string') {
    return { ok: false, error: "camera message: missing 'type'" };
  }
  switch (type) {
    case 'camera_list':
      return { ok: true, value: { type: 'camera_list' } };
    case 'camera_start': {
      const uid = o.deviceUID;
      if (typeof uid !== 'string' || uid.length === 0) {
        return { ok: false, error: "camera message: missing field 'deviceUID'" };
      }
      return {
        ok: true,
        value: {
          type: 'camera_start',
          deviceUID: uid,
          fit: parseFit(o.fit),
          mirror: o.mirror === true,
        },
      };
    }
    case 'camera_stop':
      return { ok: true, value: { type: 'camera_stop' } };
    case 'camera_set_flags': {
      const msg: CameraSetFlagsMessage = { type: 'camera_set_flags' };
      if (typeof o.fit === 'string') msg.fit = parseFit(o.fit);
      if (typeof o.mirror === 'boolean') msg.mirror = o.mirror;
      return { ok: true, value: msg };
    }
    default:
      return { ok: false, error: `camera message: unknown type '${type}'` };
  }
}
