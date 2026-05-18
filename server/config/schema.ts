import { z } from 'zod';

const androidSchema = z.object({
  enabled: z.boolean().default(true),
  max_instances: z.number().int().min(0).default(5),
  headless: z.boolean().default(true),
  api_level: z.union([z.number(), z.string()]).transform(String).default('36.1'),
  system_image_variant: z.string().default('google_apis_playstore'),
  device_profile: z.string().default('pixel_7'),
  ram_mb: z.number().int().default(2048),
  /**
   * Phase 37 Plan 37-04 — per-job parallel-deploy cap.
   * runParallelDeploy with parallelism > this value returns 503 + Retry-After
   * (Pitfall 9 — Phase 31 port allocator has a finite pool of 3 ports per
   * Android emulator). Default 4 matches the legacy hardcoded max_instances
   * default; operators can raise for larger pools.
   */
  max_parallelism: z.number().int().min(1).max(20).default(4),
});

const iosSchema = z.object({
  enabled: z.boolean().default(true),
  max_instances: z.number().int().min(0).default(5),
  runtime: z.string().default('iOS-17-5'),
  device_type: z.string().default('iPhone-15'),
  /**
   * Phase 37 Plan 37-04 — per-job parallel-deploy cap.
   * Default 2 reflects iOS simulator's higher per-instance memory cost.
   */
  max_parallelism: z.number().int().min(1).max(20).default(2),
});

const serverSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
});

const poolSchema = z.object({
  max_devices: z.number().int().min(1).max(20).default(10),
  android: androidSchema.default(androidSchema.parse({})),
  ios: iosSchema.default(iosSchema.parse({})),
});

const artifactsSchema = z.object({
  path: z.string().default('./storage/artifacts'),
  retention_days: z.number().int().default(30),
  compress_after_days: z.number().int().default(7),
  format: z.literal('mp4').default('mp4'),
  max_storage_gb: z.number().default(50),
});

const logsSchema = z.object({
  retention_days: z.number().int().default(90),
  path: z.string().default('./storage/logs'),
});

const storageSchema = z.object({
  artifacts: artifactsSchema.default(artifactsSchema.parse({})),
  logs: logsSchema.default(logsSchema.parse({})),
});

const jobsSchema = z.object({
  timeout_minutes: z.number().int().default(30),
  max_queue_size: z.number().int().default(100),
  cleanup_completed_after_days: z.number().int().default(7),
});

const jobMetadataSchemaSchema = z.object({
  required: z.array(z.string()).default([]),
  optional: z.array(z.object({
    name: z.string(),
    type: z.string(),
  })).default([]),
});

const authSchema = z.object({
  enabled: z.boolean().default(false),
});

const securitySchema = z.object({
  share_token_secret: z.string().min(32).optional(),
});

const sharingSchema = z.object({
  enabled: z.boolean().default(false),
  default_ttl_days: z.union([z.literal(5), z.literal(15), z.literal(30)]).default(30),
});

const webhooksSchema = z.object({
  url: z.string().url().optional(),
  secret: z.string().optional(),
  timeout_ms: z.number().int().default(10000),
  max_retries: z.number().int().default(3),
});

