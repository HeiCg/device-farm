<script lang="ts">
	let { healthPercent, size = 'sm' }: { healthPercent: number; size?: 'sm' | 'md' | 'lg' } = $props();

	let icon = $derived(
		healthPercent > 80 ? 'sunny' :
		healthPercent > 50 ? 'cloudy' :
		'rainy'
	);

	let colorClass = $derived(
		healthPercent > 80 ? 'text-yellow-500' :
		healthPercent > 50 ? 'text-slate-400' :
		'text-slate-300'
	);

	const sizeClasses: Record<string, string> = {
		sm: 'text-sm',
		md: 'text-2xl',
		lg: 'text-6xl',
	};

	let sizeClass = $derived(sizeClasses[size] ?? sizeClasses.sm);
</script>

<span
	class="material-symbols-outlined {colorClass} {sizeClass}"
	title="{Math.round(healthPercent)}% healthy"
>{icon}</span>
