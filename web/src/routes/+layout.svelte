<script>
	import '../app.css';
	import Header from '$lib/components/layout/Header.svelte';
	import Nav from '$lib/components/layout/Nav.svelte';
	import MobileNav from '$lib/components/layout/MobileNav.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { isAuthenticated, isAuthEnabled, checkAuthEnabled } from '$lib/auth/auth-store.svelte.js';
	import { deviceStore } from '$lib/stores/devices.svelte.js';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { children } = $props();

	let onLoginPage = $derived(page.url?.pathname.startsWith('/login'));
	let authChecked = $state(false);

	// Phase 36 Plan 36-03 — CommandPalette ⌘K wiring.
	/** @type {{ openPalette: () => void; closePalette: () => void } | undefined} */
	let paletteRef = $state(undefined);

	onMount(async () => {
		await checkAuthEnabled();
		authChecked = true;
	});

	$effect(() => {
		if (authChecked && isAuthEnabled() && !isAuthenticated() && !onLoginPage && typeof window !== 'undefined') {
			window.location.href = '/login';
		}
	});

	// Global ⌘K (or Ctrl+K on non-mac) opens the palette. Listener attaches
	// once on mount and is torn down via the $effect return cleanup.
	$effect(() => {
		if (typeof window === 'undefined') return;
		/** @param {KeyboardEvent} e */
		function onKey(e) {
			if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
				e.preventDefault();
				paletteRef?.openPalette();
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Open the discovery WS so the palette has fresh device rows immediately.
	$effect(() => {
		deviceStore.connect();
		return () => deviceStore.disconnect();
	});

	let showDashboard = $derived(
		authChecked && (isAuthEnabled() === false || isAuthenticated())
	);
</script>

{#if !authChecked}
	<!-- Wait for auth config check -->
{:else if onLoginPage}
	{@render children()}
{:else if showDashboard}
	<div class="min-h-screen bg-background">
		<Header />
		<Nav />
		<main class="md:pl-64 pt-16 pb-20 md:pb-0 min-h-screen">
			<div class="max-w-6xl mx-auto p-6">
				{@render children()}
			</div>
		</main>
		<MobileNav />
		<CommandPalette bind:this={paletteRef} />
	</div>
{/if}
