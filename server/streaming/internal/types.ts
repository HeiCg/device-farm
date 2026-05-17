// WebSocket streaming message types for real-time job output

export type WsMessageType = 'log' | 'step' | 'metrics' | 'status';

export interface JobMessage {
  type: WsMessageType;
  data: unknown;
  timestamp: string;
}

export interface DevicePreviewMessage {
  type: 'frame';
  data: string; // base64-encoded frame
  timestamp: string;
}

export interface LogData {
  line: string;
  stream: 'stdout' | 'stderr';
}

export interface StepData {
  flowName: string;
  command: string | null;
  status: string;
  durationMs: number | null;
}

export interface MetricsData {
  totalPss: number;
  nativeHeap: number;
  javaHeap: number;
}

export interface StatusData {
  status: 'running' | 'passed' | 'failed' | 'cancelled' | 'timeout';
}

export type ArtifactType = 'video' | 'screenshot' | 'memory' | 'log';
