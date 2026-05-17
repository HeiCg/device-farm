/**
 * WebSocket protocol constants and message types
 * Standardized across all device streaming packages
 */

/**
 * Codec identifier values
 */
export const CODEC = {
  H264: 0,
  MJPEG: 1,
  H265: 2,
} as const;

/**
 * Codec name strings
 */
export const CODEC_NAME = {
  0: 'h264',
  1: 'mjpeg',
  2: 'h265',
} as const;

/**
 * Message types for WebSocket communication
 */
export const MESSAGE_TYPE = {
  METADATA: 'metadata',
  FRAME: 'frame',
  DATA: 'data',
  PING: 'ping',
  PONG: 'pong',
  COMMAND: 'command',
  DEVICE_CONNECTED: 'device_connected',
  DEVICE_DISCONNECTED: 'device_disconnected',
  REQUEST_METADATA: 'request_metadata',
  CONFIGURATION: 'configuration',
} as const;

/**
 * Metadata message sent when stream starts
 */
export interface MetadataMessage {
  type: 'metadata';
  codec: 0 | 1 | 2;
  codecName: string;
  width: number;
  height: number;
  fps?: number;
}

/**
 * Frame message for MJPEG streams
 */
export interface FrameMessage {
  type: 'frame';
  data: string;  // Base64 encoded JPEG
  pts: number;
  codec: 'mjpeg';
}

/**
 * Data message for H.264 streams
 */
export interface DataMessage {
  type: 'data';
  data: string;  // Base64 encoded bytes
  keyframe: boolean;
  pts: string;  // BigInt as string
}

/**
 * Device disconnected message
 */
export interface DeviceDisconnectedMessage {
  type: 'device_disconnected';
  deviceId: string;
}

/**
 * Ping message for keepalive
 */
export interface PingMessage {
  type: 'ping';
  timestamp: number;
}

/**
 * Create a metadata message
 */
export function createMetadataMessage(
  codec: 'h264' | 'mjpeg' | 'h265',
  width: number,
  height: number,
  fps?: number
): MetadataMessage {
  const codecMap: Record<string, 0 | 1 | 2> = { h264: 0, mjpeg: 1, h265: 2 };
  return {
    type: 'metadata',
    codec: codecMap[codec],
    codecName: codec,
    width,
    height,
    fps,
  };
}

/**
 * Create a frame message for MJPEG
 */
export function createFrameMessage(
  base64Data: string,
  pts: number
): FrameMessage {
  return {
    type: 'frame',
    data: base64Data,
    pts,
    codec: 'mjpeg',
  };
}

/**
 * Create a data message for H.264
 */
export function createDataMessage(
  data: Uint8Array | number[],
  keyframe: boolean,
  pts: bigint
): DataMessage {
  const base64 = data instanceof Uint8Array
    ? Buffer.from(data).toString('base64')
    : Buffer.from(data).toString('base64');
  return {
    type: 'data',
    data: base64,
    keyframe,
    pts: pts.toString(),
  };
}