const hookSchema = z.object({
  name: z.string().min(1),
  event: z.enum(['device.booted', 'device.shutdown', 'test.before', 'test.after']),
  command: z.string().min(1),
  platform: z.enum(['android', 'ios', 'all']).default('all'),
  timeoutMs: z.number().int().default(30000),
  failOnError: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

/**
 * Per-job emulator boot options (Phase 31 / Plan 31-03 / SC3).
 *
 * Defaults preserve current emulator behavior:
 *   - coldBoot:false → warm boot from snapshot when available
 *   - noAudio:true   → current hardcoded `-no-audio` argv preserved
 *   - gpu:'swiftshader_indirect' → current hardcoded `-gpu` value
 *
 * Validated at three boundaries (SPEC-04 row-decoder pattern):
 *   1. Multipart `boot_options` field at POST /api/jobs (server/api/routes.ts)
 *   2. DB read of jobs.metadata.boot_options (server/jobs/internal/executor.ts)
 *   3. CLI emission helper (cli/internal/client/submit.go) — Go side, mirrored
 */
export const bootOptionsSchema = z.object({
  coldBoot: z.boolean().default(false),
  noAudio: z.boolean().default(true),
  gpu: z.enum(['swiftshader_indirect', 'host', 'auto']).default('swiftshader_indirect'),
});

export type BootOptionsInput = z.infer<typeof bootOptionsSchema>;

const maestroSchema = z.object({
  /** Include tags for test filtering (--include-tags) */
  include_tags: z.array(z.string()).default([]),
  /** Exclude tags for test filtering (--exclude-tags) */
  exclude_tags: z.array(z.string()).default([]),
  /** Report format: JUNIT, HTML, or NOOP (default: JUNIT) */
  report_format: z.enum(['JUNIT', 'HTML', 'NOOP']).default('JUNIT'),
  /** Enable debug output collection (screenshots, logs per step) */
  debug_output: z.boolean().default(true),
  /** Number of parallel shards (0 = no sharding) */
  shards: z.number().int().min(0).default(0),
  /** Port where device-stream android-server is running */
  android_server_port: z.number().int().default(9008),
  /** Port where WDA is running for iOS */
  wda_port: z.number().int().default(8100),
});

const azureWebhookBasicAuthSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const azurePrIntegrationSchema = z.object({
  id: z.string().min(1),
  repo_url: z.string().url(),
  target_branch: z.string().default('main'),
});

const azureDevOpsSchema = z.object({
  pat: z.string().min(1),
  webhook_basic_auth: azureWebhookBasicAuthSchema,
  pr_integrations: z.array(azurePrIntegrationSchema).default([]),
});

// Phase 37 Plan 37-03 Track C — GitHub App integration config.
// Per Pitfall 4 / Pitfall 8 in 37-RESEARCH.md: store installation_id (NOT
// integration_id) — GitHub Apps are provisioned per-installation, and
// @octokit/auth-app handles install-token TTL + caching transparently.
const githubPrIntegrationSchema = z.object({
  repo_owner: z.string().min(1),
  repo_name: z.string().min(1),
  installation_id: z.number().int().positive(),
  pipeline_name: z.string().min(1),
});

const githubSchema = z.object({
  app_id: z.number().int().positive(),
  private_key: z.string().min(1), // PEM string
  webhook_secret: z.string().min(1),
  pr_integrations: z.array(githubPrIntegrationSchema).default([]),
});

const pipelinesConfigSchema = z.object({
  max_concurrent_runs: z.number().int().min(1).max(20).default(2),
});

export const configSchema = z.object({
  server: serverSchema.default(serverSchema.parse({})),
  pool: poolSchema.default(poolSchema.parse({})),
  storage: storageSchema.default(storageSchema.parse({})),
  jobs: jobsSchema.default(jobsSchema.parse({})),
  job_metadata_schema: jobMetadataSchemaSchema.default(jobMetadataSchemaSchema.parse({})),
  database_url: z.string().default('postgresql://localhost:5432/device_farm'),
  auth: authSchema.default(authSchema.parse({})),
  security: securitySchema.default(securitySchema.parse({})),
  sharing: sharingSchema.default(sharingSchema.parse({})),
  ui: z.object({ use_report_shell: z.boolean().default(false) }).default({ use_report_shell: false }),
  webhooks: webhooksSchema.default(webhooksSchema.parse({})),
  hooks: z.array(hookSchema).default([]),
  maestro: maestroSchema.default(maestroSchema.parse({})),
  appium: z.object({
    server_url: z.string().default('http://localhost:4723'),
    session_timeout_ms: z.number().int().min(30_000).default(300_000),
  }).default({ server_url: 'http://localhost:4723', session_timeout_ms: 300_000 }),
  azure_devops: azureDevOpsSchema.optional(),
  // Phase 37 Plan 37-03 — GitHub App PR integration (optional).
  github: githubSchema.optional(),
  pipelines: pipelinesConfigSchema.default(pipelinesConfigSchema.parse({})),
}).refine(
  (cfg) => !cfg.sharing.enabled || (cfg.security.share_token_secret !== undefined && cfg.security.share_token_secret.length >= 32),
  { message: 'security.share_token_secret is required (min 32 chars) when sharing.enabled = true' },
);

export type AppConfig = z.infer<typeof configSchema>;
