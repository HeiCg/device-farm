/**
 * Phase 35 Plan 35-05 — Atlas type model.
 *
 * Port of `_reference/app-explorer/frontend/src/components/types.ts`
 * extended with the fields Phase 35 server schemas expose
 * (`bfs_depth`, `is_back_edge`, `bfs_order`, `notes`, `leads_to`,
 * `screenshot_artifact_id`).
 *
 * We deliberately preserve snake_case INSIDE the `web/explorations/`
 * subtree to keep the React→Svelte port verbatim. The server returns
 * camelCase rows (see `server/explorations/schemas.ts`); the page
 * loader maps once at the boundary (see `routes/explorations/[id]/+page.svelte`).
 */

export type ElementType =
  | 'button'
  | 'input'
  | 'link'
  | 'tab'
  | 'list_item'
  | 'icon'
  | 'text';

export interface Element {
  label: string;
  element_type: ElementType;
  explored: boolean;
  leads_to?: string | null;
  notes?: string | null;
}

export interface Screen {
  screen_id: string;
  title: string;
  /**
   * Screenshot artifact id (UUID). Renderers compose the URL via
   * `${screenshotBase}/${screenshot_artifact_id}/raw`.
   */
  screenshot_artifact_id: string;
  elements: Element[];
  notes?: string | null;
  bfs_depth: number;
}

export interface Transition {
  from_screen_id: string;
  to_screen_id: string;
  /**
   * Server-side action envelope. Shape is intentionally loose
   * (`{ kind?: 'tap'|'swipe'|'key', target?, code?, ... }`) — the
   * `describeAction()` helper inside `layout-graph.ts` does the
   * narrowing for UI display.
   */
  action: Record<string, unknown>;
  is_back_edge: boolean;
  /** Monotonic insertion order from the agent runner (Phase 35 Plan 35-02). */
  bfs_order: number;
}

export interface ScreenMap {
  run_id: string;
  app_name: string;
  platform: 'android' | 'ios';
  screens: Screen[];
  transitions: Transition[];
}
