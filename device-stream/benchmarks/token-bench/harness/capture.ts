/**
 * Turn an MCP `tools/call` result (a content-block array) into a `CallRecord`.
 *
 * Text blocks are counted with the active token counter. Image blocks are counted
 * with the Anthropic image formula against the PNG's real decoded dimensions — the
 * base64 byte size is recorded separately (it is what crosses the wire, but is NOT
 * what the model is billed for the pixels). This split is the whole reason image
 * accounting is done here and not by running tiktoken over the base64 string.
 */
import type { TokenCounter } from './tokens.js';
import type { CallRecord, ImageInfo } from './types.js';
import { imageTokens, pngSizeFromBase64 } from './png.js';

/** An MCP content block as returned by a tool result. */
export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string; // base64 for image blocks
  mimeType?: string;
}

export interface McpToolResult {
  content: McpContentBlock[];
  isError?: boolean;
}

export interface CaptureCallInput {
  step: number;
  tool: string;
  origin: CallRecord['origin'];
  /** The request arguments the agent sent, as they were serialized on the wire. */
  requestArgs: unknown;
  result: McpToolResult;
}

/** Serialize request args the same way the transport does, to size them. */
export function serializeArgs(args: unknown): string {
  if (args === undefined || args === null) return '{}';
  return JSON.stringify(args);
}

/** Count the tokens an image block adds, plus record its dimensions/bytes. */
export function imageInfo(b64: string): ImageInfo {
  const base64Bytes = b64.length;
  const size = pngSizeFromBase64(b64);
  if (!size) {
    // Not a decodable PNG: fall back to a byte-based estimate so we never
    // silently drop the cost. Documented in the report as a fallback path.
    return { width: 0, height: 0, base64Bytes, tokens: Math.ceil(base64Bytes / 4 / 750) };
  }
  return { width: size.width, height: size.height, base64Bytes, tokens: imageTokens(size) };
}

/**
 * Build a `CallRecord` from a captured call. Async because the text token counter
 * may be a network call (Anthropic count_tokens).
 */
export async function captureCall(
  input: CaptureCallInput,
  counter: TokenCounter,
): Promise<CallRecord> {
  const argsStr = serializeArgs(input.requestArgs);
  const requestBytes = Buffer.byteLength(argsStr, 'utf8');
  const requestTokens = await counter.countText(argsStr);

  const resultStr = JSON.stringify(input.result.content ?? []);
  const resultBytes = Buffer.byteLength(resultStr, 'utf8');

  const contentTypes: string[] = [];
  const images: ImageInfo[] = [];
  let resultTokens = 0;

  for (const block of input.result.content ?? []) {
    contentTypes.push(block.type);
    if (block.type === 'image' && typeof block.data === 'string') {
      const info = imageInfo(block.data);
      images.push(info);
      resultTokens += info.tokens;
    } else if (typeof block.text === 'string') {
      resultTokens += await counter.countText(block.text);
    }
  }

  return {
    step: input.step,
    tool: input.tool,
    origin: input.origin,
    requestBytes,
    requestTokens,
    resultBytes,
    resultTokens,
    contentTypes,
    ...(images.length > 0 ? { images } : {}),
  };
}

/** Count a plain text artifact (tool defs, rule, frontmatter) into bytes+tokens. */
export async function measureText(
  text: string,
  counter: TokenCounter,
): Promise<{ bytes: number; tokens: number }> {
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    tokens: await counter.countText(text),
  };
}
