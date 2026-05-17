/**
 * MaestroAiResolver — deterministic XML/JSON-hierarchy heuristic.
 *
 * Phase 34 Plan 34-03 — DEFAULT resolver (SESSION_RESOLVER unset or
 * `=maestro-ai`). Pure JS (no network), runs on every fixture parse —
 * the v1 swap from the Plan 34-02 STUB_RESOLVER.
 *
 * Algorithm (per RESEARCH §MaestroAiResolver implementation plan):
 *   1. Tokenize the target string (lowercase + drop stopwords).
 *   2. For Android: parse uiautomator XML via fast-xml-parser; walk leaves
 *      with a `bounds` attribute. For iOS: parse JSON hierarchy; walk nodes
 *      with a `frame` object.
 *   3. Score every leaf on substring matches across:
 *        - text (Android) / label (iOS)
 *        - content-desc (Android) / value (iOS)
 *        - resource-id (Android) / identifier (iOS)
 *   4. Penalize `clickable=false` nodes (Android only — iOS doesn't surface
 *      this flag in the standard hierarchy dump). Boost `class=*Button*`.
 *   5. Return the centroid of the highest-scoring node's bounds. If no node
 *      scores > threshold, return `{x:0, y:0, confidence:0.3}` so the
 *      FallbackResolver in `index.ts` can decide whether to escalate to
 *      ClaudeVision.
 *
 * Confidence formula: `Math.min(0.95, 0.5 + score * 0.15)`. Each matched
 * token (across all candidate fields) adds 0.15. A single weak match returns
 * exactly 0.65; multiple field matches reach 0.95.
 *
 * NOT used: real Maestro CLI fallback. RESEARCH §MaestroAiResolver "Reality
 * check" notes that the actual maestro CLI doesn't expose a
 * one-shot-target-resolve subcommand cleanly — its --ai-prompt flag is
 * test-execution coupled. Plan 34-07 runbook documents this as DEFERRED.
 */
import { XMLParser } from 'fast-xml-parser';

import type {
  ResolveTargetRequest,
  ResolveTargetResult,
  TargetResolver,
} from './types.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'on', 'in', 'to', 'for',
  'button', 'field', 'text', 'icon', 'label', 'view',
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function parseBounds(
  s: string | undefined,
): { x1: number; y1: number; x2: number; y2: number } | null {
  if (!s) return null;
  const m = s.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
}

// ---------- Android walker ----------

interface AndroidNode {
  '@_bounds'?: string;
  '@_text'?: string;
  '@_content-desc'?: string;
  '@_resource-id'?: string;
  '@_clickable'?: string;
  '@_class'?: string;
  [k: string]: unknown;
}

function* walkAndroid(node: unknown): Generator<AndroidNode> {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walkAndroid(n);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  // A node is a candidate when it has a bounds attribute.
  if (typeof obj['@_bounds'] === 'string') yield obj as AndroidNode;
  // Recurse into all non-attribute children.
  for (const k of Object.keys(obj)) {
    if (k.startsWith('@_')) continue;
    yield* walkAndroid(obj[k]);
  }
}

function scoreAndroidNode(node: AndroidNode, tokens: string[]): number {
  // Strip the `<package>:id/` prefix from resource-id before scoring so we
  // don't get spurious package-name hits (e.g. `com.example.app` appearing
  // in every resource-id node would otherwise match target='example').
  const rawResId = (node['@_resource-id'] ?? '').toLowerCase();
  const resIdLocal = rawResId.includes(':id/')
    ? rawResId.slice(rawResId.indexOf(':id/') + ':id/'.length)
    : rawResId;
  const candidates = [
    (node['@_text'] ?? '').toLowerCase(),
    (node['@_content-desc'] ?? '').toLowerCase(),
    resIdLocal,
  ];
  let score = 0;
  for (const tok of tokens) {
    for (const c of candidates) {
      if (c.includes(tok)) score += 1;
    }
  }
  if (score === 0) return 0;
  // clickable=false → strong penalty (we want interactive elements).
  if ((node['@_clickable'] ?? 'false') !== 'true') score -= 2;
  // Class boost: prefer Buttons over generic TextViews.
  const cls = (node['@_class'] ?? '').toLowerCase();
  if (cls.includes('button')) score += 0.5;
  return score;
}

// ---------- iOS walker (best-effort JSON shape) ----------

interface IosNode {
  label?: string;
  value?: string;
  identifier?: string;
  type?: string;
  frame?: { x: number; y: number; width: number; height: number };
  children?: IosNode[];
}

function* walkIos(node: IosNode | IosNode[] | null | undefined): Generator<IosNode> {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walkIos(n);
    return;
  }
  if (node.frame) yield node;
  if (node.children) yield* walkIos(node.children);
}

function scoreIosNode(node: IosNode, tokens: string[]): number {
  const candidates = [
    (node.label ?? '').toLowerCase(),
    (node.value ?? '').toLowerCase(),
    (node.identifier ?? '').toLowerCase(),
  ];
  let score = 0;
  for (const tok of tokens) {
    for (const c of candidates) {
      if (c.includes(tok)) score += 1;
    }
  }
  if (score === 0) return 0;
  if ((node.type ?? '').toLowerCase().includes('button')) score += 0.5;
  return score;
}

// ---------- Resolver ----------

export class MaestroAiResolver implements TargetResolver {
  async resolve(req: ResolveTargetRequest): Promise<ResolveTargetResult> {
    const t0 = Date.now();
    const tokens = tokenize(req.target);
    if (tokens.length === 0) {
      return {
        x: 0,
        y: 0,
        confidence: 0,
        backend: 'maestro-ai',
        cached: false,
        latencyMs: Date.now() - t0,
      };
    }

    let bestScore = 0;
    let bestBounds: { x1: number; y1: number; x2: number; y2: number } | null = null;

    if (req.platform === 'android') {
      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
      });
      let tree: unknown;
      try {
        tree = parser.parse(req.hierarchy);
      } catch {
        return this.lowConfidence(t0);
      }
      for (const node of walkAndroid(tree)) {
        const s = scoreAndroidNode(node, tokens);
        if (s > bestScore) {
          const bounds = parseBounds(node['@_bounds']);
          if (bounds) {
            bestScore = s;
            bestBounds = bounds;
          }
        }
      }
    } else {
      // iOS: hierarchy is JSON.
      let tree: unknown;
      try {
        tree = JSON.parse(req.hierarchy);
      } catch {
        return this.lowConfidence(t0);
      }
      for (const node of walkIos(tree as IosNode | IosNode[])) {
        const s = scoreIosNode(node, tokens);
        if (s > bestScore && node.frame) {
          bestScore = s;
          bestBounds = {
            x1: node.frame.x,
            y1: node.frame.y,
            x2: node.frame.x + node.frame.width,
            y2: node.frame.y + node.frame.height,
          };
        }
      }
    }

    if (!bestBounds || bestScore < 1) {
      return this.lowConfidence(t0);
    }

    const x = Math.floor((bestBounds.x1 + bestBounds.x2) / 2);
    const y = Math.floor((bestBounds.y1 + bestBounds.y2) / 2);
    const confidence = Math.min(0.95, 0.5 + bestScore * 0.15);
    return {
      x,
      y,
      confidence,
      backend: 'maestro-ai',
      cached: false,
      latencyMs: Date.now() - t0,
    };
  }

  private lowConfidence(t0: number): ResolveTargetResult {
    return {
      x: 0,
      y: 0,
      confidence: 0.3,
      backend: 'maestro-ai',
      cached: false,
      latencyMs: Date.now() - t0,
    };
  }
}
