import { apiFetch } from './api/client.js';

export interface UiConfig {
	useReportShell: boolean;
}

export async function loadUiConfig(): Promise<UiConfig> {
	try {
		return await apiFetch<UiConfig>('/api/ui-config');
	} catch {
		return { useReportShell: false };
	}
}
