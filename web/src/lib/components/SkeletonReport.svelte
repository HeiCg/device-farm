<!--
  Phase 37 Plan 37-01 — SkeletonReport component.

  Renders the candidate_screens grouped by module + a deep-link list,
  with confidence badges color-coded high=green / medium=yellow / low=gray
  and a CTA linking to Phase 35 exploration seeding.

  Props: { payload: SkeletonPayload; buildId: string }
-->
<script lang="ts">
	import type { SkeletonPayload } from '../../routes/builds/[id]/skeleton/+page.js';

	let { payload, buildId }: { payload: SkeletonPayload; buildId: string } = $props();

	type Screen = SkeletonPayload['candidate_screens'][number];

	// Group by module for the primary table — Svelte 5 $derived rune.
	const groupedByModule = $derived.by((): Array<[string, Screen[]]> => {
		const groups = new Map<string, Screen[]>();
		for (const screen of payload.candidate_screens ?? []) {
			const key = screen.module && screen.module !== '' ? screen.module : '(no module)';
			const bucket = groups.get(key);
			if (bucket) {
				bucket.push(screen);
			} else {
				groups.set(key, [screen]);
			}
		}
		return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
	});

	function confidenceClass(c: 'high' | 'medium' | 'low'): string {
		if (c === 'high') return 'badge badge-high';
		if (c === 'medium') return 'badge badge-medium';
		return 'badge badge-low';
	}

	// OAuth-callback heuristic — match common provider patterns even when
	// the server-side `is_oauth_callback` field is absent (Wave 1 doesn't
	// emit it; the Go CLI may add it in a follow-up).
	function isOauthCallback(scheme: string): boolean {
		const s = scheme.toLowerCase();
		return (
			s.startsWith('http') ||
			s.startsWith('https') ||
			s.includes('googleusercontent') ||
			s.startsWith('fb') ||
			s.startsWith('twitter') ||
			s.startsWith('linkedin')
		);
	}
</script>

<div class="report">
	<!-- Stats summary -->
	<div class="stats-grid">
		<div class="stat">
			<div class="stat-label">ObjC classes</div>
			<div class="stat-value">{payload.stats.total_classes}</div>
		</div>
		<div class="stat">
			<div class="stat-label">Swift types</div>
			<div class="stat-value">{payload.stats.total_swift_types}</div>
		</div>
		<div class="stat">
			<div class="stat-label">Candidate screens</div>
			<div class="stat-value">{payload.candidate_screens.length}</div>
		</div>
		<div class="stat">
			<div class="stat-label">Deep links</div>
			<div class="stat-value">{payload.deep_link_entries.length}</div>
		</div>
	</div>

	<!-- App metadata -->
	<section class="meta">
		<div><strong>Bundle ID:</strong> <code>{payload.app.bundle_id}</code></div>
		{#if payload.app.version}<div><strong>Version:</strong> {payload.app.version}</div>{/if}
		{#if payload.react_native_bundle}
			<div>
				<strong>React Native:</strong> detected ({payload.react_native_bundle.hermes
					? 'Hermes'
					: 'JSC'})
			</div>
		{/if}
	</section>

	<!-- Grouped screens table -->
	{#each groupedByModule as [moduleName, screens] (moduleName)}
		<section class="module-section">
			<h2>{moduleName}</h2>
			<table class="screens-table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Confidence</th>
						<th>Source</th>
					</tr>
				</thead>
				<tbody>
					{#each screens as s, i (s.name + i)}
						<tr>
							<td class="name-cell">{s.name}</td>
							<td>
								<span class={confidenceClass(s.confidence)}>{s.confidence}</span>
							</td>
							<td class="source-cell">{s.source}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	{/each}

	<!-- Deep links -->
	{#if payload.deep_link_entries.length > 0}
		<section class="deep-links-section">
			<h2>Deep Links</h2>
			<ul class="deep-links">
				{#each payload.deep_link_entries as link, i (link.scheme + i)}
					<li>
						<code>{link.scheme}://</code>
						{#if isOauthCallback(link.scheme)}
							<span class="oauth-badge">OAuth callback</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Known gaps -->
	{#if payload.known_gaps.length > 0}
		<section class="gaps-section">
			<h2>Known Gaps</h2>
			<ul>
				{#each payload.known_gaps as g, i (g.kind + i)}
					<li><strong>{g.kind}:</strong> {g.message}</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- CTA → Phase 35 exploration seeding -->
	<a class="cta" href="/explorations/new?seed={buildId}">
		Start exploration seeded by this skeleton
	</a>
</div>

<style>
	.report {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}
	.stats-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
	}
	.stat {
		border: 1px solid #e5e7eb;
		border-radius: 0.5rem;
		padding: 0.75rem;
	}
	.stat-label {
		font-size: 0.75rem;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.stat-value {
		font-size: 1.5rem;
		font-weight: 600;
		margin-top: 0.25rem;
	}
	.meta {
		font-size: 0.875rem;
		color: #374151;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.meta code {
		background: #f3f4f6;
		padding: 0 0.25rem;
		border-radius: 0.25rem;
	}
	.module-section h2 {
		font-size: 1.125rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.screens-table {
		width: 100%;
		border-collapse: collapse;
	}
	.screens-table thead {
		background: #f9fafb;
	}
	.screens-table th,
	.screens-table td {
		text-align: left;
		padding: 0.5rem 0.625rem;
		font-size: 0.875rem;
	}
	.screens-table tbody tr {
		border-top: 1px solid #e5e7eb;
	}
	.name-cell {
		font-family: ui-monospace, monospace;
	}
	.source-cell {
		color: #6b7280;
		font-size: 0.8125rem;
	}
	.badge {
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.badge-high {
		background: #dcfce7;
		color: #166534;
	}
	.badge-medium {
		background: #fef9c3;
		color: #854d0e;
	}
	.badge-low {
		background: #f3f4f6;
		color: #4b5563;
	}
	.deep-links-section h2,
	.gaps-section h2 {
		font-size: 1.125rem;
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
	.deep-links {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.deep-links li {
		font-family: ui-monospace, monospace;
		font-size: 0.875rem;
	}
	.oauth-badge {
		margin-left: 0.5rem;
		display: inline-block;
		padding: 0.125rem 0.5rem;
		border-radius: 0.25rem;
		background: #ede9fe;
		color: #6d28d9;
		font-size: 0.75rem;
		font-family: system-ui, sans-serif;
	}
	.cta {
		display: inline-block;
		align-self: flex-start;
		padding: 0.625rem 1rem;
		background: #2563eb;
		color: white;
		text-decoration: none;
		border-radius: 0.375rem;
		font-weight: 500;
	}
	.cta:hover {
		background: #1d4ed8;
	}
</style>
