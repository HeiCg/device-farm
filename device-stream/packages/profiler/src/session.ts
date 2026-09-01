import type { CaptureBackend, ProfilerKind, ProfilerState, RawProfile } from './types';

/**
 * Drives a single capture backend through the idle → recording → stopped
 * lifecycle with guards. Holds the device id for ownership checks (a device
 * may only host one profiler session of a given kind at a time).
 */
export class ProfilerSession {
  private _state: ProfilerState = 'idle';
  private _profile: RawProfile | undefined;

  constructor(private readonly backend: CaptureBackend, readonly deviceId: string) {}

  get state(): ProfilerState {
    return this._state;
  }

  get kind(): ProfilerKind {
    return this.backend.kind;
  }

  async start(): Promise<void> {
    if (this._state === 'recording') throw new Error('Profiler is already recording');
    if (this._state === 'stopped') throw new Error('Profiler session already finished; create a new one');
    await this.backend.start(this.deviceId);
    this._state = 'recording';
  }

  async stop(): Promise<RawProfile> {
    if (this._state !== 'recording') throw new Error('Profiler is not recording');
    this._profile = await this.backend.stop();
    this._state = 'stopped';
    return this._profile;
  }

  /** The captured profile, available after stop(). */
  get profile(): RawProfile | undefined {
    return this._profile;
  }
}
