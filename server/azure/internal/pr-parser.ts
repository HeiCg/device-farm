import { z } from 'zod';
import { parse as parseYaml } from 'yaml';

const FENCE_RE = /```device-script\s*\n([\s\S]*?)\n```/g;

export const prBlockSchema = z.object({
  url: z.string().url(),
  account: z.string().min(1).max(128),
  platform: z.enum(['android', 'ios']),
  suite: z.string()
    .min(1)
    .transform(s => s.split(',').map(x => x.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1)),
});

export type PrBlock = z.infer<typeof prBlockSchema>;

export type ParseResult =
  | { kind: 'no-block' }
  | { kind: 'multiple-blocks'; count: number }
  | { kind: 'parse-error'; message: string }
  | { kind: 'validation-error'; issues: Array<{ path: string; message: string }> }
  | { kind: 'ok'; block: PrBlock };

export function parsePrDescription(description: string): ParseResult {
  const matches = [...description.matchAll(FENCE_RE)];

  if (matches.length === 0) return { kind: 'no-block' };
  if (matches.length > 1) return { kind: 'multiple-blocks', count: matches.length };

  const inner = matches[0][1];
  let raw: unknown;
  try {
    raw = parseYaml(inner);
  } catch (err) {
    return { kind: 'parse-error', message: (err as Error).message };
  }

  const result = prBlockSchema.safeParse(raw);
  if (!result.success) {
    return {
      kind: 'validation-error',
      issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  return { kind: 'ok', block: result.data };
}
