<script lang="ts">
	let { passRate }: { passRate: number } = $props();

	let tooltipText = $derived(`Pass rate: ${Math.round(passRate * 100)}% in last 10 runs`);
</script>

<span
	class="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium bg-tertiary/10 text-tertiary rounded-md cursor-help border border-tertiary/20"
	title={tooltipText}
>
	<span class="material-symbols-outlined" style="font-size: 12px;">warning</span>
	Flaky
</span>
