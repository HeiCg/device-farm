<script lang="ts">
	import { onMount } from 'svelte';
	import { apiFetch } from '$lib/api/client.js';
	import { listHooks, createHook, updateHook, deleteHook, testHook } from '$lib/api/hooks.js';
	import type { HookDefinition, HookResult } from '$lib/api/types.js';
	import HookList from '$lib/components/hooks/HookList.svelte';
	import HookForm from '$lib/components/hooks/HookForm.svelte';
	import SecretManager from '$lib/components/secrets/SecretManager.svelte';

	// --- Config state ---
	let config: Record<string, any> | null = $state(null);
	let loading = $state(true);
	let error: string | null = $state(null);

	// --- Hooks state ---
	let hooks: HookDefinition[] = $state([]);
	let hooksLoading = $state(true);
	let hooksError: string | null = $state(null);
	let showForm = $state(false);
	let editingHook: HookDefinition | null = $state(null);
	let saving = $state(false);
	let formError: string | null = $state(null);
	let testingHook: string | null = $state(null);
	let testResults: Record<string, HookResult> = $state({});
	let deleteConfirm: string | null = $state(null);

	onMount(async () => {
		// Load config and hooks in parallel
		const configPromise = apiFetch<Record<string, any>>('/config')
			.then((c) => { config = c; })
			.catch((err: any) => { error = err.detail ?? err.message ?? 'Failed to load configuration'; })
			.finally(() => { loading = false; });

		const hooksPromise = listHooks()
			.then((h) => { hooks = h; })
			.catch((err: any) => { hooksError = err.detail ?? err.message ?? 'Failed to load hooks'; })
			.finally(() => { hooksLoading = false; });

		await Promise.all([configPromise, hooksPromise]);
	});

	// --- Hook CRUD handlers ---

	async function handleCreateOrEdit(hook: HookDefinition) {
		saving = true;
		formError = null;
		try {
			if (editingHook) {
				await updateHook(editingHook.name, hook);
			} else {
				await createHook(hook);
			}
			hooks = await listHooks();
			showForm = false;
			editingHook = null;
			formError = null;
		} catch (err: any) {
			if (err.status === 409) {
				formError = 'A hook with this name already exists';
			} else if (err.status === 404) {
				formError = 'Hook not found — it may have been deleted externally';
				hooks = await listHooks();
			} else {
				formError = err.detail ?? err.message ?? 'Failed to save hook';
			}
		} finally {
			saving = false;
		}
	}

	async function handleDelete(name: string) {
		if (deleteConfirm !== name) {
			// First click — request confirmation
			deleteConfirm = name;
			return;
		}
		// Second click — confirmed, execute delete
		deleteConfirm = null;
		try {
			await deleteHook(name);
			hooks = await listHooks();
		} catch (err: any) {
			if (err.status === 404) {
				// Already gone — just refresh
				hooks = await listHooks();
			}
			// Other errors are silently handled by re-fetching
		}
	}

	function handleCancelDelete() {
		deleteConfirm = null;
	}

	async function handleToggleEnabled(name: string, enabled: boolean) {
		const found = hooks.find((h) => h.name === name);
		if (!found) return;
		try {
			await updateHook(name, { ...found, enabled });
			hooks = await listHooks();
		} catch (err: any) {
			if (err.status === 404) {
				hooks = await listHooks();
			}
		}
	}

	async function handleTest(name: string) {
		testingHook = name;
		try {
			const result = await testHook(name);
			testResults[name] = result;
		} catch (err: any) {
			// Store a synthetic failed result so the UI can display the error
			testResults[name] = {
				hookName: name,
				event: 'device.booted',
				command: '',
				exitCode: null,
				stdout: '',
				stderr: '',
				durationMs: 0,
				success: false,
				error: err.detail ?? err.message ?? 'Test failed',
			};
		} finally {
			testingHook = null;
		}
	}

	function handleEdit(hook: HookDefinition) {
		editingHook = hook;
		showForm = true;
		formError = null;
	}

	function handleCancel() {
		showForm = false;
		editingHook = null;
		formError = null;
	}

	function handleShowCreate() {
		editingHook = null;
		showForm = true;
		formError = null;
	}
</script>

