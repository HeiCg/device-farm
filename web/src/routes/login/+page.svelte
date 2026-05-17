<script lang="ts">
	import { setApiKey, clearApiKey } from '$lib/auth/auth-store.svelte.js';
	import { apiFetch } from '$lib/api/client.js';

	let apiKeyInput = $state('');
	let errorMsg = $state<string | null>(null);
	let submitting = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		errorMsg = null;

		const key = apiKeyInput.trim();
		if (!key) {
			errorMsg = 'Please enter an API key';
			return;
		}

		submitting = true;
		try {
			setApiKey(key);
			await apiFetch('/admin/keys');
			window.location.href = '/';
		} catch {
			clearApiKey();
			errorMsg = 'Invalid API key';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="min-h-screen bg-background kinetic-gradient flex items-center justify-center p-4 relative overflow-hidden">
	<!-- Ambient blur orbs -->
	<div class="absolute top-1/4 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl"></div>
	<div class="absolute bottom-1/4 -right-32 w-64 h-64 bg-secondary/5 rounded-full blur-3xl"></div>

	<div class="relative w-full max-w-sm">
		<div class="bg-surface-container-high/80 backdrop-blur-xl rounded-2xl p-8 border border-outline-variant/10 shadow-2xl">
			<!-- Terminal icon -->
			<div class="flex justify-center mb-6">
				<div class="p-3 bg-primary/10 rounded-xl">
					<span class="material-symbols-outlined text-3xl text-primary">terminal</span>
				</div>
			</div>

			<!-- Headline -->
			<h1 class="text-center font-headline text-xl font-bold text-on-surface tracking-wide mb-1">Device Farm</h1>
			<p class="text-center text-on-surface-variant text-xs mb-8">Sign in with your API key</p>

			<!-- Auth form -->
			<form onsubmit={handleSubmit}>
				<label for="api-key" class="block text-xs font-headline tracking-widest text-on-surface-variant uppercase mb-2">SYSTEM ACCESS KEY</label>
				<div class="relative mb-4">
					<span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-lg text-on-surface-variant">key</span>
					<input
						id="api-key"
						type="password"
						bind:value={apiKeyInput}
						placeholder="Enter access key"
						class="w-full pl-10 pr-4 py-3 text-sm bg-surface-container-low border border-outline-variant/10 rounded-lg text-on-surface placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 transition-colors"
						disabled={submitting}
					/>
				</div>

				{#if errorMsg}
					<div class="mb-4 px-3 py-2.5 rounded-lg bg-tertiary/10 border border-tertiary/20">
						<p class="text-xs text-tertiary">{errorMsg}</p>
					</div>
				{/if}

				<button
					type="submit"
					disabled={submitting}
					class="w-full py-3 px-4 text-sm font-headline font-bold tracking-widest text-white bg-gradient-to-r from-primary to-primary/70 rounded-lg hover:from-primary/90 hover:to-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
				>
					{submitting ? 'AUTHENTICATING...' : 'INITIALIZE_SESSION'}
				</button>
			</form>
		</div>

		<!-- System status footer -->
		<div class="mt-6 flex items-center justify-center gap-2">
			<span class="relative flex h-2 w-2">
				<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
				<span class="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
			</span>
			<span class="text-xs text-on-surface-variant tracking-widest uppercase">SYSTEM_ONLINE</span>
		</div>
	</div>
</div>
