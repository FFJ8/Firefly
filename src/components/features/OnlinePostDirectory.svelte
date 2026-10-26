<script lang="ts">
	import { onMount } from "svelte";
	import type { OnlinePost } from "@/types/online-posts";
	let { mode }: { mode: "archive" | "categories" | "tags" | "series" } = $props();
	const titles = { archive: "归档", categories: "分类", tags: "标签", series: "系列" };
	const keys = { archive: "", categories: "category", tags: "tag", series: "series" };
	let groups = $state<{ name: string; count: number }[]>([]);
	let posts = $state<OnlinePost[]>([]);
	let selected = $state<string | null>(null);
	let loading = $state(true);
	let error = $state("");
	let more = $state(false);
	let sequence = 0;
	async function api(path: string) {
		const response = await fetch(`/api/blog/${path}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
		if (!response.ok) throw new Error("暂时无法加载，请重试");
		return response.json();
	}
	function date(value: string) { return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }); }
	function year(value: string) { return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric" }); }
	async function load(append = false) {
		const current = ++sequence;
		loading = true; error = "";
		try {
			if (mode !== "archive" && selected === null) {
				const data = await api(`catalog?mode=${mode}`);
				if (current === sequence) groups = data.groups;
			} else {
				const query = new URLSearchParams({ sort: "archive", offset: String(append ? posts.length : 0) });
				if (mode !== "archive" && selected !== null) query.set(keys[mode], selected);
				const data = await api(`posts?${query}`);
				if (current === sequence) { posts = append ? [...posts, ...data.posts] : data.posts; more = data.more; }
			}
		} catch { if (current === sequence) error = "暂时无法加载文章，请检查网络后重试"; }
		finally { if (current === sequence) loading = false; }
	}
	function navigate(value: string | null) {
		selected = value; posts = []; more = false;
		const url = new URL(location.href);
		if (value === null) url.searchParams.delete(keys[mode]); else url.searchParams.set(keys[mode], value);
		history.pushState(null, "", url);
		load();
	}
	onMount(() => {
		const read = () => {
			selected = mode === "archive" ? null : new URL(location.href).searchParams.get(keys[mode]);
			posts = []; more = false; load();
		};
		read(); window.addEventListener("popstate", read);
		return () => { sequence++; window.removeEventListener("popstate", read); };
	});
</script>

<section class="directory" aria-label={titles[mode]}>
	<header class="card-base heading">
		<h1>{titles[mode]}{selected !== null ? ` · ${selected || "未分类"}` : ""}</h1>
		<p>{mode === "archive" ? "按首次发布时间归档" : mode === "series" ? "选择系列，按篇章顺序阅读" : `选择${titles[mode]}查看文章`}</p>
		{#if selected !== null}<button onclick={() => navigate(null)}>返回全部{titles[mode]}</button>{/if}
	</header>
	{#if error}<div class="card-base empty" role="alert">{error} <button onclick={() => load()}>重试</button></div>{/if}
	{#if mode !== "archive" && selected === null}
		<div class="groups">
			{#each groups as group}<button class="card-base group" onclick={() => navigate(group.name)}><strong>{group.name || "未分类"}</strong><span>{group.count} 篇</span></button>{/each}
		</div>
		{#if !loading && !error && groups.length === 0}<p class="card-base empty">暂无{titles[mode]}</p>{/if}
	{:else}
		{#each posts as post, index (post.id)}
			{#if mode === "archive" && (index === 0 || year(post.createdAt) !== year(posts[index - 1].createdAt))}<h2 class="year">{year(post.createdAt)}</h2>{/if}
			<article class="card-base entry">
				<a href={`/articles/?article=${post.id}`}><h2>{mode === "series" ? `${post.seriesOrder || 0}. ` : ""}{post.title}</h2></a>
				<p class="excerpt">{post.body}</p>
				<div class="meta"><time datetime={post.createdAt}>发布：{date(post.createdAt)}</time><time datetime={post.updatedAt}>最后编辑：{date(post.updatedAt)}</time></div>
				<div class="meta"><a href={`/categories/?category=${encodeURIComponent(post.category || "")}`}>{post.category || "未分类"}</a>{#each post.tags || [] as tag}<a href={`/tags/?tag=${encodeURIComponent(tag)}`}>#{tag}</a>{/each}{#if post.series}<a href={`/series/?series=${encodeURIComponent(post.series)}`}>{post.series}</a>{/if}</div>
			</article>
		{/each}
		{#if !loading && !error && posts.length === 0}<p class="card-base empty">暂无文章</p>{/if}
		{#if more && !error}<button class="more" disabled={loading} onclick={() => load(true)}>加载更多</button>{/if}
	{/if}
	{#if loading}<p class="empty" role="status">正在加载……</p>{/if}
</section>

<style>
	.directory { display: grid; gap: 1rem; color: var(--content-meta); margin-bottom: 1rem; }
	.heading, .entry { padding: 1.5rem; } h1 { font-size: 1.5rem; font-weight: bold; color: var(--primary); } h2 { font-size: 1.2rem; font-weight: bold; }
	.heading p { margin: .5rem 0; } .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
	.group { display: flex; justify-content: space-between; gap: .75rem; padding: 1.5rem; text-align: left; } strong { overflow-wrap: anywhere; }
	.group span { white-space: nowrap; } button, a { color: var(--btn-content); } a:hover { text-decoration: underline; }
	.empty { padding: 2rem; text-align: center; } .year { padding: 0 1rem; } .meta { display: flex; flex-wrap: wrap; gap: .7rem; font-size: .85rem; margin-top: .7rem; }
	.excerpt { overflow-wrap: anywhere; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-top: .75rem; }
	.more { background: var(--btn-regular-bg); border-radius: .75rem; padding: .75rem; } button:disabled { opacity: .5; }
</style>
