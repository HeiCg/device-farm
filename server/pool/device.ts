import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { DeviceState, VALID_TRANSITIONS, type Platform, type DeviceInfo, type DeviceMetadata } from '../types/index.js';

export class InvalidTransitionError extends Error {
  constructor(from: DeviceState, to: DeviceState) {
    super(`Invalid state transition from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class Device extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  private _state: DeviceState;
  emulatorId: string;
  port: number | null;
  pid: number | null;
  // Phase 33 / Plan 33-06 — gRPC EmulatorController port allocated by the
  // Android driver (band 8554-8650) at boot. Null for non-emulator drivers,
  // pre-Phase-33 boots, and the alreadyHealthy reuse branch in initPool
  // (no boot occurred, so no fresh allocation — see DEFERRED-33-06-A).
  grpcPort: number | null;
  currentJobId: string | null;
  metadata: DeviceMetadata | null;
  private readonly mutex: Mutex;

  constructor(name: string, platform: Platform, options?: { emulatorId?: string; id?: string }) {
    super();
    this.id = options?.id ?? randomUUID();
    this.name = name;
    this.platform = platform;
    this._state = DeviceState.Booting;
    this.emulatorId = options?.emulatorId ?? '';
    this.port = null;
    this.pid = null;
    this.grpcPort = null;
    this.currentJobId = null;
    this.metadata = null;
    this.mutex = new Mutex();
  }

  get state(): DeviceState {
    return this._state;
  }

  transition(newState: DeviceState): { from: DeviceState; to: DeviceState } {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(newState)) {
      throw new InvalidTransitionError(this._state, newState);
    }
    const from = this._state;
    this._state = newState;
    this.emit('stateChange', { from, to: newState });
    return { from, to: newState };
  }

  async allocate(jobId: string): Promise<void> {
    await this.mutex.runExclusive(() => {
      this.transition(DeviceState.Allocated);
      this.currentJobId = jobId;
    });
  }

  release(): void {
    this.transition(DeviceState.Idle);
    this.currentJobId = null;
    this.pid = null;
  }

  toInfo(): DeviceInfo {
    return {
      id: this.id,
      name: this.name,
      platform: this.platform,
      state: this._state,
      emulatorId: this.emulatorId,
      port: this.port,
      pid: this.pid,
      grpcPort: this.grpcPort,
      currentJobId: this.currentJobId,
      metadata: this.metadata,
    };
  }
}
