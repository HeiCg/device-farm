<script lang="ts">
	let { onchange }: { onchange: (filters: { status: string; platform: string }) => void } =
		$props();

	let status = $state('');
	let platform = $state('');

	function handleChange() {
		onchange({ status, platform });
	}
</script>

<div class="flex flex-row gap-2">
	<select
		bind:value={status}
		onchange={handleChange}
		class="rounded-md border border-outline-variant/20 bg-surface-container px-3 py-[5px] text-[13px] text-on-surface shadow-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
	>
		<option value="">Status</option>
		<option value="queued">Queued</option>
		<option value="running">Running</option>
		<option value="passed">Passed</option>
		<option value="failed">Failed</option>
		<option value="cancelled">Cancelled</option>
		<option value="timeout">Timeout</option>
	</select>

	<select
		bind:value={platform}
		onchange={handleChange}
		class="rounded-md border border-outline-variant/20 bg-surface-container px-3 py-[5px] text-[13px] text-on-surface shadow-none focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
	>
		<option value="">Platform</option>
		<option value="android">Android</option>
		<option value="ios">iOS</option>
	</select>
</div>
