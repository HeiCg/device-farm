/**
 * Health API client.
 */
import { apiFetch } from './client.js';
import type { HealthResponse } from './types.js';

export async function getHealth(): Promise<HealthResponse> {
	return apiFetch<HealthResponse>('/health');
}
