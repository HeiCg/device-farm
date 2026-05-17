<script lang="ts">
	import { releaseSession, type SessionListItem } from '$lib/sessions/client.js';

	let { data } = $props<{ data: { sessions: SessionListItem[] } }>();
	// Mirror `data.sessions` into local mutable state so the Release button
	// can optimistically drop rows. `$derived(data.sessions)` was rejected
	// here because we WANT the local copy to diverge from the load-time
	// value after a release; the initial-capture warning is intentional.
	// svelte-ignore state_referenced_locally
	let sessions = $state<SessionListItem[]>(data.sessions);
	let errorMsg = $state<string | null>(null);
	let releasing = $state<Set<string>>(new Set());

	async function handleRelease(sessionId: string) {
		errorMsg = null;
		releasing.add(sessionId);
		releasing = new Set(releasing);
		try {
			await releaseSession(sessionId);
			sessions = sessions.filter((s) => s.sessionId !== sessionId);
		} catch (err: unknown) {
			errorMsg = err instanceof Error ? err.message : 'Failed to release session';
		} finally {
			releasing.delete(sessionId);
			releasing = new Set(releasing);
		}
	}

	function formatTime(iso: string): string {
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}
</script>

<svelte:head><title>Active sessions — Device Farm</title></svelte:head>

<div class="space-y-4">
	<header class="flex items-baseline justify-between">
		<h1 class="text-2xl font-semibold">Active sessions</h1>
		<p class="text-xs text-gray-500">
			Lease new sessions via the CLI (<code class="bg-gray-100 px-1 rounded">device-farm session lease</code>) or MCP.
		</p>
	</header>

	{#if errorMsg}
		<div class="bg-red-50 border border-red-200 text-red-800 text-sm p-3 rounded">
			{errorMsg}
		</div>
	{/if}

	{#if sessions.length === 0}
		<p class="text-gray-500 text-sm py-8 text-center border border-dashed rounded">
			No active sessions. Lease one from the CLI to see it appear here.
		</p>
	{:else}
		<div class="overflow-x-auto border rounded">
			<table class="w-full text-sm">
				<thead class="bg-gray-50 border-b">
					<tr>
						<th class="text-left p-2 font-medium">Device</th>
						<th class="text-left p-2 font-medium">Platform</th>
						<th class="text-left p-2 font-medium">Owner</th>
						<th class="text-left p-2 font-medium">Leased until</th>
						<th class="text-left p-2 font-medium">Status</th>
						<th class="text-left p-2 font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each sessions as session (session.sessionId)}
						<tr class="border-b hover:bg-gray-50">
							<td class="p-2 font-mono text-xs">{session.deviceName}</td>
							<td class="p-2 capitalize">{session.platform}</td>
							<td class="p-2 text-xs font-mono">{session.ownerActor}</td>
							<td class="p-2 text-xs">{formatTime(session.leaseUntil)}</td>
							<td class="p-2">
								<span class="inline-block px-2 py-0.5 text-xs rounded bg-green-100 text-green-800">
									{session.status}
								</span>
							</td>
							<td class="p-2 space-x-3">
								<a
									href="/sessions/{session.sessionId}"
									class="text-blue-600 hover:underline"
									data-testid="view-session"
								>View</a>
								<button
									type="button"
									onclick={() => handleRelease(session.sessionId)}
									disabled={releasing.has(session.sessionId)}
									class="text-red-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
									data-testid="release-session"
								>
									{releasing.has(session.sessionId) ? 'Releasing…' : 'Release'}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
