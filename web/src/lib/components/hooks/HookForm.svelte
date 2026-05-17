<script lang="ts">
	import type { HookDefinition, HookEvent } from '$lib/api/types.js';

	let {
		hook,
		onSave,
		onCancel,
		saving,
		error,
	}: {
		hook: HookDefinition | null;
		onSave: (hook: HookDefinition) => void;
		onCancel: () => void;
		saving: boolean;
		error: string | null;
	} = $props();

	// Form state — pre-fill from hook in edit mode, defaults for create mode
	let name = $state(hook?.name ?? '');
	let event = $state<HookEvent>(hook?.event ?? 'device.booted');
	let platform = $state<'android' | 'ios' | 'all'>(hook?.platform ?? 'all');
	let command = $state(hook?.command ?? '');
	let timeoutSeconds = $state(hook ? Math.round(hook.timeoutMs / 1000) : 30);
	let failOnError = $state(hook?.failOnError ?? false);
	let enabled = $state(hook?.enabled ?? true);

	let isEditMode = $derived(hook !== null);
	let title = $derived(isEditMode ? 'Edit Hook' : 'Create Hook');

	function handleSubmit(e: Event) {
		e.preventDefault();
		const definition: HookDefinition = {
			name: name.trim(),
			event,
			command,
			platform,
			timeoutMs: timeoutSeconds * 1000,
			failOnError,
			enabled,
		};
		onSave(definition);
	}

	const inputClass = 'w-full bg-surface-container-low border border-outline-variant/10 rounded-lg text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 px-3 py-2 text-sm transition-colors';
	const labelClass = 'block text-[10px] font-headline tracking-widest text-on-surface-variant uppercase mb-1.5';
	const commandPlaceholder = 'e.g. adb -s \u007B\u007Bserial\u007D\u007D shell settings put global wifi_on 1';

	const templateVars: Array<{ variable: string; description: string }> = [
		{ variable: '{{device_id}}', description: 'Internal device identifier' },
		{ variable: '{{emulator_id}}', description: 'Emulator or simulator name' },
		{ variable: '{{serial}}', description: 'ADB serial or UDID' },
		{ variable: '{{platform}}', description: 'Platform: android or ios' },
		{ variable: '{{port}}', description: 'Assigned port number' },
		{ variable: '{{job_id}}', description: 'Current job ID (test events only)' },
	];
</script>

