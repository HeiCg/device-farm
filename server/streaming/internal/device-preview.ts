import type pino from 'pino';

export type Platform = 'android' | 'ios';
export type FrameHandler = (frame: Buffer) => void;

/**
 * Adapter interface that wraps the actual @device-stream library API.
 * Implementations: AndroidStreamAdapter, IosStreamAdapter (created at integration time).
 * For testing, a mock adapter is injected via adapterFactory.
 */
export interface DeviceStreamAdapter {
  start(deviceId: string): Promise<void>;
  onFrame(handler: (frame: Buffer) => void): void;
  stop(): Promise<void>;
}

export type AdapterFactory = (deviceId: string, platform: Platform) => DeviceStreamAdapter;

export class DevicePreviewManager {
  private readonly logger: pino.Logger;
  private readonly adapterFactory: AdapterFactory;
  private readonly streams: Map<string, DeviceStreamAdapter> = new Map();
  private readonly subscribers: Map<string, Set<FrameHandler>> = new Map();

  constructor(logger: pino.Logger, adapterFactory?: AdapterFactory) {
    this.logger = logger.child({ component: 'device-preview' });
    this.adapterFactory = adapterFactory ?? this.defaultAdapterFactory.bind(this);
  }

  async startPreview(deviceId: string, platform: Platform): Promise<void> {
    if (this.streams.has(deviceId)) {
      throw new Error(`Already streaming for device ${deviceId}`);
    }

    const adapter = this.adapterFactory(deviceId, platform);
    this.streams.set(deviceId, adapter);
    this.subscribers.set(deviceId, new Set());

    // Set up frame fan-out before starting
    adapter.onFrame((frame: Buffer) => {
      const subs = this.subscribers.get(deviceId);
      if (subs) {
        for (const handler of subs) {
          try {
            handler(frame);
          } catch (err: any) {
            this.logger.error({ deviceId, error: err.message }, 'Frame handler error');
          }
        }
      }
    });

    await adapter.start(deviceId);
    this.logger.info({ deviceId, platform }, 'Device preview started');
  }

  subscribe(deviceId: string, handler: FrameHandler): () => void {
    const subs = this.subscribers.get(deviceId);
    if (!subs) {
      this.logger.warn({ deviceId }, 'No active stream for device, returning no-op unsubscribe');
      return () => {};
    }

    subs.add(handler);
    this.logger.debug({ deviceId, subscriberCount: subs.size }, 'Subscriber added');

    return () => {
      subs.delete(handler);
      this.logger.debug({ deviceId, subscriberCount: subs.size }, 'Subscriber removed');
    };
  }

  async stopPreview(deviceId: string): Promise<void> {
    const adapter = this.streams.get(deviceId);
    if (!adapter) {
      this.logger.warn({ deviceId }, 'No active stream to stop');
      return;
    }

    await adapter.stop();
    this.streams.delete(deviceId);
    this.subscribers.delete(deviceId);
    this.logger.info({ deviceId }, 'Device preview stopped');
  }

  /**
   * Inject an adapter factory after construction. Required because websocket-plugin
   * (which creates DevicePreviewManager) registers before artifact-plugin (which
   * provides ScrcpyService/CaptureService), so the factory can't be passed at
   * construction time.
   */
  setAdapterFactory(factory: AdapterFactory): void {
    (this as any).adapterFactory = factory;
  }

  getFrameStream(deviceId: string): DeviceStreamAdapter | null {
    return this.streams.get(deviceId) ?? null;
  }

  private defaultAdapterFactory(_deviceId: string, platform: Platform): DeviceStreamAdapter {
    // Dynamic import adapters will be created when @device-stream packages are integrated.
    // This factory serves as the integration point.
    throw new Error(
      `No adapter factory configured. Cannot create adapter for platform: ${platform}. ` +
      'Provide an adapterFactory in the constructor.',
    );
  }
}
