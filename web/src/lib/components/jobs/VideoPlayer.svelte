<script lang="ts">
	let { jobId, artifactId }: { jobId: string; artifactId: string } = $props();

	let src = $derived(`/api/jobs/${jobId}/artifacts/${artifactId}`);
</script>

<div class="rounded-md border border-[#30363d] overflow-hidden bg-[#0d1117]">
	<video
		controls
		preload="metadata"
		{src}
		class="w-full"
	>
		<track kind="captions" />
	</video>
</div>