<div>
	<div class="mb-8">
		<div class="flex items-center gap-3">
			<h1 class="font-headline text-lg font-bold text-on-surface tracking-wide">DEVICE_FARM_CONFIG</h1>
			<span class="text-[10px] font-headline tracking-widest px-2.5 py-1 rounded bg-primary/10 text-primary border border-primary/20">READ_ONLY</span>
		</div>
		<p class="text-xs text-on-surface-variant mt-2">System configuration parameters — values sourced from server runtime</p>
	</div>

	{#if loading}
		<div class="text-sm text-on-surface-variant py-12 text-center">Loading configuration...</div>
	{:else if error}
		<div class="rounded-lg bg-tertiary/10 border border-tertiary/20 px-4 py-3 text-sm text-tertiary">{error}</div>
	{:else if config}
		<div class="grid grid-cols-12 gap-4">
			<!-- Section A — Server Parameters -->
			<section class="col-span-12 md:col-span-4 bg-surface-container-low rounded-xl p-6 border border-white/5">
				<div class="flex items-center gap-3 mb-5">
					<div class="p-2 bg-primary/10 rounded-lg">
						<span class="material-symbols-outlined text-primary">dns</span>
					</div>
					<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">SERVER_PARAMETERS</h2>
				</div>
				<div class="space-y-3">
					<div>
						<p class="text-[10px] text-on-surface-variant tracking-widest uppercase">HOST</p>
						<p class="text-sm text-on-surface font-mono mt-0.5">{config.server?.host ?? '-'}</p>
					</div>
					<div>
						<p class="text-[10px] text-on-surface-variant tracking-widest uppercase">PORT</p>
						<p class="text-sm text-on-surface font-mono mt-0.5">{config.server?.port ?? '-'}</p>
					</div>
					<div>
						<p class="text-[10px] text-on-surface-variant tracking-widest uppercase">AUTH_ENABLED</p>
						<p class="text-sm text-on-surface mt-0.5">{config.auth?.enabled ? 'Enabled' : 'Disabled'}</p>
					</div>
				</div>
			</section>

			<!-- Section B — Pool Orchestration -->
			<section class="col-span-12 md:col-span-8 bg-surface-container-low rounded-xl p-6 border border-white/5">
				<div class="flex items-center gap-3 mb-5">
					<div class="p-2 bg-primary/10 rounded-lg">
						<span class="material-symbols-outlined text-primary">hub</span>
					</div>
					<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">POOL_ORCHESTRATION</h2>
				</div>

				<!-- Max Devices accent number -->
				<div class="mb-5 p-3 bg-surface-container rounded-lg">
					<p class="text-[10px] text-on-surface-variant tracking-widest uppercase">MAX_DEVICES</p>
					<p class="text-2xl font-bold text-primary mt-1">{config.pool?.max_devices ?? '-'}</p>
				</div>

				<!-- Android + iOS side by side -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{#if config.pool?.android}
						<div class="bg-surface-container rounded-lg p-4">
							<div class="flex items-center gap-2 mb-3">
								<span class="material-symbols-outlined text-sm text-secondary">android</span>
								<span class="font-headline text-xs tracking-widest text-on-surface font-bold">ANDROID</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-secondary/10 text-secondary">
									{config.pool.android.enabled ? 'ACTIVE' : 'DISABLED'}
								</span>
							</div>
							<div class="space-y-2 text-xs">
								<div class="flex justify-between"><span class="text-on-surface-variant">Max Instances</span><span class="text-on-surface font-mono">{config.pool.android.max_instances}</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">API Level</span><span class="text-on-surface font-mono">{config.pool.android.api_level}</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">Profile</span><span class="text-on-surface font-mono">{config.pool.android.device_profile}</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">RAM</span><span class="text-on-surface font-mono">{config.pool.android.ram_mb} MB</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">Headless</span><span class="text-on-surface">{config.pool.android.headless ? 'Yes' : 'No'}</span></div>
							</div>
						</div>
					{/if}
					{#if config.pool?.ios}
						<div class="bg-surface-container rounded-lg p-4">
							<div class="flex items-center gap-2 mb-3">
								<span class="material-symbols-outlined text-sm text-on-surface-variant">phone_iphone</span>
								<span class="font-headline text-xs tracking-widest text-on-surface font-bold">IOS</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-on-surface-variant/10 text-on-surface-variant">
									{config.pool.ios.enabled ? 'ACTIVE' : 'DISABLED'}
								</span>
							</div>
							<div class="space-y-2 text-xs">
								<div class="flex justify-between"><span class="text-on-surface-variant">Max Instances</span><span class="text-on-surface font-mono">{config.pool.ios.max_instances}</span></div>
								{#if config.pool.ios.runtime}
									<div class="flex justify-between"><span class="text-on-surface-variant">Runtime</span><span class="text-on-surface font-mono">{config.pool.ios.runtime}</span></div>
								{/if}
								{#if config.pool.ios.device_type}
									<div class="flex justify-between"><span class="text-on-surface-variant">Device Type</span><span class="text-on-surface font-mono">{config.pool.ios.device_type}</span></div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</section>

			<!-- Section C — Job Execution Policy -->
			<section class="col-span-12 md:col-span-7 bg-surface-container-low rounded-xl p-6 border border-white/5">
				<div class="flex items-center gap-3 mb-5">
					<div class="p-2 bg-primary/10 rounded-lg">
						<span class="material-symbols-outlined text-primary">play_circle</span>
					</div>
					<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">JOB_EXECUTION_POLICY</h2>
				</div>
				<div class="grid grid-cols-3 gap-3">
					<div class="bg-surface-container rounded-lg p-4 text-center">
						<p class="text-2xl font-bold text-on-surface">{config.jobs?.timeout_minutes ?? '-'}</p>
						<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">TIMEOUT_MIN</p>
					</div>
					<div class="bg-surface-container rounded-lg p-4 text-center">
						<p class="text-2xl font-bold text-on-surface">{config.jobs?.max_queue_size ?? '-'}</p>
						<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">QUEUE_DEPTH</p>
					</div>
					<div class="bg-surface-container rounded-lg p-4 text-center">
						<p class="text-2xl font-bold text-on-surface">{config.jobs?.cleanup_completed_after_days ?? '-'}</p>
						<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mt-1">CLEANUP_DAYS</p>
					</div>
				</div>
			</section>

			<!-- Section D — Storage Subsystem -->
			<section class="col-span-12 md:col-span-5 bg-surface-container-low rounded-xl p-6 border border-white/5">
				<div class="flex items-center gap-3 mb-5">
					<div class="p-2 bg-primary/10 rounded-lg">
						<span class="material-symbols-outlined text-primary">storage</span>
					</div>
					<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">STORAGE_SUBSYSTEM</h2>
				</div>
				<div class="space-y-3">
					{#if config.storage?.artifacts}
						<div>
							<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-2">ARTIFACTS</p>
							<div class="space-y-2 text-xs">
								<div class="flex justify-between"><span class="text-on-surface-variant">Path</span><span class="text-on-surface font-mono truncate ml-2">{config.storage.artifacts.path}</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">Retention</span><span class="text-on-surface">{config.storage.artifacts.retention_days} days</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">Compress After</span><span class="text-on-surface">{config.storage.artifacts.compress_after_days} days</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">Max Storage</span><span class="text-on-surface font-mono">{config.storage.artifacts.max_storage_gb} GB</span></div>
							</div>
						</div>
					{/if}
					{#if config.storage?.logs}
						<div class="pt-3 border-t border-white/5">
							<p class="text-[10px] text-on-surface-variant tracking-widest uppercase mb-2">LOGS</p>
							<div class="space-y-2 text-xs">
								<div class="flex justify-between"><span class="text-on-surface-variant">Path</span><span class="text-on-surface font-mono truncate ml-2">{config.storage.logs.path}</span></div>
								<div class="flex justify-between"><span class="text-on-surface-variant">Retention</span><span class="text-on-surface">{config.storage.logs.retention_days} days</span></div>
							</div>
						</div>
					{/if}
				</div>
			</section>
		</div>

		<!-- Hooks Management Section -->
		<div class="mt-8">
			{#if hooksLoading}
				<div class="text-sm text-on-surface-variant py-8 text-center">Loading hooks...</div>
			{:else if hooksError}
				<div class="rounded-lg bg-tertiary/10 border border-tertiary/20 px-4 py-3 text-sm text-tertiary">{hooksError}</div>
			{:else}
				{#if showForm}
					<div class="mb-6">
						<HookForm
							hook={editingHook}
							onSave={handleCreateOrEdit}
							onCancel={handleCancel}
							{saving}
							error={formError}
						/>
					</div>
				{/if}
				<HookList
					{hooks}
					onCreate={handleShowCreate}
					onEdit={handleEdit}
					onDelete={handleDelete}
					onTest={handleTest}
					onToggleEnabled={handleToggleEnabled}
					{testingHook}
					{testResults}
					{deleteConfirm}
					onCancelDelete={handleCancelDelete}
				/>
			{/if}
		</div>

		<!-- Secrets Management -->
		<div class="mt-8">
			<section class="bg-surface-container-low rounded-xl p-6 border border-white/5">
				<div class="flex items-center gap-3 mb-6">
					<div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
						<span class="material-symbols-outlined text-primary text-sm">key</span>
					</div>
					<div>
						<h2 class="text-sm font-headline font-bold text-on-surface tracking-wider">SECRETS</h2>
						<p class="text-[11px] text-on-surface-variant">Encrypted secrets for pipeline integrations (PATs, tokens)</p>
					</div>
				</div>
				<SecretManager />
			</section>
		</div>
	{/if}
</div>
