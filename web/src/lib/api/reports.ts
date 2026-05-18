import { apiFetch } from './client.js';
import type { ReportBundle } from './types.js';

export function fetchReport(jobId: string, shareToken?: string): Promise<ReportBundle> {
	const qs = shareToken ? `?t=${encodeURIComponent(shareToken)}` : '';
	return apiFetch<ReportBundle>(`/jobs/${jobId}/report${qs}`);
}

export function mintShareToken(jobId: string, ttlDays: 5 | 15 | 30) {
	return apiFetch<{ token: string; expiresAt: string; url: string }>(`/jobs/${jobId}/share-token`, {
		method: 'POST',
		body: JSON.stringify({ ttlDays }),
		headers: { 'Content-Type': 'application/json' },
	});
}

export interface SuiteAggregate {
	flowName: string; totalRuns: number; passed: number; failed: number;
	passRate: number; avgDurationMs: number;
	lastRunAt: string | null; lastStatus: string; trend: number[];
}

export function fetchSuites(windowDays: number = 7) {
	return apiFetch<SuiteAggregate[]>(`/jobs/suites?windowDays=${windowDays}`);
}

export interface TrendsOutput {
	byDay: Array<{ date: string; passed: number; failed: number; total: number }>;
	byFlow: Array<{ flowName: string; passed: number; failed: number }>;
	windowDays: number;
}

export function fetchTrends(windowDays: number = 7) {
	return apiFetch<TrendsOutput>(`/jobs/trends?windowDays=${windowDays}`);
}
