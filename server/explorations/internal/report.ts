/**
 * Explorations report generator — Phase 35 Plan 35-06.
 *
 * Ports `_reference/app-explorer/app_explorer/report.py` (152 lines) to
 * TypeScript verbatim with device-farm domain substitutions:
 *   - app_name → bundleId + run metadata (id/platform/status/startedAt/finishedAt)
 *   - screen.screenshot path → /api/artifacts/<id>/raw URL
 *   - element fields preserved snake_case (label/element_type/explored/leads_to/notes)
 *
 * Exports:
 *   - `buildMermaid(screens, transitions)`     — port of report.py:16-32
 *   - `enumerateJourneys(screens, transitions)`— port of report.py:35-61 (DFS)
 *   - `buildReport(run, screens, transitions)` — port of report.py:64-151
 *
 * Notes:
 *   - sidSafe replaces anything outside [A-Za-z0-9_] (Python uses just `-→_`;
 *     extended here because TypeScript IDs may contain `.`/`:` etc.).
 *   - Mermaid quotes inside node labels are escaped to single-quotes (matches
 *     reference verbatim — Mermaid does not support escaped quotes inside `"…"`).
 *   - enumerateJourneys EXCLUDES back-edges from the adjacency map so the DFS
 *     surfaces only tree-edge paths (matches Plan 35-05's BFS-aware layout
 *     semantic — back-edges are not user journeys, they're loop returns).
 *   - DFS cap maxPaths=20 prevents path-explosion on cyclic graphs.
 */
import type {
  Exploration,
  ExplorationScreen,
  ExplorationTransition,
} from '../schemas.js';

