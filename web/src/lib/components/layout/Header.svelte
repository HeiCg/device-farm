<script lang="ts">
	import { isAuthenticated, isAuthEnabled, clearApiKey } from '$lib/auth/auth-store.svelte.js';

	function handleLogout() {
		clearApiKey();
		window.location.href = '/login';
	}
</script>

<header class="fixed top-0 left-0 right-0 z-50 h-16 bg-background/80 backdrop-blur-xl border-b border-primary/15 shadow-[0_4px_24px_rgba(157,89,255,0.06)]">
	<div class="flex items-center justify-between px-6 h-full">
		<!-- Left: Brand -->
		<div class="flex items-center">
			<a href="/" class="text-xl font-bold tracking-tighter text-primary font-headline hover:text-primary/80 transition-colors">DEVICE_FARM</a>
		</div>

		<!-- Right: Search + Icons + Avatar -->
		<div class="flex items-center gap-3">
			<div class="hidden md:flex items-center">
				<input
					type="text"
					placeholder="Search..."
					class="bg-surface-container rounded-lg px-3 py-1.5 text-sm border border-outline-variant/30 text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:border-primary/50 w-48"
				/>
			</div>
			<button
				type="button"
				class="p-2 rounded-lg hover:bg-primary/10 hover:text-primary text-on-surface-variant transition-colors"
				aria-label="Notifications"
			>
				<span class="material-symbols-outlined text-xl">notifications</span>
			</button>
			<button
				type="button"
				class="p-2 rounded-lg hover:bg-primary/10 hover:text-primary text-on-surface-variant transition-colors"
				aria-label="Settings"
			>
				<span class="material-symbols-outlined text-xl">settings</span>
			</button>
			{#if isAuthEnabled() && isAuthenticated()}
				<button
					type="button"
					onclick={handleLogout}
					class="w-8 h-8 rounded-full border border-primary/30 bg-surface-container flex items-center justify-center cursor-pointer hover:border-primary/60 transition-colors"
					aria-label="Logout"
				>
					<span class="material-symbols-outlined text-sm text-on-surface-variant">person</span>
				</button>
			{/if}
		</div>
	</div>
</header>
