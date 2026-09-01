/**
 * measure-tools-payload — benchmark tooling for the DSL MCP tool family.
 *
 * Prints the serialized `tools/list` byte size for the DSL tools, reproducing
 * the exact JSON Schema the MCP SDK emits for each tool's `inputSchema`
 * (`zodToJsonSchema(z.object(shape), { strictUnions: true, pipeStrategy: 'input' })`,
 * see @modelcontextprotocol/sdk server/zod-json-schema-compat).
 *
 * Run: npx tsx mcp/scripts/measure-tools-payload.ts
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod/v3';
import { buildDslToolRegistry } from '../src/dsl/registry.js';

/** Tools whose input carries a `selector` — the ones WS4 dedup targets. */
const SELECTOR_TOOLS = new Set([
  'dsl_tap',
  'dsl_fill',
  'dsl_long_press',
  'dsl_element_text',
  'dsl_scroll_until_visible',
]);

/** Reproduce the SDK's inputSchema JSON for one tool's raw zod shape. */
export function toolInputSchemaJson(shape: Record<string, unknown>): unknown {
  return zodToJsonSchema(z.object(shape as Record<string, z.ZodTypeAny>), {
    strictUnions: true,
    pipeStrategy: 'input',
  });
}

/** The `tools/list` wire entry for a tool: name + description + inputSchema. */
export function toolListEntry(tool: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toolInputSchemaJson(tool.inputSchema),
  };
}

export interface PayloadMeasurement {
  perTool: { name: string; bytes: number; selector: boolean }[];
  totalBytes: number;
  selectorToolsBytes: number;
}

export function measureDslPayload(): PayloadMeasurement {
  const tools = buildDslToolRegistry();
  const perTool = tools.map((t) => {
    const bytes = Buffer.byteLength(JSON.stringify(toolListEntry(t)), 'utf8');
    return { name: t.name, bytes, selector: SELECTOR_TOOLS.has(t.name) };
  });
  return {
    perTool,
    totalBytes: perTool.reduce((n, t) => n + t.bytes, 0),
    selectorToolsBytes: perTool
      .filter((t) => t.selector)
      .reduce((n, t) => n + t.bytes, 0),
  };
}

function main(): void {
  const m = measureDslPayload();
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log('DSL tools/list payload (serialized bytes per tool)\n');
  for (const t of m.perTool) {
    console.log(
      `  ${pad(t.name, 26)} ${String(t.bytes).padStart(6)}${t.selector ? '  [selector]' : ''}`,
    );
  }
  console.log('');
  console.log(`  total DSL tools (${m.perTool.length}):        ${m.totalBytes} bytes`);
  console.log(
    `  selector-bearing tools (5):    ${m.selectorToolsBytes} bytes`,
  );
}

// Run only when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
