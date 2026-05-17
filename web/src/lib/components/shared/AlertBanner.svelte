<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant,
		message,
		href,
		children,
	}: {
		variant: 'critical' | 'warning' | 'info';
		message: string;
		href?: string;
		children?: Snippet;
	} = $props();

	const styles = {
		critical: {
			bg: 'bg-tertiary-container/10',
			border: 'border-tertiary/20',
			icon: 'error',
			iconColor: 'text-tertiary',
			label: 'Critical:',
			labelColor: 'font-headline font-bold text-tertiary',
		},
		warning: {
			bg: 'bg-primary-container/10',
			border: 'border-primary/20',
			icon: 'warning',
			iconColor: 'text-primary',
			label: 'Warning:',
			labelColor: 'font-headline font-bold text-primary',
		},
		info: {
			bg: 'bg-surface-container-high',
			border: 'border-outline-variant/20',
			icon: 'info',
			iconColor: 'text-on-surface-variant',
			label: 'Info:',
			labelColor: 'font-headline font-bold text-on-surface-variant',
		},
	};

	let s = $derived(styles[variant]);
</script>

<div class="{s.bg} border-l-4 {s.border} p-3 flex items-start gap-3 text-on-surface">
	<span class="material-symbols-outlined {s.iconColor}">{s.icon}</span>
	<div class="text-sm flex-1">
		<span class={s.labelColor}>{s.label}</span>
		{message}
		{#if href}
			<a class="text-primary hover:underline ml-2" {href}>Details »</a>
		{/if}
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