<div class="bg-surface-container-low rounded-xl p-6 border border-white/5">
	<!-- Form header -->
	<div class="flex items-center gap-3 mb-6">
		<div class="p-2 bg-primary/10 rounded-lg">
			<span class="material-symbols-outlined text-primary">{isEditMode ? 'edit' : 'add_circle'}</span>
		</div>
		<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">{title.toUpperCase().replace(' ', '_')}</h2>
	</div>

	<!-- Error banner -->
	{#if error}
		<div class="mb-5 bg-tertiary/10 border border-tertiary/20 text-tertiary rounded-lg px-4 py-3 text-sm flex items-start gap-2">
			<span class="material-symbols-outlined text-base mt-0.5 flex-shrink-0">error</span>
			<span>{error}</span>
		</div>
	{/if}

	<form onsubmit={handleSubmit}>
		<div class="space-y-4">
			<!-- Name -->
			<div>
				<label for="hook-name" class={labelClass}>NAME</label>
				<input
					id="hook-name"
					type="text"
					bind:value={name}
					required
					maxlength={255}
					placeholder="e.g. setup-wifi"
					class={inputClass}
					disabled={isEditMode}
				/>
				{#if isEditMode}
					<p class="text-[10px] text-outline-variant mt-1">Name cannot be changed after creation</p>
				{/if}
			</div>

			<!-- Event + Platform row -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div>
					<label for="hook-event" class={labelClass}>EVENT</label>
					<select
						id="hook-event"
						bind:value={event}
						class={inputClass}
					>
						<option value="device.booted">device.booted</option>
						<option value="device.shutdown">device.shutdown</option>
						<option value="test.before">test.before</option>
						<option value="test.after">test.after</option>
					</select>
				</div>
				<div>
					<label for="hook-platform" class={labelClass}>PLATFORM</label>
					<select
						id="hook-platform"
						bind:value={platform}
						class={inputClass}
					>
						<option value="all">All Platforms</option>
						<option value="android">Android</option>
						<option value="ios">iOS</option>
					</select>
				</div>
			</div>

			<!-- Command -->
			<div>
				<label for="hook-command" class={labelClass}>COMMAND</label>
				<textarea
					id="hook-command"
					bind:value={command}
					required
					maxlength={4096}
					rows={4}
					placeholder={commandPlaceholder}
					class="{inputClass} font-mono resize-y"
				></textarea>

				<!-- Template variable reference -->
				<div class="mt-2 bg-surface-container rounded-lg p-3 text-xs text-on-surface-variant">
					<p class="text-[10px] font-headline tracking-widest uppercase mb-2 text-on-surface-variant/70">TEMPLATE_VARIABLES</p>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
						{#each templateVars as tv}
							<div class="flex items-baseline gap-2">
								<code class="font-mono text-primary text-[11px] flex-shrink-0">{tv.variable}</code>
								<span class="text-on-surface-variant/70">— {tv.description}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<!-- Timeout + Toggles row -->
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div>
					<label for="hook-timeout" class={labelClass}>TIMEOUT (SECONDS)</label>
					<input
						id="hook-timeout"
						type="number"
						bind:value={timeoutSeconds}
						min={1}
						max={300}
						class={inputClass}
					/>
				</div>
				<div class="flex items-end pb-1">
					<label class="flex items-center gap-3 cursor-pointer">
						<button
							type="button"
							role="switch"
							aria-checked={failOnError}
							aria-label="Fail on error"
							onclick={() => failOnError = !failOnError}
							class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 {failOnError ? 'bg-tertiary' : 'bg-outline-variant/30'}"
						>
							<span class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform {failOnError ? 'translate-x-4' : 'translate-x-0.5'}"></span>
						</button>
						<span class="text-xs text-on-surface-variant">Fail on Error</span>
					</label>
				</div>
				<div class="flex items-end pb-1">
					<label class="flex items-center gap-3 cursor-pointer">
						<button
							type="button"
							role="switch"
							aria-checked={enabled}
							aria-label="Enabled"
							onclick={() => enabled = !enabled}
							class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 {enabled ? 'bg-primary' : 'bg-outline-variant/30'}"
						>
							<span class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform {enabled ? 'translate-x-4' : 'translate-x-0.5'}"></span>
						</button>
						<span class="text-xs text-on-surface-variant">Enabled</span>
					</label>
				</div>
			</div>
		</div>

		<!-- Form actions -->
		<div class="flex items-center gap-3 mt-6 pt-4 border-t border-white/5">
			<button
				type="submit"
				disabled={saving || !name.trim() || !command.trim()}
				class="inline-flex items-center gap-2 px-4 py-2 text-sm font-headline font-bold tracking-widest text-white bg-gradient-to-r from-primary to-primary/70 rounded-lg hover:from-primary/90 hover:to-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
			>
				{#if saving}
					<span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
					SAVING...
				{:else}
					<span class="material-symbols-outlined text-sm">save</span>
					{isEditMode ? 'UPDATE_HOOK' : 'CREATE_HOOK'}
				{/if}
			</button>
			<button
				type="button"
				onclick={onCancel}
				class="px-4 py-2 text-sm font-headline tracking-widest text-on-surface-variant border border-outline-variant/20 rounded-lg hover:bg-surface-container hover:text-on-surface transition-colors"
			>
				CANCEL
			</button>
		</div>
	</form>
</div>
