<script lang="ts">
	import type { MaestroOptions } from '$lib/api/types.js';

	let { options }: { options: MaestroOptions | null } = $props();

	let visibleRows = $derived(buildRows(options));

	interface OptionRow {
		label: string;
		icon: string;
		kind: 'tags-include' | 'tags-exclude' | 'text' | 'flag' | 'count';
		values: string[];
	}

	const tagIncludeClasses: Record<string, string> = {
		pill: 'bg-secondary/10 text-secondary border border-secondary/20',
	};

	const tagExcludeClasses: Record<string, string> = {
		pill: 'bg-tertiary/10 text-tertiary border border-tertiary/20',
	};

	const flagClasses: Record<string, string> = {
		enabled: 'bg-primary/10 text-primary border border-primary/20',
	};

	function buildRows(opts: MaestroOptions | null): OptionRow[] {
		if (!opts) return [];
		const rows: OptionRow[] = [];
		if (opts.includeTags.length > 0) {
			rows.push({ label: 'Include Tags', icon: 'label', kind: 'tags-include', values: opts.includeTags });
		}
		if (opts.excludeTags.length > 0) {
			rows.push({ label: 'Exclude Tags', icon: 'label_off', kind: 'tags-exclude', values: opts.excludeTags });
		}
		if (opts.reportFormat) {
			rows.push({ label: 'Report Format', icon: 'description', kind: 'text', values: [opts.reportFormat] });
		}
		if (opts.debugOutput) {
			rows.push({ label: 'Debug Output', icon: 'bug_report', kind: 'flag', values: ['Enabled'] });
		}
		if (opts.shards !== null) {
			rows.push({ label: 'Shards', icon: 'view_column', kind: 'count', values: [String(opts.shards)] });
		}
		return rows;
	}
</script>

{#if options && visibleRows.length > 0}
	<div class="border-l-2 border-primary bg-surface-container-low rounded-lg overflow-hidden">
		<!-- Header bar -->
		<div class="flex items-center gap-2 px-4 py-2.5 bg-surface-container-high">
			<span class="material-symbols-outlined text-sm text-primary">tune</span>
			<h3 class="text-[12px] font-semibold text-on-surface">Maestro Options</h3>
		</div>

		<!-- Option rows -->
		<div class="p-4 space-y-3">
			{#each visibleRows as row}
				<div class="flex items-start gap-3">
					<span class="material-symbols-outlined text-sm text-on-surface-variant mt-0.5 shrink-0">{row.icon}</span>
					<div class="min-w-0">
						<div class="text-[11px] text-on-surface-variant mb-1">{row.label}</div>
						{#if row.kind === 'tags-include'}
							<div class="flex flex-wrap gap-1.5">
								{#each row.values as tag}
									<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium {tagIncludeClasses.pill}">
										{tag}
									</span>
								{/each}
							</div>
						{:else if row.kind === 'tags-exclude'}
							<div class="flex flex-wrap gap-1.5">
								{#each row.values as tag}
									<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium {tagExcludeClasses.pill}">
										{tag}
									</span>
								{/each}
							</div>
						{:else if row.kind === 'flag'}
							<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium {flagClasses.enabled}">
								{row.values[0]}
							</span>
						{:else if row.kind === 'count'}
							<span class="text-[13px] font-mono text-on-surface tabular-nums">{row.values[0]}</span>
						{:else}
							<span class="text-[13px] font-mono text-on-surface">{row.values[0]}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}
