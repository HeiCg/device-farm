/**
 * AppiumService — manages Appium WebDriver sessions per device.
 *
 * Sessions are created on-demand when the 'appium' hierarchy source is selected,
 * cached per device, and auto-closed after a TTL of inactivity.
 *
 * Appium W3C endpoints used:
 *   POST   /session              — create session with capabilities
 *   GET    /session/:id/source   — get page source (UI hierarchy XML)
 *   DELETE /session/:id          — close session
 */
import type pino from 'pino';

const DEFAULT_SERVER_URL = 'http://localhost:4723';
const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface AppiumConfig {
  serverUrl: string;
  sessionTimeoutMs: number;
}

interface CachedSession {
  sessionId: string;
  deviceId: string;
  platform: string;
  createdAt: number;
  lastUsedAt: number;
}

export class AppiumService {
  private readonly logger: pino.Logger;
  private readonly config: AppiumConfig;
  private readonly sessions: Map<string, CachedSession> = new Map();
  private readonly fetchFn: typeof fetch;

  constructor(
    logger: pino.Logger,
    config?: Partial<AppiumConfig>,
    fetchFn?: typeof fetch,
  ) {
    this.logger = logger.child({ component: 'appium-service' });
    this.config = {
      serverUrl: config?.serverUrl ?? DEFAULT_SERVER_URL,
      sessionTimeoutMs: config?.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS,
    };
    this.fetchFn = fetchFn ?? globalThis.fetch;
  }

  /**
   * Get or create an Appium session for a device.
   * Reuses cached session if not expired, creates a new one otherwise.
   */
  async getOrCreateSession(
    platform: 'android' | 'ios',
    deviceId: string,
    udid: string,
  ): Promise<string> {
    // Evict expired sessions first
    this.evictExpired();

    const cached = this.sessions.get(deviceId);
    if (cached) {
      // Validate session is still alive
      try {
        const resp = await this.fetchFn(
          `${this.config.serverUrl}/session/${cached.sessionId}`,
          { signal: AbortSignal.timeout(3000) },
        );
        if (resp.ok) {
          cached.lastUsedAt = Date.now();
          this.logger.debug({ deviceId, sessionId: cached.sessionId }, 'Reusing Appium session');
          return cached.sessionId;
        }
      } catch {
        // Session dead — clean up and create new
      }
      this.sessions.delete(deviceId);
    }

    // Create new session
    return this.createSession(platform, deviceId, udid);
  }

  /**
   * Create a new Appium session.
   */
  private async createSession(
    platform: 'android' | 'ios',
    deviceId: string,
    udid: string,
  ): Promise<string> {
    const capabilities = platform === 'android'
      ? {
          platformName: 'Android',
          'appium:automationName': 'UiAutomator2',
          'appium:udid': udid,
          'appium:noReset': true,
          'appium:autoLaunch': false,
          'appium:skipServerInstallation': false,
          'appium:newCommandTimeout': this.config.sessionTimeoutMs / 1000,
        }
      : {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:udid': udid,
          'appium:noReset': true,
          'appium:newCommandTimeout': this.config.sessionTimeoutMs / 1000,
        };

    this.logger.info({ platform, deviceId, udid }, 'Creating Appium session');

    const resp = await this.fetchFn(`${this.config.serverUrl}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilities: {
          alwaysMatch: capabilities,
        },
      }),
      signal: AbortSignal.timeout(60_000), // Session creation can be slow (installs UIA2 server)
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Appium session creation failed (${resp.status}): ${body.slice(0, 500)}`);
    }

    const data = await resp.json() as { value: { sessionId: string } };
    const sessionId = data.value.sessionId;

    this.sessions.set(deviceId, {
      sessionId,
      deviceId,
      platform,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    });

    this.logger.info({ deviceId, sessionId, platform }, 'Appium session created');
    return sessionId;
  }

  /**
   * Get the page source (UI hierarchy XML) from an active session.
   */
  async getPageSource(sessionId: string): Promise<string> {
    const resp = await this.fetchFn(
      `${this.config.serverUrl}/session/${sessionId}/source`,
      { signal: AbortSignal.timeout(30_000) },
    );

    if (!resp.ok) {
      throw new Error(`Appium getPageSource failed (${resp.status})`);
    }

    const data = await resp.json() as { value: string };
    return data.value;
  }

  /**
   * Close a specific session.
   */
  async closeSession(sessionId: string): Promise<void> {
    try {
      await this.fetchFn(`${this.config.serverUrl}/session/${sessionId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(10_000),
      });
      this.logger.info({ sessionId }, 'Appium session closed');
    } catch (err: any) {
      this.logger.warn({ sessionId, error: err.message }, 'Failed to close Appium session');
    }

    // Remove from cache
    for (const [key, cached] of this.sessions) {
      if (cached.sessionId === sessionId) {
        this.sessions.delete(key);
        break;
      }
    }
  }

  /**
   * Release session for a specific device (called when device becomes allocated for a job).
   */
  async releaseDevice(deviceId: string): Promise<void> {
    const cached = this.sessions.get(deviceId);
    if (!cached) return;

    this.logger.info({ deviceId, sessionId: cached.sessionId }, 'Releasing Appium session for device');
    await this.closeSession(cached.sessionId);
  }

  /**
   * Close all active sessions (called on server shutdown).
   */
  async closeAllSessions(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();

    await Promise.allSettled(
      sessions.map(s =>
        this.fetchFn(`${this.config.serverUrl}/session/${s.sessionId}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000),
        }).catch(() => {}),
      ),
    );

    this.logger.info({ count: sessions.length }, 'All Appium sessions closed');
  }

  /**
   * Check if Appium server is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const resp = await this.fetchFn(`${this.config.serverUrl}/status`, {
        signal: AbortSignal.timeout(3000),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get cached session count (for diagnostics).
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Evict sessions that have been idle longer than the TTL.
   */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastUsedAt > this.config.sessionTimeoutMs) {
        this.logger.info(
          { deviceId: key, sessionId: session.sessionId, idleMs: now - session.lastUsedAt },
          'Evicting expired Appium session',
        );
        this.sessions.delete(key);
        // Fire-and-forget close
        this.fetchFn(`${this.config.serverUrl}/session/${session.sessionId}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }
    }
  }
}
