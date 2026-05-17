/**
 * Phase 35 Plan 35-05 — Explorations REST client.
 *
 * Thin fetch wrappers around the Phase 35-01 + 35-05 REST surface
 * (`GET/POST/DELETE /api/explorations`, `GET /api/explorations/:id`).
 * Uses the project's typed `apiFetch` which bakes in Bearer auth via
 * the auth store + handles 401 → /login redirect.
 *
 * Schemas for the response shapes are mirrored locally so the web
 * doesn't depend on a generated OpenAPI types file (Phase 17 codegen
 * is DB-gated; the explorations contracts aren't in the published
 * generated-types.ts yet).
 */
import { apiFetch } from '$lib/api/client.js';

export type ExplorationStatus = 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
export type Platform = 'android' | 'ios';

export interface ExplorationListItem {
  id: string;
  bundleId: string;
  platform: Platform;
  status: ExplorationStatus;
  deviceId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  screensCount: number;
}

export interface ExplorationListResponse {
  explorations: ExplorationListItem[];
}

export interface ExplorationRow {
  id: string;
  deviceId: string;
  sessionId: string;
  appArtifactId: string;
  bundleId: string;
  platform: Platform;
  status: ExplorationStatus;
  startScreenId: string | null;
  budgetTaps: number;
  budgetScreens: number;
  budgetSeconds: number;
  config: Record<string, unknown>;
  stats: Record<string, unknown> | null;
  ownerApiKeyId: string | null;
  ownerActor: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface ExplorationScreenRow {
  id: string;
  runId: string;
  screenId: string;
  title: string;
  screenshotArtifactId: string;
  phash: string | null;
  elements: Array<{
    label: string;
    element_type:
      | 'button'
      | 'input'
      | 'link'
      | 'tab'
      | 'list_item'
      | 'icon'
      | 'text';
    explored: boolean;
    leads_to?: string | null;
    notes?: string | null;
  }>;
  notes: string | null;
  bfsDepth: number;
  visitedAt: string;
}

export interface ExplorationTransitionRow {
  id: string;
  runId: string;
  fromScreenId: string;
  toScreenId: string;
  action: Record<string, unknown>;
  actionHash: string;
  isBackEdge: boolean;
  bfsOrder: number;
  createdAt: string;
}

export interface ExplorationGetResponse {
  exploration: ExplorationRow;
  screens: ExplorationScreenRow[];
  transitions: ExplorationTransitionRow[];
}

export async function listExplorations(): Promise<ExplorationListResponse> {
  return apiFetch<ExplorationListResponse>('/explorations');
}

export async function getExploration(id: string): Promise<ExplorationGetResponse> {
  return apiFetch<ExplorationGetResponse>(`/explorations/${encodeURIComponent(id)}`);
}
