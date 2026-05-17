/**
 * iOS Device Configuration
 * External configuration with environment variable overrides
 */

/**
 * Parse environment variable as integer with fallback
 */
function parseIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value) {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/**
 * Parse environment variable as string with fallback
 */
function parseStringEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * iOS configuration with environment variable overrides
 */
export const iosConfig = {
  /**
   * WebDriverAgent port for automation commands
   */
  wdaPort: parseIntEnv('WDA_PORT', 8100),

  /**
   * MJPEG stream port for video capture
   */
  mjpegPort: parseIntEnv('MJPEG_PORT', 9100),

  /**
   * WebDriverAgent bundle ID
   */
  wdaBundleId: parseStringEnv('WDA_BUNDLE_ID', 'com.facebook.WebDriverAgentRunner.xctrunner'),

  /**
   * Connection timeout in milliseconds
   */
  connectionTimeout: parseIntEnv('IOS_TIMEOUT', 30000),

  /**
   * Session creation retry attempts
   */
  sessionRetries: parseIntEnv('WDA_SESSION_RETRIES', 3),

  /**
   * Health check interval in milliseconds
   */
  healthCheckInterval: parseIntEnv('IOS_HEALTH_CHECK_INTERVAL', 30000),

  /**
   * Whether to use MJPEG streaming (true) or QuickTime fallback (false)
   */
  preferMjpegStreaming: process.env.IOS_PREFER_MJPEG !== 'false',

  /**
   * Maximum processes per device (WDA + port forwards)
   */
  maxProcessesPerDevice: parseIntEnv('IOS_MAX_PROCESSES', 5),

  /**
   * Process cleanup timeout in milliseconds
   */
  cleanupTimeout: parseIntEnv('IOS_CLEANUP_TIMEOUT', 5000),
} as const;

export type IOSConfig = typeof iosConfig;
