/**
 * Maestro / hierarchy API client.
 *
 * All fetch-based calls go through apiFetch for auth headers and RFC 7807
 * error handling. Screenshot URL is returned as a direct string since the
 * browser loads it as an <img src> (binary PNG, not JSON).
 */
import { apiFetch } from './client.js';
import type { HierarchySource, HierarchyResult, QueryResult } from './types.js';

/**
 * Fetch the UI hierarchy tree for a device.
 *
 * @param deviceId  Device identifier
 * @param source    Optional strategy override: 'maestro-cli' | 'device-server' | 'native'
 */
export function fetchHierarchy(
	deviceId: string,
	source?: HierarchySource
): Promise<HierarchyResult> {
	const path = `/devices/${deviceId}/hierarchy${source ? `?source=${source}` : ''}`;
	return apiFetch<HierarchyResult>(path);
}

/**
 * Build a direct screenshot URL for use as an `<img src>`.
 *
 * Returns an absolute path (not fetched through apiFetch) with a cache-buster
 * query parameter so the browser always requests a fresh image.
 */
export function getScreenshotUrl(deviceId: string): string {
	return `/api/devices/${deviceId}/screenshot?t=${Date.now()}`;
}

/**
 * Fetch combined device state (screenshot + hierarchy + info).
 *
 * Used for potential single-fetch optimization on the inspector page.
 */
export function fetchDeviceState(deviceId: string): Promise<any> {
	return apiFetch(`/devices/${deviceId}/state`);
}

/**
 * Query elements matching a text or id pattern on the device's current UI.
 *
 * @param deviceId  Device identifier
 * @param query     Search criteria — at least one of `text` or `id`
 */
export function queryElements(
	deviceId: string,
	query: { text?: string; id?: string }
): Promise<QueryResult> {
	const params = new URLSearchParams();
	if (query.text) params.set('text', query.text);
	if (query.id) params.set('id', query.id);
	const qs = params.toString();
	return apiFetch<QueryResult>(`/devices/${deviceId}/query${qs ? `?${qs}` : ''}`);
}
