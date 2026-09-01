/**
 * Shared record shapes for the token benchmark. These are the on-disk JSONL/JSON
 * contracts the capture layer writes and the metrics/report layers read, so a
 * live run and a fixture-driven test exercise identical structures.
 */
import type { CounterKind } from './tokens.js';

/** One captured `tools/call` round-trip, one line of `results/<config>.jsonl`. */
export interface CallRecord {
  /** 1-based logical scenario step this call belongs to. */
  step: number;
  /** Tool name invoked (or an argent auto-capture pseudo-tool, see `origin`). */
  tool: string;
  /** Where this call originated: the agent, or the server appending auto-capture. */
  origin: 'agent' | 'auto-screenshot' | 'auto-describe';
  /** Bytes of the JSON request arguments the agent sent. */
  requestBytes: number;
  /** Tokens of the request arguments. */
  requestTokens: number;
  /** Bytes of the raw result payload (JSON-serialized content array). */
  resultBytes: number;
  /**
   * Tokens the result adds to the transcript: text blocks counted by the token
   * counter; image blocks counted by the Anthropic image formula (NOT tiktoken
   * on base64). See `imageTokens` in metrics.
   */
  resultTokens: number;
  /** Content block types present in the result, e.g. ['text'] or ['text','image']. */
  contentTypes: string[];
  /** For image results: real decoded pixel dimensions + base64 byte size. */
  images?: ImageInfo[];
}

export interface ImageInfo {
  width: number;
  height: number;
  base64Bytes: number;
  tokens: number;
}

/** A single static always-in-context artifact (tool defs, rule, frontmatter…). */
export interface FixedArtifact {
  name: string;
  bytes: number;
  tokens: number;
  /** Freeform note: how it was captured (live tools/list, file read, source-inlined). */
  note?: string;
}

/** The full fixed context for one configuration. */
export interface FixedContext {
  configId: string;
  artifacts: FixedArtifact[];
  totalBytes: number;
  totalTokens: number;
}

/** Everything captured for one configuration — fixed context + the flow calls. */
export interface ConfigCapture {
  configId: string;
  description: string;
  counter: CounterKind;
  counterApproximate: boolean;
  /** Present when the flow was actually driven against a device. */
  live: boolean;
  /** Reason the flow is not live, if `live` is false. */
  pendingReason?: string;
  fixed: FixedContext;
  /** Empty when `live` is false. */
  calls: CallRecord[];
  /** Measured `describe`/`dsl_describe` size on the Settings root, if captured. */
  describeSize?: { bytes: number; tokens: number };
  /**
   * The describe backend the server actually used (argent's `Source:` label:
   * `open-device-server` / `android-devtools` / `uiautomator` / `ax-service`).
   * Recorded so FX can prove the open-device-server was the Android hierarchy backend.
   */
  describeSource?: string;
  capturedAt: string;
}

/** Per-configuration derived metrics computed by the pure metrics layer. */
export interface ConfigMetrics {
  configId: string;
  fixed: number;
  /** Added tokens (request + result) per logical scenario step. */
  perStep: number[];
  /** Σ perStep. */
  flowAdded: number;
  /** fixed + flowAdded (perfect prompt caching). */
  billedCached: number;
  /** Σ_t (fixed + Σ_{i≤t} added_i) — the quadratic no-caching transcript model. */
  billedUncached: number;
  /** Number of tool round-trips (agent-issued + server auto-capture calls). */
  roundTrips: number;
}
