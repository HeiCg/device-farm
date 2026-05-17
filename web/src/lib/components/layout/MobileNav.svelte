<script lang="ts">
	import { page } from '$app/state';

	const navItems = [
		{ href: '/', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/jobs', label: 'Jobs', icon: 'terminal' },
		{ href: '/pipelines', label: 'Pipelines', icon: 'account_tree' },
		{ href: '/devices', label: 'Devices', icon: 'developer_board' },
		{ href: '/settings', label: 'Settings', icon: 'tune' }
	];

	function isActive(href: string, pathname: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}
</script>

<nav class="fixed bottom-0 left-0 w-full h-16 z-50 md:hidden bg-background/95 backdrop-blur-xl border-t border-primary/15">
	<div class="flex justify-around items-center h-full">
		{#each navItems as item}
			{@const active = isActive(item.href, page.url.pathname)}
			{#if active}
				<a href={item.href} class="flex flex-col items-center gap-1 text-primary font-bold">
					<span class="material-symbols-outlined text-[20px]">{item.icon}</span>
					<span class="text-[10px] font-label">{item.label}</span>
				</a>
			{:else}
				<a href={item.href} class="flex flex-col items-center gap-1 text-on-surface-variant">
					<span class="material-symbols-outlined text-[20px]">{item.icon}</span>
					<span class="text-[10px] font-label">{item.label}</span>
				</a>
			{/if}
		{/each}
	</div>
</nav>
