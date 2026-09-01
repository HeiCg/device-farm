/**
 * WS4 — Selector schema behavior lock + tools/list payload characterization.
 *
 * Two jobs:
 *  1. Pin the exact accept/reject/parsed-value behavior of the `selector`
 *     schema across a fixture table, so any future slimming (or a route-(b)
 *     attempt) that changes what the DSL tools accept fails loudly. This is
 *     the "snapshot the zod parse results" guard the spec asks for.
 *  2. Characterize the serialized `tools/list` payload for the selector-bearing
 *     tools, and prove *where* the bytes are — the reused `stringMatch` is
 *     already de-duplicated within each tool by zod-to-json-schema (id inlined,
 *     the other four fields emitted as intra-tool `$ref`s), and cross-tool
 *     `$ref` is not an option (MCP clients treat each inputSchema as
 *     standalone). See the report in measure-tools-payload.ts.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as S from '../src/dsl/schemas.js';
import {
  measureDslPayload,
  toolInputSchemaJson,
} from '../scripts/measure-tools-payload.js';

const selector = z.object(S.selector.shape);

interface Fixture {
  name: string;
  input: unknown;
  // Accepted → the exact parsed value; rejected → the field paths that fail.
  accept?: unknown;
  reject?: string[];
}

/**
 * Ground-truth table (17 cases) captured against the current schema. Covers
 * bare strings, every stringMatch object constraint, multi-constraint AND
 * (accepted today — an "exactly one of" rule would break it), unknown-key
 * stripping, and the numeric/enum rejections.
 */
const FIXTURES: Fixture[] = [
  { name: 'bare string on text', input: { text: 'Sign in' }, accept: { text: 'Sign in' } },
  { name: 'bare string on id', input: { id: 'email' }, accept: { id: 'email' } },
  { name: 'object equals', input: { text: { equals: 'Sign in' } }, accept: { text: { equals: 'Sign in' } } },
  { name: 'object contains', input: { text: { contains: 'Sign' } }, accept: { text: { contains: 'Sign' } } },
  { name: 'object regex', input: { id: { regex: '^item-\\d+$' } }, accept: { id: { regex: '^item-\\d+$' } } },
  {
    name: 'object contains + caseInsensitive',
    input: { text: { contains: 'sign', caseInsensitive: true } },
    accept: { text: { contains: 'sign', caseInsensitive: true } },
  },
  {
    name: 'multi-constraint AND (accepted today)',
    input: { text: { equals: 'a', contains: 'a' } },
    accept: { text: { equals: 'a', contains: 'a' } },
  },
  { name: 'empty selector', input: {}, accept: {} },
  { name: 'empty stringMatch object', input: { text: {} }, accept: { text: {} } },
  { name: 'index only', input: { index: 2 }, accept: { index: 2 } },
  { name: 'enabled + visible', input: { enabled: true, visible: false }, accept: { enabled: true, visible: false } },
  {
    name: 'full selector',
    input: { id: 'x', text: { contains: 'y' }, className: 'z', index: 0, enabled: true },
    accept: { id: 'x', text: { contains: 'y' }, className: 'z', index: 0, enabled: true },
  },
  { name: 'unknown key stripped', input: { text: 'a', bogus: 1 }, accept: { text: 'a' } },
  { name: 'negative index rejected', input: { index: -1 }, reject: ['index'] },
  { name: 'float index rejected', input: { index: 1.5 }, reject: ['index'] },
  { name: 'numeric stringMatch rejected', input: { text: 123 }, reject: ['text'] },
  {
    name: 'non-boolean caseInsensitive rejected',
    input: { text: { contains: 'a', caseInsensitive: 'yes' } },
    reject: ['text'],
  },
];

describe('selector schema behavior (parse-identity lock)', () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const r = selector.safeParse(f.input);
      if (f.accept !== undefined) {
        expect(r.success).toBe(true);
        // Exact parsed value — bare strings must stay bare strings, unknown
        // keys must be stripped. This is the "no behavior change" contract.
        expect((r as { data: unknown }).data).toEqual(f.accept);
      } else {
        expect(r.success).toBe(false);
        const paths = r.success
          ? []
          : r.error.issues.map((i) => i.path.join('.'));
        for (const p of f.reject ?? []) expect(paths).toContain(p);
      }
    });
  }
});

describe('tools/list payload characterization', () => {
  const SELECTOR_TOOLS = [
    'dsl_tap',
    'dsl_fill',
    'dsl_long_press',
    'dsl_element_text',
    'dsl_scroll_until_visible',
  ];

  it('the reused stringMatch is already de-duplicated within each tool', () => {
    const tap = toolInputSchemaJson(S.tapShape) as {
      properties: { selector: { properties: Record<string, { $ref?: string }> } };
    };
    const props = tap.properties.selector.properties;
    // `id` carries the inlined anyOf; the other four are intra-tool $refs to it.
    expect(props.id.$ref).toBeUndefined();
    for (const field of ['text', 'contentDescription', 'className', 'packageName']) {
      expect(props[field].$ref).toBe('#/properties/selector/properties/id');
    }
  });

  it('reports a stable per-tool + selector-family byte total', () => {
    const m = measureDslPayload();
    const measured = new Map(m.perTool.map((t) => [t.name, t.bytes]));
    for (const name of SELECTOR_TOOLS) {
      expect(measured.get(name)).toBeGreaterThan(0);
    }
    // Baseline lock: the five selector-bearing tools serialize to this size.
    // Guards against silent growth; update deliberately if the schema changes.
    expect(m.selectorToolsBytes).toBeLessThanOrEqual(5100);
    expect(m.selectorToolsBytes).toBeGreaterThan(4500);
  });

  it('quantifies why cross-tool dedup is the only >10% lever (and it is unavailable)', () => {
    const m = measureDslPayload();
    // The theoretical floor if we collapsed stringMatch to a single object
    // shape (dropping bare-string support — a behavior change we do NOT make):
    // measure the same five tools with an object-only stringMatch.
    const objOnly = z
      .object({
        equals: z.string().optional(),
        contains: z.string().optional(),
        regex: z.string().optional(),
        caseInsensitive: z.boolean().optional(),
      })
      .optional();
    const objSelector = z.object({
      id: objOnly, text: objOnly, contentDescription: objOnly,
      className: objOnly, packageName: objOnly,
      index: z.number().int().min(0).optional(),
      enabled: z.boolean().optional(), visible: z.boolean().optional(),
    });
    const objTapBytes = Buffer.byteLength(
      JSON.stringify(
        // reproduce the SDK conversion for an object-only tap
        zodToJsonSchema(z.object({ selector: objSelector }), {
          strictUnions: true,
          pipeStrategy: 'input',
        }),
      ),
      'utf8',
    );
    const unionTapBytes = Buffer.byteLength(
      JSON.stringify(toolInputSchemaJson(S.tapShape)),
      'utf8',
    );
    // Dropping the bare-string union shrinks a single tap inputSchema by well
    // under 35% — nowhere near enough to reach the spec's family target, which
    // is why WS4 cannot hit 35% without cross-tool $ref (unavailable) or a
    // behavior change (forbidden). Documented, not asserted as success.
    const perToolReduction = (unionTapBytes - objTapBytes) / unionTapBytes;
    expect(perToolReduction).toBeLessThan(0.15);
    expect(m.totalBytes).toBeGreaterThan(0);
  });
});
