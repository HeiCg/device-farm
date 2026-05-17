import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'js-yaml';
import { loadConfig } from '../loader.js';
import { configSchema, type AppConfig } from '../schema.js';

function writeTempYaml(data: Record<string, unknown>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-farm-test-'));
  const filePath = path.join(tmpDir, 'config.yaml');
  fs.writeFileSync(filePath, yaml.dump(data), 'utf-8');
  return filePath;
}

function cleanupTempFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
    fs.rmdirSync(path.dirname(filePath));
  } catch {
    // ignore cleanup errors
  }
}

describe('Config Loader', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.DEVICE_FARM_PORT;
    delete process.env.DEVICE_FARM_CONFIG;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it('returns typed AppConfig with all defaults when given valid YAML', () => {
    const configPath = writeTempYaml({
      pool: {
        max_devices: 4,
      },
    });

    try {
      const config = loadConfig(configPath);
      expect(config.server.port).toBe(3000);
      expect(config.server.host).toBe('0.0.0.0');
      expect(config.pool.max_devices).toBe(4);
      expect(config.pool.android.enabled).toBe(true);
      expect(config.pool.android.api_level).toBe('36.1');
      expect(config.pool.ios.enabled).toBe(true);
      expect(config.storage.artifacts.path).toBe('./storage/artifacts');
      expect(config.storage.logs.retention_days).toBe(90);
      expect(config.jobs.timeout_minutes).toBe(30);
      expect(config.jobs.max_queue_size).toBe(100);
    } finally {
      cleanupTempFile(configPath);
    }
  });

  it('throws Error with formatted field paths for invalid YAML', () => {
    const configPath = writeTempYaml({
      server: { port: 'not-a-number' },
      pool: { max_devices: -5 },
    });

    try {
      expect(() => loadConfig(configPath)).toThrow('Invalid configuration');
      try {
        loadConfig(configPath);
      } catch (err: any) {
        expect(err.message).toContain('server.port');
      }
    } finally {
      cleanupTempFile(configPath);
    }
  });

  it('returns defaults when config file is missing', () => {
    const config = loadConfig('/tmp/nonexistent-config-file-12345.yaml');
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe('0.0.0.0');
    expect(config.pool.android.enabled).toBe(true);
    expect(config.pool.ios.enabled).toBe(true);
  });

  it('DEVICE_FARM_PORT env var overrides server.port from YAML', () => {
    const configPath = writeTempYaml({
      server: { port: 3000 },
      pool: { max_devices: 2 },
    });

    try {
      process.env.DEVICE_FARM_PORT = '9999';
      const config = loadConfig(configPath);
      expect(config.server.port).toBe(9999);
    } finally {
      cleanupTempFile(configPath);
    }
  });

  it('DEVICE_FARM_CONFIG env var changes the config file path', () => {
    const configPath = writeTempYaml({
      server: { port: 7777 },
      pool: { max_devices: 1 },
    });

    try {
      process.env.DEVICE_FARM_CONFIG = configPath;
      const config = loadConfig();
      expect(config.server.port).toBe(7777);
    } finally {
      cleanupTempFile(configPath);
    }
  });

  it('DATABASE_URL env var is available on the config object', () => {
    const configPath = writeTempYaml({
      pool: { max_devices: 1 },
    });

    try {
      process.env.DATABASE_URL = 'postgresql://custom:5432/mydb';
      const config = loadConfig(configPath);
      expect(config.database_url).toBe('postgresql://custom:5432/mydb');
    } finally {
      cleanupTempFile(configPath);
    }
  });

  it('Zod schema matches config.yaml structure from implementation-plan.md', () => {
    const fullConfig = {
      server: { port: 3000, host: '0.0.0.0' },
      pool: {
        max_devices: 10,
        android: {
          enabled: true,
          max_instances: 5,
          headless: true,
          api_level: '34',
          system_image_variant: 'google_apis',
          device_profile: 'pixel_7',
          ram_mb: 2048,
        },
        ios: {
          enabled: true,
          max_instances: 5,
          runtime: 'iOS-17-5',
          device_type: 'iPhone-15',
        },
      },
      storage: {
        artifacts: {
          path: './storage/artifacts',
          retention_days: 30,
          compress_after_days: 7,
          format: 'mp4',
          max_storage_gb: 50,
        },
        logs: {
          retention_days: 90,
          path: './storage/logs',
        },
      },
      jobs: {
        timeout_minutes: 30,
        max_queue_size: 100,
        cleanup_completed_after_days: 7,
      },
      job_metadata_schema: {
        required: [],
        optional: [
          { name: 'branch', type: 'string' },
          { name: 'commit_sha', type: 'string' },
        ],
      },
    };

    const configPath = writeTempYaml(fullConfig);

    try {
      const config = loadConfig(configPath);
      expect(config.server.port).toBe(3000);
      expect(config.pool.android.device_profile).toBe('pixel_7');
      expect(config.pool.ios.device_type).toBe('iPhone-15');
      expect(config.storage.artifacts.format).toBe('mp4');
      expect(config.jobs.cleanup_completed_after_days).toBe(7);
      expect(config.job_metadata_schema.optional).toHaveLength(2);
    } finally {
      cleanupTempFile(configPath);
    }
  });
});
