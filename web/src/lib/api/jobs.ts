/**
 * Job API client functions.
 */
import { apiFetch } from './client.js';
import type { Job, PaginatedResponse, Artifact } from './types.js';

export interface ListJobsParams {
	status?: string;
	platform?: string;
	cursor?: string;
}

export async function listJobs(params?: ListJobsParams): Promise<PaginatedResponse<Job>> {
	const searchParams = new URLSearchParams();

	if (params?.status) searchParams.set('status', params.status);
	if (params?.platform) searchParams.set('platform', params.platform);
	if (params?.cursor) searchParams.set('cursor', params.cursor);

	const query = searchParams.toString();
	const path = query ? `/jobs?${query}` : '/jobs';

	return apiFetch<PaginatedResponse<Job>>(path);
}

export async function getJob(id: string): Promise<Job> {
	return apiFetch<Job>(`/jobs/${id}`);
}

export async function cancelJob(id: string): Promise<void> {
	return apiFetch<void>(`/jobs/${id}`, { method: 'DELETE' });
}

export async function getJobLogs(id: string): Promise<{ logs: string }> {
	return apiFetch<{ logs: string }>(`/jobs/${id}/logs`);
}

export async function getJobArtifacts(id: string): Promise<Artifact[]> {
	return apiFetch<Artifact[]>(`/jobs/${id}/artifacts`);
}
