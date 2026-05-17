/**
 * Phase 36 / Plan 36-02 — Devices store (DISC-WS).
 *
 * Opens `GET WS /api/devices/stream` and applies
 * `device.discovered.{added,removed,changed}` frames to the reactive
 * `devices` array (Svelte 5 runes).
 *
 * Used by the CommandPalette device-select step and the dashboard live list.
 *
 * The pure `applyFrame` method is exported so it can be unit-tested
 * without a real WebSocket / jsdom.
 */

export interface DiscoveredDevice {
  id: string;
  name: string;
  platform: string;
  state: string;
  deviceType?: string;
  osVersion?: string | null;
  model?: string | null;
}

interface WsFrame {
  v: number;
  type: string;
  correlationId: string;
  ts: string;
  payload?: {
    type?: string;
    device?: DiscoveredDevice;
  };
}

const DISCOVERY_TYPES = new Set([
  'device.discovered.added',
  'device.discovered.removed',
  'device.discovered.changed',
]);

export class DeviceStore {
  devices = $state<DiscoveredDevice[]>([]);
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Apply a single WS frame to the reactive devices array.
   * Pure: no I/O. Exported for unit tests.
   */
  applyFrame(frame: WsFrame): void {
    const type = frame?.type;
    if (!type || !DISCOVERY_TYPES.has(type)) return;
    const device = frame.payload?.device;
    if (!device || !device.id) return;

    switch (type) {
      case 'device.discovered.added': {
        const idx = this.devices.findIndex(d => d.id === device.id);
        if (idx === -1) {
          this.devices.push(device);
        } else {
          this.devices[idx] = device;
        }
        break;
      }
      case 'device.discovered.removed': {
        this.devices = this.devices.filter(d => d.id !== device.id);
        break;
      }
      case 'device.discovered.changed': {
        const idx = this.devices.findIndex(d => d.id === device.id);
        if (idx !== -1) {
          this.devices[idx] = device;
        }
        // If unknown, no-op (server WS should resend an added frame if needed).
        break;
      }
    }
  }

  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/api/devices/stream`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onmessage = (ev: MessageEvent): void => {
      try {
        const frame = JSON.parse(ev.data) as WsFrame;
        this.applyFrame(frame);
      } catch {
        // Drop malformed frames
      }
    };

    this.ws.onclose = (): void => {
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = (): void => {
      // Errors are followed by onclose; let that handler reconnect.
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3_000);
  }
}

export const deviceStore = new DeviceStore();