/** Make a screenId safe for Mermaid node IDs (Python: replace `-`→`_`). */
export function sidSafe(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Describe a transition action as a short string for Mermaid edge labels.
 * Mirrors the reference's Python `str(t.action)` but renders structured
 * action objects more readably for the common tap/swipe/key cases.
 */
export function describeAction(action: Record<string, unknown>): string {
  const kind = action.kind;
  if (kind === 'tap') {
    const target = action.target ?? action.label;
    return typeof target === 'string' ? `tap: ${target}` : 'tap';
  }
  if (kind === 'swipe') return 'swipe';
  if (kind === 'key') {
    const code = action.code;
    return typeof code === 'string' ? `key:${code}` : 'key';
  }
  const json = JSON.stringify(action);
  return json.length > 40 ? `${json.slice(0, 40)}…` : json;
}

/**
 * Build a Mermaid `graph TD` block from screens + transitions.
 *
 * Returns empty string when no transitions (matches Python `if not m.transitions`).
 * Emits nodes in transition-visit order (first occurrence wins) so the output
 * is deterministic for a given input.
 */
export function buildMermaid(
  screens: ExplorationScreen[],
  transitions: ExplorationTransition[],
): string {
  if (transitions.length === 0) return '';

  const lines: string[] = ['```mermaid', 'graph TD'];
  const titles = new Map(screens.map((s) => [s.screenId, s.title]));
  const seen = new Set<string>();

  for (const t of transitions) {
    for (const sid of [t.fromScreenId, t.toScreenId]) {
      if (!seen.has(sid)) {
        const label = titles.get(sid) ?? sid;
        // Mermaid does not support escaped quotes inside `"…"`; coerce `"`→`'`.
        const safeLabel = label.replace(/"/g, "'");
        lines.push(`    ${sidSafe(sid)}["${safeLabel}"]`);
        seen.add(sid);
      }
    }
  }

  for (const t of transitions) {
    const action = describeAction(t.action).replace(/"/g, "'");
    lines.push(
      `    ${sidSafe(t.fromScreenId)} --> |"${action}"| ${sidSafe(t.toScreenId)}`,
    );
  }

  lines.push('```');
  return lines.join('\n');
}

/**
 * Enumerate simple paths from the first screen via DFS — port of
 * `_enumerate_paths` (report.py:35-61).
 *
 * EXCLUDES back-edges from the adjacency map (Phase 35 semantic — back-edges
 * are loop returns, not user journeys). Caps result at `maxPaths` (default 20)
 * to prevent path-explosion on cyclic graphs. A "path" is a list of screenIds
 * starting from `screens[0].screenId`.
 *
 * Reference quirk preserved: when a node has no unvisited neighbours, the
 * current path is recorded (terminal). The reference's `len(path) > 1` filter
 * is NOT applied here because the BFS root always has at least one outbound
 * tree edge in non-trivial graphs; for single-screen graphs we explicitly
 * return [] (matches the reference's `if not m.screens: return []`).
 */
export function enumerateJourneys(
  screens: ExplorationScreen[],
  transitions: ExplorationTransition[],
  maxPaths = 20,
): string[][] {
  if (screens.length === 0) return [];

  const adj = new Map<string, string[]>();
  for (const t of transitions) {
    if (t.isBackEdge) continue;
    const list = adj.get(t.fromScreenId) ?? [];
    list.push(t.toScreenId);
    adj.set(t.fromScreenId, list);
  }

  const start = screens[0].screenId;
  const paths: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (paths.length >= maxPaths) return;
    const next = adj.get(node) ?? [];
    if (next.length === 0 || next.every((n) => path.includes(n))) {
      if (path.length > 1) {
        paths.push([...path]);
      }
      return;
    }
    for (const n of next) {
      if (path.includes(n)) continue;
      path.push(n);
      dfs(n, path);
      path.pop();
    }
  }

  dfs(start, [start]);
  return paths;
}

/**
 * Build the full Markdown exploration report. Port of `generate_report`
 * (report.py:64-151) with device-farm domain substitutions.
 *
 * Returns an "empty graph" marker when no screens are present (mirrors the
 * reference's `{"error": "No screens discovered yet."}` short-circuit, but
 * returns a Markdown document so the HTTP response is still valid).
 *
 * Sections (verbatim shape from the reference output at
 * `_reference/app-explorer/reports/exploration-report.md`):
 *   1. Title (H1) + Platform/Date subtitle
 *   2. Summary table (Screens / Transitions / Elements total/explored / Coverage)
 *   3. Navigation Map (Mermaid graph TD block)
 *   4. Screen Inventory (one H3 per screen + screenshot + elements + notes)
 *   5. User Paths (DFS-enumerated, max 20, with screen titles)
 *   6. Edge Cases (table of screens with notes)
 */
export function buildReport(
  run: Exploration,
  screens: ExplorationScreen[],
  transitions: ExplorationTransition[],
): string {
  if (screens.length === 0) {
    // Mirrors reference short-circuit but emits valid Markdown so the HTTP
    // response is parseable. Operators get a helpful message + status row.
    return [
      `# App Explorer Report: ${run.bundleId}`,
      '',
      `**Platform:** ${capitalize(run.platform)} | **Run:** \`${run.id}\` | **Status:** ${run.status}`,
      '',
      '_No screens discovered yet. The exploration may still be queued, running, or it failed before saving a screen._',
      '',
    ].join('\n');
  }

  const totalElements = screens.reduce((sum, s) => sum + s.elements.length, 0);
  const exploredElements = screens.reduce(
    (sum, s) => sum + s.elements.filter((e) => e.explored).length,
    0,
  );
  const coverage = totalElements === 0 ? 0 : (exploredElements / totalElements) * 100;
  const date = formatDate(run.startedAt ?? run.createdAt);

  const lines: string[] = [
    `# App Explorer Report: ${run.bundleId}`,
    '',
    `**Platform:** ${capitalize(run.platform)} | **Date:** ${date}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Screens discovered | ${screens.length} |`,
    `| Transitions mapped | ${transitions.length} |`,
    `| Interactive elements | ${totalElements} |`,
    `| Elements explored | ${exploredElements} (${Math.round(coverage)}%) |`,
    '',
  ];

  // Navigation Map (Mermaid)
  const mermaid = buildMermaid(screens, transitions);
  if (mermaid) {
    lines.push('## Navigation Map', '', mermaid, '');
  }

  // Screen Inventory
  lines.push('## Screen Inventory', '');
  for (let i = 0; i < screens.length; i++) {
    const s = screens[i];
    lines.push(`### ${i + 1}. ${s.title} (\`${s.screenId}\`)`);
    lines.push('');
    // Screenshot URL points at the artifacts surface (Phase 21 served route).
    lines.push(`![${s.title}](/api/artifacts/${s.screenshotArtifactId}/raw)`);
    lines.push('');
    if (s.elements.length > 0) {
      lines.push('**Elements:**');
      for (const e of s.elements) {
        const dest = e.leads_to ? ` -> \`${e.leads_to}\`` : '';
        const status = e.explored ? '' : ' (unexplored)';
        const note = e.notes ? ` -- ${e.notes}` : '';
        lines.push(`- ${e.label} (${e.element_type})${dest}${status}${note}`);
      }
      lines.push('');
    }
    if (s.notes) {
      lines.push(`**Notes:** ${s.notes}`);
      lines.push('');
    }
    lines.push('---', '');
  }

  // User Paths
  const paths = enumerateJourneys(screens, transitions);
  if (paths.length > 0) {
    const titles = new Map(screens.map((s) => [s.screenId, s.title]));
    lines.push('## User Paths', '');
    for (let i = 0; i < paths.length; i++) {
      const readable = paths[i].map((sid) => titles.get(sid) ?? sid).join(' -> ');
      lines.push(`${i + 1}. ${readable}`);
    }
    lines.push('');
  }

  // Edge Cases — screens with non-empty notes.
  const edgeCases = screens.filter((s) => s.notes && s.notes.trim().length > 0);
  if (edgeCases.length > 0) {
    lines.push('## Edge Cases', '');
    lines.push('| Screen | Title | Notes |');
    lines.push('|--------|-------|-------|');
    for (const s of edgeCases) {
      lines.push(`| \`${s.screenId}\` | ${s.title} | ${s.notes} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------- Helpers ----------

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function formatDate(d: Date | null): string {
  const date = d instanceof Date ? d : new Date();
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
