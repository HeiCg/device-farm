<script lang="ts">
	let { status, size }: { status: string; size?: number } = $props();

	const pillStyles: Record<string, string> = {
		// Green group — secondary
		passed: 'bg-secondary/10 text-secondary border-secondary/20',
		online: 'bg-secondary/10 text-secondary border-secondary/20',
		idle: 'bg-secondary/10 text-secondary border-secondary/20',
		// Red group — tertiary
		failed: 'bg-tertiary/10 text-tertiary border-tertiary/20',
		error: 'bg-tertiary/10 text-tertiary border-tertiary/20',
		timeout: 'bg-tertiary/10 text-tertiary border-tertiary/20',
		// Purple group — primary
		running: 'bg-primary/10 text-primary border-primary/20',
		// Neutral group — surface-variant
		queued: 'bg-surface-variant/50 text-on-surface-variant border-outline-variant/20',
		cancelled: 'bg-surface-variant/50 text-on-surface-variant border-outline-variant/20',
		booting: 'bg-surface-variant/50 text-on-surface-variant border-outline-variant/20',
		// Dim group — outline-variant
		offline: 'bg-outline-variant/10 text-outline-variant border-outline-variant/20',
		maintenance: 'bg-outline-variant/10 text-outline-variant border-outline-variant/20',
	};

	const fallback = 'bg-surface-variant/50 text-on-surface-variant border-outline-variant/20';

	let pillClasses = $derived(pillStyles[status] ?? fallback);
	let animateClass = $derived(status === 'running' ? 'animate-pulse' : '');
</script>

<span
	class="inline-flex items-center border text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-tighter {pillClasses} {animateClass}"
	title={status}
>
	{status}
</span>
