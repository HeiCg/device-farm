import { z } from 'zod';

export const triggerSchema = z.union([
  z.literal('api').transform(() => ({ type: 'api' as const })),
  z.object({ schedule: z.string() })
    .transform(v => ({ type: 'schedule' as const, cron: v.schedule })),
  z.object({ azure_pr: z.object({ repo_id: z.string().min(1) }) })
    .transform(v => ({ type: 'azure-pr' as const, repoId: v.azure_pr.repo_id })),
]);

export const stageSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum([
    'script',
    'maestro',
    'device-stream-script',
    'internal-clone',
    'internal-release',
  ]).default('script'),
  script: z.string().optional(),
  script_path: z.string().optional(),
  timeout: z.number().int().min(1).max(3600).default(300),
  when: z.enum(['success', 'failure', 'always']).default('success'),
  platform: z.enum(['android', 'ios']).optional(),
  flows: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  matrix: z.array(z.record(z.unknown())).optional(),
});

export const sourceSchema = z.object({
  provider: z.enum(['azure_devops']).default('azure_devops'),
  repo: z.string().url(),
  branch: z.string().default('main'),
  pat_secret: z.string().optional(),
});

export const notifyAzureSchema = z.object({
  comment: z.boolean().default(false),
});

export const notifyWebhookSchema = z.object({
  url: z.string().url(),
});

export const notifySchema = z.object({
  azure_devops: notifyAzureSchema.optional(),
  webhook: notifyWebhookSchema.optional(),
});

export const pipelineDefSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  trigger: z.array(triggerSchema).default([{ type: 'api' }]),
  source: sourceSchema.optional(),
  variables: z.record(z.string(), z.string()).optional(),
  stages: z.array(stageSchema).min(1),
  notify: notifySchema.optional(),
});

export type PipelineDef = z.infer<typeof pipelineDefSchema>;
export type StageDef = z.infer<typeof stageSchema>;
export type TriggerDef = z.infer<typeof triggerSchema>;
