<script lang="ts">
	import { onMount } from "svelte";
	let { siteStartDate }: { siteStartDate: string } = $props();
	type Overview = { postCount: number; categoryCount: number; tagCount: number; characterCount: number; lastUpdated: string | null };
	let overview = $state<Overview | null>(null);
	let error = $state(false);
	let now = $state(Date.now());
	const siteStarted = Date.parse(`${siteStartDate.trim()}T00:00:00+08:00`);
	const rows = $derived([
		{ label: "文章", value: overview?.postCount.toLocaleString("zh-CN") ?? "…", icon: "▤" },
		{ label: "分类", value: overview?.categoryCount.toLocaleString("zh-CN") ?? "…", icon: "▱" },
		{ label: "标签", value: overview?.tagCount.toLocaleString("zh-CN") ?? "…", icon: "◇" },
		{ label: "正文字符", value: overview?.characterCount.toLocaleString("zh-CN") ?? "…", icon: "≡" },
		{ label: "运行天数", value: `${Math.max(1, Math.floor((now - siteStarted) / 86400000) + 1)} 天`, icon: "▣" },
		{ label: "最后文章更新", value: overview?.lastUpdated ? new Date(overview.lastUpdated).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "暂无文章", icon: "↻" },
	]);
	onMount(() => {
		let active = true;
		let controller: AbortController | null = null;
		const refresh = async () => {
			controller?.abort(); controller = new AbortController(); const current = controller;
			try {
				const response = await fetch("/api/blog/overview", { cache: "no-store", signal: current.signal });
				if (!response.ok) throw new Error("无法获取站点统计");
				const data = await response.json() as Overview;
				if (active && !current.signal.aborted) { overview = data; error = false; now = Date.now(); }
			} catch { if (active && !current.signal.aborted) error = true; }
		};
		refresh();
		const timer = setInterval(() => { now = Date.now(); refresh(); }, 60000);
		window.addEventListener("blog-posts-change", refresh);
		return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener("blog-posts-change", refresh); };
	});
</script>

<div class="stats" aria-label="站点统计">
	{#each rows as row}<div class="row"><span class="label"><span class="icon" aria-hidden="true">{row.icon}</span>{row.label}</span><strong>{row.value}</strong></div>{/each}
	{#if error}<button class="retry" onclick={() => window.dispatchEvent(new Event("blog-posts-change"))}>统计加载失败，点击重试</button>{/if}
</div>

<style>
	.stats { display: grid; gap: .45rem; padding-bottom: .1rem; }
	.row { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .35rem .5rem; min-height: 2rem; }
	.label { display: inline-flex; align-items: center; gap: .7rem; white-space: nowrap; }
	.icon { color: var(--primary); font-size: 1.2rem; width: 1.4rem; text-align: center; }
	strong { text-align: right; overflow-wrap: anywhere; font-size: .9rem; }
	.retry { color: #c34; text-align: left; padding: .4rem; }
</style>
