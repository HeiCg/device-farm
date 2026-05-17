import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppiumService } from '../internal/appium-service.js';

function createMockLogger() {
  return {
    child: () => createMockLogger(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
}

describe('AppiumService', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let service: AppiumService;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockFetch = vi.fn();
    logger = createMockLogger();
    service = new AppiumService(logger, {
      serverUrl: 'http://localhost:4723',
      sessionTimeoutMs: 5000, // 5s for fast test TTL
    }, mockFetch as any);
  });

  describe('createSession (via getOrCreateSession)', () => {
    it('creates Android session with UiAutomator2 capabilities', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-android-1' } }),
      });

      const sessionId = await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');

      expect(sessionId).toBe('sess-android-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:4723/session',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('UiAutomator2'),
        }),
      );

      // Verify capabilities in the body
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.capabilities.alwaysMatch.platformName).toBe('Android');
      expect(body.capabilities.alwaysMatch['appium:automationName']).toBe('UiAutomator2');
      expect(body.capabilities.alwaysMatch['appium:udid']).toBe('emulator-5554');
    });

    it('creates iOS session with XCUITest capabilities', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-ios-1' } }),
      });

      const sessionId = await service.getOrCreateSession('ios', 'dev-2', 'UDID-123');

      expect(sessionId).toBe('sess-ios-1');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.capabilities.alwaysMatch.platformName).toBe('iOS');
      expect(body.capabilities.alwaysMatch['appium:automationName']).toBe('XCUITest');
      expect(body.capabilities.alwaysMatch['appium:udid']).toBe('UDID-123');
    });

    it('throws on session creation failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        service.getOrCreateSession('android', 'dev-1', 'emulator-5554'),
      ).rejects.toThrow('Appium session creation failed (500)');
    });
  });

  describe('session reuse', () => {
    it('reuses cached session when not expired', async () => {
      // First call: create session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-1' } }),
      });

      const first = await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');
      expect(first).toBe('sess-1');

      // Second call: validate + reuse
      mockFetch.mockResolvedValueOnce({ ok: true }); // session validation

      const second = await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');
      expect(second).toBe('sess-1');
      expect(mockFetch).toHaveBeenCalledTimes(2); // create + validate (no second create)
    });

    it('creates new session when cached one is dead', async () => {
      // Create session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-old' } }),
      });
      await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');

      // Validation fails → session is dead
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      // New session created
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-new' } }),
      });

      const result = await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');
      expect(result).toBe('sess-new');
    });
  });

  describe('TTL expiry', () => {
    it('evicts expired session and creates new one', async () => {
      // Create session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-expired' } }),
      });
      await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');

      // Advance time beyond TTL (5s)
      vi.useFakeTimers();
      vi.advanceTimersByTime(6000);

      // Eviction fires DELETE (fire-and-forget)
      mockFetch.mockResolvedValueOnce({ ok: true }); // DELETE expired session
      // New session
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-fresh' } }),
      });

      const result = await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');
      expect(result).toBe('sess-fresh');

      vi.useRealTimers();
    });
  });

  describe('getPageSource', () => {
    it('returns XML page source', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: '<hierarchy rotation="0"><node class="View"/></hierarchy>' }),
      });

      const source = await service.getPageSource('sess-1');
      expect(source).toContain('<hierarchy');
    });

    it('throws on failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await expect(service.getPageSource('sess-1')).rejects.toThrow('Appium getPageSource failed (500)');
    });
  });

  describe('closeSession', () => {
    it('sends DELETE and removes from cache', async () => {
      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-close' } }),
      });
      await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');
      expect(service.getSessionCount()).toBe(1);

      // Close
      mockFetch.mockResolvedValueOnce({ ok: true });
      await service.closeSession('sess-close');
      expect(service.getSessionCount()).toBe(0);
    });
  });

  describe('releaseDevice', () => {
    it('closes session for a specific device', async () => {
      // Create
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-release' } }),
      });
      await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');

      // Release
      mockFetch.mockResolvedValueOnce({ ok: true }); // DELETE
      await service.releaseDevice('dev-1');
      expect(service.getSessionCount()).toBe(0);
    });

    it('no-ops when device has no session', async () => {
      await service.releaseDevice('nonexistent');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('closeAllSessions', () => {
    it('closes all cached sessions', async () => {
      // Create 2 sessions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-a' } }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: { sessionId: 'sess-b' } }),
      });

      await service.getOrCreateSession('android', 'dev-1', 'emulator-5554');
      await service.getOrCreateSession('ios', 'dev-2', 'UDID-456');
      expect(service.getSessionCount()).toBe(2);

      // Close all
      mockFetch.mockResolvedValue({ ok: true });
      await service.closeAllSessions();
      expect(service.getSessionCount()).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('returns true when server responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      expect(await service.isAvailable()).toBe(true);
    });

    it('returns false when server is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      expect(await service.isAvailable()).toBe(false);
    });
  });
});
