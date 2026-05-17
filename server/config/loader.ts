import fs from 'node:fs';
import yaml from 'js-yaml';
import { configSchema, type AppConfig } from './schema.js';

export function loadConfig(configPath?: string): AppConfig {
  const filePath = process.env.DEVICE_FARM_CONFIG ?? configPath ?? './config.yaml';

  let raw: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content);
    if (parsed && typeof parsed === 'object') {
      raw = parsed as Record<string, unknown>;
    }
  }

  // Env var overrides (priority: env > YAML > defaults)
  if (process.env.DEVICE_FARM_PORT) {
    const server = (raw.server ?? {}) as Record<string, unknown>;
    server.port = Number(process.env.DEVICE_FARM_PORT);
    raw.server = server;
  }
  if (process.env.DATABASE_URL) {
    raw.database_url = process.env.DATABASE_URL;
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${formatted}`);
  }

  return result.data;
}
