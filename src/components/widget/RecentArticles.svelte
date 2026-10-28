<script lang="ts">
	import { onMount } from "svelte";
	import type { OnlinePost } from "@/types/online-posts";
	let { limit }: { limit: number } = $props();
	let posts = $state<OnlinePost[]>([]);
	let loading = $state(true);
	let error = $state(false);
	onMount(() => {
		let active = true;
		let controller: AbortController | null = null;
		const refresh = async () => {
			controller?.abort(); controller = new AbortController();
			try {
				const response = await fetch("/api/blog/posts", { cache: "no-store", signal: controller.signal });
				if (!response.ok) throw new Error("无法加载文章");
				const data = await response.json() as { posts: OnlinePost[] };
				if (active) { posts = data.posts.slice(0, limit); error = false; }
			} catch { if (active && !controller?.signal.aborted) error = true; }
			finally { if (active && !controller?.signal.aborted) loading = false; }
		};
		refresh();
		const timer = setInterval(refresh, 60000);
		window.addEventListener("blog-posts-change", refresh);
		return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener("blog-posts-change", refresh); };
	});
	function date(value: string) { return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
</script>

<div class="recent">
	{#if loading}<p class="empty">正在加载……</p>
	{:else if error}<button class="empty retry" onclick={() => window.dispatchEvent(new Event("blog-posts-change"))}>加载失败，点击重试</button>
	{:else if posts.length === 0}<p class="empty">暂无已发布文章</p>
	{:else}{#each posts as post}<a class="entry" href={`/articles/?article=${encodeURIComponent(post.id)}`}><time datetime={post.updatedAt}>最后编辑：{date(post.updatedAt)}</time><span>{post.title}</span></a>{/each}{/if}
	<a class="more" href="/articles/">更多文章 →</a>
</div>

<style>
	.recent { display: grid; gap: .5rem; }
	.entry { display: grid; gap: .3rem; padding: .5rem; border-radius: .5rem; min-width: 0; }
	.entry:hover { background: var(--btn-plain-bg-hover); }
	time, .more { color: var(--primary); font-size: .8rem; }
	.entry span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.more, .empty { text-align: center; padding: .65rem; }
	.retry { color: #c34; }
</style>
