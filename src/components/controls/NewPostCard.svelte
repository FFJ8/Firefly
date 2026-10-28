<script lang="ts">
	let { onclick, label = "文章" }: { onclick: () => void; label?: string } = $props();
</script>

<button
	type="button"
	class="card-base new-post-card"
	aria-label={`新建${label}`}
	title={`新建${label}`}
	{onclick}
>
	<svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
		<path d="M32 12V52M12 32H52" stroke="currentColor" stroke-width="4" stroke-linecap="round" />
	</svg>
</button>

<style>
	.new-post-card {
		display: grid;
		place-items: center;
		width: 100%;
		min-height: 240px;
		border-radius: var(--radius-large);
		color: var(--primary);
		cursor: pointer;
		transition: box-shadow 180ms ease;
	}
	.new-post-card:hover {
		box-shadow: inset 0 0 0 2px var(--primary);
	}
	.new-post-card:focus-visible {
		outline: 2px solid var(--primary);
		outline-offset: 4px;
	}
	@media (max-width: 767px) {
		.new-post-card { min-height: 200px; }
	}
</style>
