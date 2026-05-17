<script lang="ts">
	import type { HierarchyNode } from '$lib/api/types.js';

	let { node }: { node: HierarchyNode } = $props();

	/** Track which command index is currently showing "Copied!" feedback. */
	let copiedIndex = $state<number | null>(null);
	let copyFailed = $state<number | null>(null);

	interface MaestroCommand {
		label: string;
		yaml: string;
	}

	interface CommandGroup {
		selectorType: string;
		commands: MaestroCommand[];
	}

	/** Build grouped command list from node selectors, ordered: id → text → description. */
	function generateCommands(n: HierarchyNode): CommandGroup[] {
		const groups: CommandGroup[] = [];

		if (n.id) {
			groups.push({
				selectorType: 'By ID',
				commands: [
					{ label: 'tapOn', yaml: `- tapOn:\n    id: "${n.id}"` },
					{ label: 'assertVisible', yaml: `- assertVisible:\n    id: "${n.id}"` },
					{ label: 'assertNotVisible', yaml: `- assertNotVisible:\n    id: "${n.id}"` }
				]
			});
		}

		if (n.text) {
			groups.push({
				selectorType: 'By Text',
				commands: [
					{ label: 'tapOn', yaml: `- tapOn: "${n.text}"` },
					{ label: 'assertVisible', yaml: `- assertVisible:\n    text: "${n.text}"` },
					{ label: 'assertNotVisible', yaml: `- assertNotVisible:\n    text: "${n.text}"` }
				]
			});
		}

		if (n.description) {
			groups.push({
				selectorType: 'By Label',
				commands: [
					{ label: 'tapOn', yaml: `- tapOn:\n    label: "${n.description}"` },
					{ label: 'assertVisible', yaml: `- assertVisible:\n    label: "${n.description}"` },
					{ label: 'assertNotVisible', yaml: `- assertNotVisible:\n    label: "${n.description}"` }
				]
			});
		}

		return groups;
	}

	async function copyToClipboard(text: string, globalIndex: number) {
		try {
			await navigator.clipboard.writeText(text);
			copiedIndex = globalIndex;
			copyFailed = null;
			setTimeout(() => {
				if (copiedIndex === globalIndex) copiedIndex = null;
			}, 2000);
		} catch {
			copyFailed = globalIndex;
			copiedIndex = null;
			setTimeout(() => {
				if (copyFailed === globalIndex) copyFailed = null;
			}, 2000);
		}
	}

	let groups = $derived(generateCommands(node));
</script>

{#snippet commandBlock(cmd: MaestroCommand, globalIndex: number)}
	<div class="group" data-testid="maestro-command">
		<div class="flex items-center justify-between mb-1">
			<span class="text-[10px] text-on-surface-variant/70 uppercase tracking-widest">{cmd.label}</span>
			<button
				onclick={() => copyToClipboard(cmd.yaml, globalIndex)}
				class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-outline-variant/20 bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:border-outline-variant/40 transition-colors"
			>
				{#if copiedIndex === globalIndex}
					<span class="material-symbols-outlined text-xs text-primary">check</span>
					<span class="text-primary">Copied!</span>
				{:else if copyFailed === globalIndex}
					<span class="material-symbols-outlined text-xs text-tertiary">error</span>
					<span class="text-tertiary">Copy failed</span>
				{:else}
					<span class="material-symbols-outlined text-xs">content_copy</span>
					<span>Copy</span>
				{/if}
			</button>
		</div>
		<pre class="bg-surface-container rounded px-3 py-2 text-xs font-mono text-on-surface leading-relaxed overflow-x-auto border border-outline-variant/10"><code>{cmd.yaml}</code></pre>
	</div>
{/snippet}

{#if groups.length > 0}
	<div class="space-y-4">
		<h3 class="text-[10px] text-on-surface-variant tracking-widest uppercase font-medium">Maestro Commands</h3>
		{#each groups as group, groupIdx}
			<div class="space-y-2">
				<p class="text-[10px] text-primary/70 font-medium tracking-wide">{group.selectorType}</p>
				{#each group.commands as cmd, cmdIdx}
					{@render commandBlock(cmd, groupIdx * 3 + cmdIdx)}
				{/each}
			</div>
		{/each}
	</div>
{:else}
	<div class="text-center py-3">
		<p class="text-[10px] text-on-surface-variant/50 tracking-widest uppercase">No selectors available</p>
	</div>
{/if}
