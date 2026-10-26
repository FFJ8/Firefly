<script lang="ts">
	import { onMount } from "svelte";
	let count = $state<number | null>(null);
	onMount(() => {
		let active = true;
		let sequence = 0;
		const refresh = async () => {
			const current = ++sequence;
			try {
				const response = await fetch("/api/blog/catalog?mode=categories", { cache: "no-store", signal: AbortSignal.timeout(20000) });
				if (!response.ok) return;
				const data = await response.json() as { groups: { count: number }[] };
				if (active && sequence === current) count = data.groups.reduce((sum, group) => sum + group.count, 0);
			} catch { /* Keep the last known count when offline. */ }
		};
		refresh(); window.addEventListener("blog-posts-change", refresh);
		return () => { active = false; window.removeEventListener("blog-posts-change", refresh); };
	});
</script>
<span aria-label="归档文章数">{count ?? "…"}</span>
