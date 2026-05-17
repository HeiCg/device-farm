/**
 * WebDriverAgent HTTP Client
 * Provides iOS automation capabilities
 */

import { iosConfig } from './config';

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.log(`[WDA] Retry attempt ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Retry failed');
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  timeoutMs: number = 30000
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export interface WDASessionConfig {
  bundleId?: string;
  arguments?: string[];
  environment?: Record<string, string>;
}

export class WebDriverAgentClient {
  private baseUrl: string;
  private sessions: Map<string, string> = new Map();
  private timeout: number;

  constructor(host: string = 'localhost', port: number = iosConfig.wdaPort) {
    this.baseUrl = `http://${host}:${port}`;
    this.timeout = iosConfig.connectionTimeout;
  }

  /**
   * Check if WebDriverAgent is running
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/status`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create a new WebDriverAgent session
   */
  async createSession(udid: string, config?: WDASessionConfig): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetchWithTimeout(`${this.baseUrl}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilities: {
            alwaysMatch: {
              'appium:udid': udid,
              'appium:bundleId': config?.bundleId,
              'appium:arguments': config?.arguments || [],
              'appium:environment': config?.environment || {},
            },
          },
        }),
      }, this.timeout);

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const value = data.value as Record<string, unknown> | undefined;
      const sessionId = value?.sessionId || data.sessionId;

      if (!sessionId) {
        throw new Error('No session ID returned from WebDriverAgent');
      }

      this.sessions.set(udid, sessionId as string);
      console.log(`Created WebDriverAgent session ${sessionId} for device ${udid}`);

      return sessionId as string;
    }, 3, 1000);
  }

  /**
   * Get existing session ID for a device
   */
  getSession(udid: string): string | undefined {
    return this.sessions.get(udid);
  }

  /**
   * Delete a session
   */
  async deleteSession(udid: string): Promise<void> {
    const sessionId = this.sessions.get(udid);
    if (!sessionId) return;

    try {
      await fetch(`${this.baseUrl}/session/${sessionId}`, { method: 'DELETE' });
      this.sessions.delete(udid);
      console.log(`Deleted WebDriverAgent session ${sessionId} for device ${udid}`);
    } catch (error) {
      console.error(`Failed to delete WDA session for ${udid}:`, error);
    }
  }

  /**
   * Perform tap at coordinates
   */
  async tap(udid: string, x: number, y: number): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(`${this.baseUrl}/session/${sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: [{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
              { type: 'pointerMove', duration: 0, x, y },
              { type: 'pointerDown', button: 0 },
              { type: 'pause', duration: 100 },
              { type: 'pointerUp', button: 0 },
            ],
          }],
        }),
      }, this.timeout);

      if (!response.ok) {
        throw new Error(`Tap failed: ${response.statusText}`);
      }
    }, 3, 500);
  }

  /**
   * Type text
   */
  async typeText(udid: string, text: string): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const activeElResponse = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/element/active`,
        { method: 'GET' },
        this.timeout
      );

      if (!activeElResponse.ok) {
        throw new Error('No active element found for text input');
      }

      const activeElData = await activeElResponse.json() as Record<string, unknown>;
      const value = activeElData.value as Record<string, unknown> | undefined;
      const elementId = value?.ELEMENT || activeElData.value;

      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/element/${elementId}/value`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            value: text.split(''),
          }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Type text failed: ${response.statusText}`);
      }
    }, 3, 500);
  }

  /**
   * Press a button (home, volumeUp, volumeDown)
   */
  async pressButton(udid: string, button: 'home' | 'volumeUp' | 'volumeDown'): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/wda/pressButton`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: button }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Press button failed: ${response.statusText}`);
      }
    }, 3, 500);
  }

  /**
   * Capture screenshot
   */
  async screenshot(udid: string): Promise<Buffer> {
    const sessionId = this.getSessionOrThrow(udid);

    return retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/screenshot`,
        { method: 'GET' },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Screenshot failed: ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const base64Image = data.value as string;

      if (!base64Image) {
        throw new Error('No screenshot data returned');
      }

      return Buffer.from(base64Image, 'base64');
    }, 3, 500);
  }

  /**
   * Perform swipe gesture
   */
  async swipe(
    udid: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration: number = 300
  ): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actions: [{
              type: 'pointer',
              id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x: startX, y: startY },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerMove', duration, origin: 'viewport', x: endX, y: endY },
                { type: 'pointerUp', button: 0 },
              ],
            }],
          }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Swipe failed: ${response.statusText}`);
      }
    }, 3, 500);
  }

  /**
   * Perform scroll gesture in a direction
   */
  async scroll(
    udid: string,
    direction: 'up' | 'down' | 'left' | 'right',
    distance: number = 300,
    centerX?: number,
    centerY?: number
  ): Promise<void> {
    const startX = centerX ?? 540;
    const startY = centerY ?? 960;

    let endX = startX;
    let endY = startY;

    switch (direction) {
      case 'up':
        endY = startY - distance;
        break;
      case 'down':
        endY = startY + distance;
        break;
      case 'left':
        endX = startX - distance;
        break;
      case 'right':
        endX = startX + distance;
        break;
    }

    await this.swipe(udid, startX, startY, endX, endY, 300);
  }

  /**
   * Health check for a specific session
   */
  async healthCheck(udid: string): Promise<boolean> {
    const sessionId = this.sessions.get(udid);
    if (!sessionId) return false;

    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}`,
        { method: 'GET' },
        5000
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if WDA server is responsive
   */
  async serverHealthCheck(): Promise<boolean> {
    return this.isAvailable();
  }

  /**
   * Capture the UI hierarchy
   */
  async captureUIHierarchy(udid: string): Promise<string> {
    const sessionId = this.getSessionOrThrow(udid);

    return retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/source`,
        { method: 'GET' },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Failed to capture UI hierarchy: ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const source = data.value as string;

      if (!source) {
        throw new Error('No source data returned');
      }

      return source;
    }, 3, 500);
  }

  /**
   * Get active app information
   */
  async getActiveAppInfo(udid: string): Promise<{
    bundleId: string;
    name: string;
    pid: number;
  }> {
    const sessionId = this.getSessionOrThrow(udid);

    return retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/wda/activeAppInfo`,
        { method: 'GET' },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Failed to get active app info: ${response.statusText}`);
      }

      const data = await response.json() as Record<string, unknown>;
      const appInfo = data.value as Record<string, unknown>;

      if (!appInfo) {
        throw new Error('No app info returned');
      }

      return {
        bundleId: (appInfo.bundleId as string) || 'unknown',
        name: (appInfo.name as string) || 'Unknown',
        pid: (appInfo.pid as number) || 0,
      };
    }, 3, 500);
  }

  /**
   * Launch an app by bundle ID
   */
  async launchApp(udid: string, bundleId: string, arguments_?: string[]): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/wda/apps/launch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundleId,
            arguments: arguments_ || [],
          }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Failed to launch app: ${response.statusText}`);
      }
    }, 3, 1000);
  }

  /**
   * Terminate an app by bundle ID
   */
  async terminateApp(udid: string, bundleId: string): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/wda/apps/terminate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundleId }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Failed to terminate app: ${response.statusText}`);
      }
    }, 3, 500);
  }

  /**
   * Activate an app (bring to foreground)
   */
  async activateApp(udid: string, bundleId: string): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/wda/apps/activate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bundleId }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Failed to activate app: ${response.statusText}`);
      }
    }, 3, 500);
  }

  /**
   * Perform long press at coordinates
   */
  async longPress(udid: string, x: number, y: number, duration: number = 1000): Promise<void> {
    const sessionId = this.getSessionOrThrow(udid);

    await retryWithBackoff(async () => {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/session/${sessionId}/actions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            actions: [{
              type: 'pointer',
              id: 'finger1',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x, y },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration },
                { type: 'pointerUp', button: 0 },
              ],
            }],
          }),
        },
        this.timeout
      );

      if (!response.ok) {
        throw new Error(`Long press failed: ${response.statusText}`);
      }
    }, 3, 500);
  }

  private getSessionOrThrow(udid: string): string {
    const sessionId = this.sessions.get(udid);
    if (!sessionId) {
      throw new Error(`No active session for device ${udid}. Call createSession() first.`);
    }
    return sessionId;
  }

  /**
   * Get all active session UDIDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Set request timeout
   */
  setTimeout(ms: number): void {
    this.timeout = ms;
  }
}

// Export singleton instance
export const webDriverAgentClient = new WebDriverAgentClient();
