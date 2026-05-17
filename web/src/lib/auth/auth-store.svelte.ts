/**
 * Reactive auth state with localStorage persistence using Svelte 5 runes.
 */

const AUTH_KEY = 'device-farm-api-key';

let apiKey = $state<string | null>(
	typeof localStorage !== 'undefined' ? localStorage.getItem(AUTH_KEY) : null
);

let authEnabled = $state<boolean | null>(null);

export function getApiKey(): string | null {
	return apiKey;
}

export function setApiKey(key: string): void {
	apiKey = key;
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem(AUTH_KEY, key);
	}
}

export function clearApiKey(): void {
	apiKey = null;
	if (typeof localStorage !== 'undefined') {
		localStorage.removeItem(AUTH_KEY);
	}
}

export function isAuthenticated(): boolean {
	return apiKey !== null && apiKey.length > 0;
}

export function isAuthEnabled(): boolean | null {
	return authEnabled;
}

export async function checkAuthEnabled(): Promise<boolean> {
	try {
		const res = await fetch('/api/config');
		if (res.ok) {
			const config = await res.json();
			authEnabled = config.auth?.enabled ?? true;
		} else {
			authEnabled = true;
		}
	} catch {
		authEnabled = true;
	}
	return authEnabled!;
}
