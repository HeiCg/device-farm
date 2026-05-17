/**
 * Pipeline API client functions.
 */
import { apiFetch } from './client.js';

export interface Pipeline {
	id: string;
	name: string;
	description: string | null;
	yamlContent: string;
	createdAt: string;
	updatedAt: string;
}

export interface PipelineRun {
	id: string;
	pipelineId: string;
	triggerType: 'api' | 'schedule' | 'manual';
	status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled';
	variables: Record<string, string> | null;
	startedAt: string | null;
	finishedAt: string | null;
	sourceBranch: string | null;
	sourceCommit: string | null;
	azurePrId: string | null;
	azurePrUrl: string | null;
	errorMessage: string | null;
	stages?: PipelineStageRun[];
}

export interface PipelineStageRun {
	id: string;
	runId: string;
	stageName: string;
	stageIndex: number;
	type: 'script' | 'maestro';
	status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
	startedAt: string | null;
	finishedAt: string | null;
	logs: string | null;
	errorMessage: string | null;
}

export interface PipelineSchedule {
	id: string;
	pipelineId: string;
	cronExpression: string;
	enabled: boolean;
	variables: Record<string, string> | null;
	lastRunAt: string | null;
	nextRunAt: string | null;
}

export interface Secret {
	name: string;
	createdAt: string;
}

export interface TriggerRunResponse {
	run_id: string;
	status: string;
	url: string;
}

// ── Pipelines ────────────────────────────────────────────

export async function listPipelines(): Promise<Pipeline[]> {
	return apiFetch<Pipeline[]>('/pipelines');
}

export async function getPipeline(idOrName: string): Promise<Pipeline> {
	return apiFetch<Pipeline>(`/pipelines/${idOrName}`);
}

export async function createPipeline(yamlContent: string): Promise<Pipeline> {
	return apiFetch<Pipeline>('/pipelines', {
		method: 'POST',
		body: yamlContent,
		headers: { 'Content-Type': 'text/plain' },
	});
}

export async function updatePipeline(id: string, yamlContent: string): Promise<void> {
	return apiFetch<void>(`/pipelines/${id}`, {
		method: 'PUT',
		body: yamlContent,
		headers: { 'Content-Type': 'text/plain' },
	});
}

export async function deletePipeline(id: string): Promise<void> {
	return apiFetch<void>(`/pipelines/${id}`, { method: 'DELETE' });
}

// ── Runs ─────────────────────────────────────────────────

export async function triggerRun(idOrName: string, variables: Record<string, string> = {}): Promise<TriggerRunResponse> {
	return apiFetch<TriggerRunResponse>(`/pipelines/${idOrName}/run`, {
		method: 'POST',
		body: JSON.stringify({ variables }),
	});
}

export async function listPipelineRuns(pipelineId?: string): Promise<PipelineRun[]> {
	const path = pipelineId ? `/pipeline-runs?pipeline_id=${pipelineId}` : '/pipeline-runs';
	return apiFetch<PipelineRun[]>(path);
}

export async function getPipelineRun(runId: string): Promise<PipelineRun> {
	return apiFetch<PipelineRun>(`/pipeline-runs/${runId}`);
}

export async function cancelPipelineRun(runId: string): Promise<void> {
	return apiFetch<void>(`/pipeline-runs/${runId}`, { method: 'DELETE' });
}

// ── Schedules ────────────────────────────────────────────

export async function listSchedules(pipelineId: string): Promise<PipelineSchedule[]> {
	return apiFetch<PipelineSchedule[]>(`/pipelines/${pipelineId}/schedules`);
}

export async function createSchedule(pipelineId: string, cronExpression: string, variables: Record<string, string> = {}, enabled = true): Promise<{ id: string }> {
	return apiFetch<{ id: string }>(`/pipelines/${pipelineId}/schedules`, {
		method: 'POST',
		body: JSON.stringify({ cron_expression: cronExpression, variables, enabled }),
	});
}

export async function updateSchedule(id: string, updates: { cron_expression?: string; enabled?: boolean; variables?: Record<string, string> }): Promise<void> {
	return apiFetch<void>(`/pipeline-schedules/${id}`, {
		method: 'PUT',
		body: JSON.stringify(updates),
	});
}

export async function deleteSchedule(id: string): Promise<void> {
	return apiFetch<void>(`/pipeline-schedules/${id}`, { method: 'DELETE' });
}

// ── Secrets ──────────────────────────────────────────────

export async function listSecrets(): Promise<Secret[]> {
	return apiFetch<Secret[]>('/secrets');
}

export async function createSecret(name: string, value: string): Promise<{ name: string }> {
	return apiFetch<{ name: string }>('/secrets', {
		method: 'POST',
		body: JSON.stringify({ name, value }),
	});
}

export async function deleteSecret(name: string): Promise<void> {
	return apiFetch<void>(`/secrets/${name}`, { method: 'DELETE' });
}
