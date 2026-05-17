/**
 * Typed API fetch wrapper with RFC 7807 error handling.
 */

import { getApiKey, clearApiKey } from '$lib/auth/auth-store.svelte.js';

export class ApiError extends Error {
	status: number;
	detail: string;
	type: string;

	constructor(status: number, detail: string, type: string = 'about:blank') {
		super(detail);
		this.name = 'ApiError';
		this.status = status;
		this.detail = detail;
		this.type = type;
	}
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const url = path.startsWith('/api') ? path : `/api${path}`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...(init?.headers as Record<string, string>)
	};

	const key = getApiKey();
	if (key) {
		headers['Authorization'] = `Bearer ${key}`;
	}

	const response = await fetch(url, {
		...init,
		headers
	});

	if (!response.ok) {
		if (response.status === 401) {
			clearApiKey();
			if (typeof window !== 'undefined') {
				window.location.href = '/login';
			}
			throw new ApiError(401, 'Unauthorized', 'about:blank');
		}

		let detail = response.statusText;
		let type = 'about:blank';

		try {
			const body = await response.json();
			if (body.detail) detail = body.detail;
			if (body.type) type = body.type;
		} catch {
			// Use statusText as fallback
		}

		throw new ApiError(response.status, detail, type);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
}
