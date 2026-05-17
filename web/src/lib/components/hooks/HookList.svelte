<script lang="ts">
	import type { HookDefinition, HookResult } from '$lib/api/types.js';
	import HookTestResult from './HookTestResult.svelte';

	let {
		hooks,
		onCreate,
		onEdit,
		onDelete,
		onTest,
		onToggleEnabled,
		testingHook,
		testResults,
		deleteConfirm = null,
		onCancelDelete,
	}: {
		hooks: HookDefinition[];
		onCreate: () => void;
		onEdit: (hook: HookDefinition) => void;
		onDelete: (name: string) => void;
		onTest: (name: string) => void;
		onToggleEnabled: (name: string, enabled: boolean) => void;
		testingHook: string | null;
		testResults: Record<string, HookResult>;
		deleteConfirm?: string | null;
		onCancelDelete?: () => void;
	} = $props();

	// D016: static Tailwind class lookups for event badges
	const eventStyles: Record<string, string> = {
		'device.booted': 'bg-secondary/10 text-secondary border-secondary/20',
		'device.shutdown': 'bg-tertiary/10 text-tertiary border-tertiary/20',
		'test.before': 'bg-primary/10 text-primary border-primary/20',
		'test.after': 'bg-on-surface-variant/10 text-on-surface-variant border-on-surface-variant/20',
	};

	// D016: static Tailwind class lookups for platform badges
	const platformStyles: Record<string, string> = {
		android: 'bg-secondary/10 text-secondary border-secondary/20',
		ios: 'bg-on-surface-variant/10 text-on-surface-variant border-on-surface-variant/20',
		all: 'bg-primary/10 text-primary border-primary/20',
	};

	function truncateCommand(cmd: string, max: number = 60): string {
		if (cmd.length <= max) return cmd;
		return cmd.slice(0, max) + '…';
	}
</script>

<!-- Section header -->
<section class="bg-surface-container-low rounded-xl p-6 border border-white/5">
	<div class="flex items-center justify-between mb-5">
		<div class="flex items-center gap-3">
			<div class="p-2 bg-primary/10 rounded-lg">
				<span class="material-symbols-outlined text-primary">webhook</span>
			</div>
			<h2 class="font-headline font-bold text-sm tracking-widest text-on-surface">LIFECYCLE_HOOKS</h2>
		</div>
		<button
			onclick={onCreate}
			class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-headline font-bold tracking-widest text-white bg-gradient-to-r from-primary to-primary/70 rounded-lg hover:from-primary/90 hover:to-primary/60 transition-all"
		>
			<span class="material-symbols-outlined text-sm">add</span>
			CREATE_HOOK
		</button>
	</div>

	{#if hooks.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<div class="p-3 bg-surface-container rounded-xl mb-3">
				<span class="material-symbols-outlined text-3xl text-outline-variant">webhook</span>
			</div>
			<p class="text-sm text-on-surface-variant">No hooks configured</p>
			<p class="text-xs text-outline-variant mt-1">Create a lifecycle hook to run commands on device or test events</p>
		</div>
	{:else}
		<!-- Hook list -->
		<div class="space-y-2">
			{#each hooks as hook (hook.name)}
				{@const isTesting = testingHook === hook.name}
				{@const testResult = testResults[hook.name]}
				{@const eventClass = eventStyles[hook.event] ?? eventStyles['test.after']}
				{@const platClass = platformStyles[hook.platform] ?? platformStyles.all}

				<div class="rounded-lg border border-white/5 transition-colors {hook.enabled ? 'bg-surface-container' : 'bg-surface-container opacity-50'}">
					<div class="p-4">
						<div class="flex items-center gap-3">
							<!-- Hook name -->
							<span class="text-sm font-medium text-on-surface flex-shrink-0">{hook.name}</span>

							<!-- Event badge -->
							<span class="text-[10px] font-headline tracking-widest px-2 py-0.5 rounded border whitespace-nowrap {eventClass}">
								{hook.event}
							</span>

							<!-- Platform badge -->
							<span class="text-[10px] font-headline tracking-widest px-2 py-0.5 rounded border whitespace-nowrap {platClass}">
								{hook.platform.toUpperCase()}
							</span>

							<!-- Command preview -->
							<span class="text-xs font-mono text-on-surface-variant/70 truncate min-w-0 flex-1 hidden sm:block">
								{truncateCommand(hook.command)}
							</span>

							<!-- Enabled toggle -->
							<button
								onclick={() => onToggleEnabled(hook.name, !hook.enabled)}
								class="flex-shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors {hook.enabled ? 'bg-primary' : 'bg-outline-variant/30'}"
								title={hook.enabled ? 'Disable hook' : 'Enable hook'}
								aria-label={hook.enabled ? `Disable ${hook.name}` : `Enable ${hook.name}`}
							>
								<span class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform {hook.enabled ? 'translate-x-4' : 'translate-x-0.5'}"></span>
							</button>

							<!-- Action buttons -->
							<div class="flex items-center gap-1 flex-shrink-0">
								{#if deleteConfirm === hook.name}
									<!-- Delete confirmation -->
									<span class="text-xs text-tertiary mr-1">Delete?</span>
									<button
										onclick={() => onDelete(hook.name)}
										class="px-2 py-1 rounded-lg text-xs font-bold text-white bg-tertiary hover:bg-tertiary/80 transition-colors"
										aria-label={`Confirm delete ${hook.name}`}
									>
										Yes
									</button>
									<button
										onclick={() => onCancelDelete?.()}
										class="px-2 py-1 rounded-lg text-xs text-on-surface-variant border border-outline-variant/20 hover:bg-surface-container-low transition-colors"
										aria-label="Cancel delete"
									>
										No
									</button>
								{:else}
									<button
										onclick={() => onEdit(hook)}
										class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors"
										title="Edit hook"
										aria-label={`Edit ${hook.name}`}
									>
										<span class="material-symbols-outlined text-base">edit</span>
									</button>
									<button
										onclick={() => onTest(hook.name)}
										disabled={isTesting}
										class="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										title="Test hook"
										aria-label={`Test ${hook.name}`}
									>
										<span class="material-symbols-outlined text-base {isTesting ? 'animate-spin' : ''}">
											{isTesting ? 'progress_activity' : 'play_arrow'}
										</span>
									</button>
									<button
										onclick={() => onDelete(hook.name)}
										class="p-1.5 rounded-lg text-tertiary hover:bg-tertiary/10 transition-colors"
										title="Delete hook"
										aria-label={`Delete ${hook.name}`}
									>
										<span class="material-symbols-outlined text-base">delete</span>
									</button>
								{/if}
							</div>
						</div>
					</div>

					<!-- Inline test result -->
					{#if testResult}
						<div class="px-4 pb-4">
							<HookTestResult result={testResult} />
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</section>
