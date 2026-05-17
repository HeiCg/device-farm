<script lang="ts">
	import { onMount } from 'svelte';
	import { listSecrets, createSecret, deleteSecret, type Secret } from '$lib/api/pipelines.js';
	import { formatDistanceToNow } from 'date-fns';

	let secrets: Secret[] = $state([]);
	let loading = $state(true);
	let error: string | null = $state(null);
	let showForm = $state(false);
	let newName = $state('');
	let newValue = $state('');
	let saving = $state(false);
	let deleteConfirm: string | null = $state(null);

	async function loadSecrets() {
		try {
			loading = true;
			secrets = await listSecrets();
			error = null;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load secrets';
		} finally {
			loading = false;
		}
	}

	async function handleCreate() {
		if (!newName.trim() || !newValue.trim()) return;
		try {
			saving = true;
			await createSecret(newName.trim(), newValue.trim());
			newName = '';
			newValue = '';
			showForm = false;
			await loadSecrets();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to create secret';
		} finally {
			saving = false;
		}
	}

	async function handleDelete(name: string) {
		try {
			await deleteSecret(name);
			deleteConfirm = null;
			await loadSecrets();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to delete secret';
		}
	}

	onMount(() => { loadSecrets(); });
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h3 class="font-headline text-sm font-bold text-on-surface tracking-wider uppercase">Secrets</h3>
		<button onclick={() => (showForm = !showForm)}
			class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs hover:bg-primary/30 transition-colors">
			<span class="material-symbols-outlined text-sm">{showForm ? 'close' : 'add'}</span>
			{showForm ? 'Cancel' : 'Add Secret'}
		</button>
	</div>

	{#if error}
		<div class="bg-tertiary/10 border border-tertiary/20 rounded-lg px-3 py-2 text-tertiary text-xs">
			{error}
		</div>
	{/if}

	<!-- Add form -->
	{#if showForm}
		<div class="bg-surface-container-low rounded-lg p-4 border border-white/5 space-y-3">
			<div>
				<label class="text-[10px] text-on-surface-variant tracking-widest uppercase block mb-1">NAME</label>
				<input
					type="text"
					bind:value={newName}
					placeholder="e.g. azure_pat"
					class="w-full bg-surface-container border border-white/5 rounded-lg px-3 py-2 text-sm text-on-surface font-mono placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
				/>
			</div>
			<div>
				<label class="text-[10px] text-on-surface-variant tracking-widest uppercase block mb-1">VALUE</label>
				<input
					type="password"
					bind:value={newValue}
					placeholder="Secret value (stored encrypted)"
					class="w-full bg-surface-container border border-white/5 rounded-lg px-3 py-2 text-sm text-on-surface font-mono placeholder:text-on-surface-variant/30 focus:outline-none focus:border-primary/50"
				/>
			</div>
			<button onclick={handleCreate} disabled={saving || !newName.trim() || !newValue.trim()}
				class="px-4 py-2 rounded-lg bg-primary text-on-primary text-xs font-headline tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50">
				{saving ? 'Creating...' : 'Create Secret'}
			</button>
		</div>
	{/if}

	<!-- Secrets list -->
	{#if loading}
		<div class="space-y-2">
			{#each Array(3) as _}
				<div class="bg-surface-container-low rounded-lg p-3 animate-pulse border border-white/5">
					<div class="w-1/3 h-4 rounded bg-surface-container"></div>
				</div>
			{/each}
		</div>
	{:else if secrets.length === 0 && !showForm}
		<div class="bg-surface-container-low rounded-lg px-4 py-8 text-center border border-white/5">
			<span class="material-symbols-outlined text-2xl text-primary/40 mb-2 block">key</span>
			<p class="text-xs text-on-surface-variant">No secrets stored</p>
			<p class="text-[10px] text-on-surface-variant/50 mt-1">Secrets are used for Git PATs, webhook tokens, and other sensitive values.</p>
		</div>
	{:else}
		{#each secrets as secret (secret.name)}
			<div class="bg-surface-container-low rounded-lg p-3 border border-white/5 flex items-center justify-between">
				<div>
					<span class="text-sm font-mono text-on-surface">{secret.name}</span>
					<div class="text-[10px] text-on-surface-variant/40 mt-0.5">
						Created {formatDistanceToNow(new Date(secret.createdAt), { addSuffix: true })}
					</div>
				</div>
				{#if deleteConfirm === secret.name}
					<div class="flex gap-1">
						<button onclick={() => handleDelete(secret.name)} class="text-[10px] px-2 py-0.5 rounded bg-tertiary/20 text-tertiary hover:bg-tertiary/30">Delete</button>
						<button onclick={() => (deleteConfirm = null)} class="text-[10px] px-2 py-0.5 rounded bg-surface-container text-on-surface-variant hover:bg-surface-container-high">Cancel</button>
					</div>
				{:else}
					<button onclick={() => (deleteConfirm = secret.name)}
						class="material-symbols-outlined text-sm text-on-surface-variant/50 hover:text-tertiary transition-colors">
						delete
					</button>
				{/if}
			</div>
		{/each}
	{/if}
</div>
