import YAML from 'yaml';
import { pipelineDefSchema, type PipelineDef } from './pipeline-schema.js';

export type ParseResult =
  | { success: true; data: PipelineDef }
  | { success: false; error: string };

export function parsePipeline(yamlString: string): ParseResult {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlString);
  } catch (err: any) {
    return { success: false, error: `Invalid YAML: ${err.message}` };
  }

  const result = pipelineDefSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { success: false, error: detail };
  }

  return { success: true, data: result.data };
}
