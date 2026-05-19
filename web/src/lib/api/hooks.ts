/**
 * Hooks API client — wraps the 5 lifecycle hooks endpoints.
 *
 * Routes (from server/hooks/plugin.ts):
 *   GET    /api/hooks              — list all hooks
 *   POST   /api/hooks              — create a new hook
 *   PUT    /api/hooks/:name        — update a hook (name in URL is the old name)
 *   DELETE /api/hooks/:name        — delete a hook
 *   POST   /api/hooks/:name/test   — test-run a hook
 */
import { apiFetch } from './client.js';
import type { HookDefinition, HookResult } from './types.js';

/**
 * List all registered hooks.
 */
export async function listHooks(): Promise<HookDefinition[]> {
	return apiFetch<HookDefinition[]>('/api/hooks');
}

/**
 * Create a new hook. Throws ApiError(409) if name already exists.
 */
export async function createHook(hook: HookDefinition): Promise<HookDefinition> {
	return apiFetch<HookDefinition>('/api/hooks', {
		method: 'POST',
		body: JSON.stringify(hook)
	});
}

/**
 * Update an existing hook.
 *
 * @param oldName — the current name of the hook (used for URL lookup)
 * @param hook — the full updated hook definition (may have a new name)
 */
export async function updateHook(oldName: string, hook: HookDefinition): Promise<HookDefinition> {
	return apiFetch<HookDefinition>(`/api/hooks/${encodeURIComponent(oldName)}`, {
		method: 'PUT',
		body: JSON.stringify(hook)
	});
}

/**
 * Delete a hook by name. Throws ApiError(404) if not found.
 */
export async function deleteHook(name: string): Promise<{ status: string; name: string }> {
	return apiFetch<{ status: string; name: string }>(
		`/api/hooks/${encodeURIComponent(name)}`,
		{ method: 'DELETE' }
	);
}

/**
 * Test-run a hook. Executes the hook's command and returns the result
 * with stdout, stderr, exit code, and duration.
 *
 * @param name — hook name to test
 * @param deviceId — optional real device ID (uses test context if omitted)
 */
export async function testHook(
	name: string,
	opts?: { deviceId?: string; vars?: Record<string, unknown> }
): Promise<HookResult> {
	const body: Record<string, unknown> = {};
	if (opts?.deviceId) body.deviceId = opts.deviceId;
	if (opts?.vars) body.vars = opts.vars;
	return apiFetch<HookResult>(`/api/hooks/${encodeURIComponent(name)}/test`, {
		method: 'POST',
		body: JSON.stringify(body)
	});
}
