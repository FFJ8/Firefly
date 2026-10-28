<script lang="ts">
	import { onMount, tick } from "svelte";
	import NewPostCard from "@/components/controls/NewPostCard.svelte";
	import { compressWebp } from "@/utils/webp-upload";

	type Kind = "dynamic" | "project" | "gallery";
	type Entry = { id: string; kind: Kind; title: string; body: string; imageIds: string[]; createdAt?: string; updatedAt?: string; revision: number };
	let { kind, label }: { kind: Kind; label: string } = $props();
	let entries = $state<Entry[]>([]);
	let active = $state<Entry | null>(null);
	let admin = $state(false);
	let loading = $state(true);
	let busy = $state(false);
	let error = $state("");
	let editorError = $state("");
	let password = $state("");
	let original = "";
	let editor: HTMLDialogElement;
	let loginDialog: HTMLDialogElement;
	let picker: HTMLInputElement;
	let titleInput: HTMLInputElement;
	const backupKey = `firefly:managed-${kind}-draft:v1`;
	const imageUrl = (id: string) => `/api/blog/media/${id}`;
	const date = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "";
	async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(`/api/blog/${path}`, { ...options, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
		const data = await response.json();
		if (!response.ok) { if (response.status === 401) admin = false; throw new Error(data.error || "操作失败，请重试"); }
		return data;
	}
	function backup() {
		if (active && JSON.stringify(active) !== original) try { localStorage.setItem(backupKey, JSON.stringify(active)); } catch { /* Keep editor open if storage is unavailable. */ }
	}
	async function load() {
		loading = true;
		try { const result = await api<{ entries: Entry[] }>(`entries?kind=${kind}`); entries = result.entries; error = ""; }
		catch (cause) { error = cause instanceof Error ? cause.message : "内容加载失败"; }
		finally { loading = false; }
	}
	async function open(entry?: Entry) {
		if (!admin) return;
		active = entry ? { ...entry, imageIds: [...entry.imageIds] } : { id: crypto.randomUUID(), kind, title: "", body: "", imageIds: [], revision: 0 };
		original = JSON.stringify(active); editorError = "";
		await tick(); editor.showModal(); titleInput.focus();
	}
	async function restore() {
		try { const draft = JSON.parse(localStorage.getItem(backupKey) || "null") as Entry | null; if (draft?.kind === kind) { await open(draft); original = ""; } }
		catch { error = "本机草稿无法读取"; }
	}
	async function login(event: SubmitEvent) {
		event.preventDefault(); busy = true; error = "";
		try { await api("login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); admin = true; password = ""; loginDialog.close(); }
		catch (cause) { error = cause instanceof Error ? cause.message : "登录失败"; }
		finally { busy = false; }
	}
	async function upload(event: Event) {
		const files = Array.from((event.currentTarget as HTMLInputElement).files || []);
		if (!active || !files.length) return;
		busy = true; editorError = "";
		try {
			for (const file of files) {
				if (active.imageIds.length >= (kind === "gallery" ? 20 : 5)) throw new Error(kind === "gallery" ? "相册最多 20 张图片" : "最多 5 张图片");
				const image = await compressWebp(file, { maxDimension: 1600, maxBytes: 350000 });
				const result = await api<{ id: string }>("media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
				active.imageIds = [...active.imageIds, result.id]; backup();
			}
		} catch (cause) { editorError = cause instanceof Error ? cause.message : "图片上传失败"; }
		finally { busy = false; picker.value = ""; }
	}
	async function finish() {
		if (!active || busy) return;
		if (!active.title.trim() && !active.body.trim() && !active.imageIds.length && active.revision === 0) { localStorage.removeItem(backupKey); editor.close(); active = null; return; }
		if (!active.title.trim()) { editorError = `请填写${label}标题`; titleInput.focus(); return; }
		if (JSON.stringify(active) === original && active.revision > 0) { editor.close(); active = null; return; }
		backup(); busy = true; editorError = "";
		try {
			await api("entries", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(active) });
			localStorage.removeItem(backupKey); editor.close(); active = null; await load();
		} catch (cause) { editorError = cause instanceof Error ? cause.message : "发布失败，草稿已保存在浏览器"; }
		finally { busy = false; }
	}
	onMount(() => {
		load();
		api<{ admin: boolean }>("session").then((result) => { admin = result.admin; }).catch(() => {});
		const auth = (event: Event) => { admin = (event as CustomEvent<{ admin: boolean }>).detail.admin; };
		window.addEventListener("blog-auth-change", auth);
		window.addEventListener("pagehide", backup);
		return () => { backup(); window.removeEventListener("blog-auth-change", auth); window.removeEventListener("pagehide", backup); };
	});
</script>

<section class="managed" aria-label={`在线${label}`}>
	<div class="toolbar">
		<h2>站长发布的{label}</h2>
		{#if !admin}<button onclick={() => loginDialog.showModal()}>站长登录</button>{/if}
	</div>
	{#if admin}<NewPostCard {label} onclick={() => open()} />{/if}
	{#if admin && typeof localStorage !== "undefined" && localStorage.getItem(backupKey)}<button class="draft" onclick={restore}>继续编辑本机草稿</button>{/if}
	{#if error}<p role="alert" class="error">{error} <button onclick={load}>重试</button></p>{/if}
	{#if loading}<p>正在加载……</p>{/if}
	<div class="cards">
		{#each entries as entry (entry.id)}
			<article id={`online-${entry.id}`} class="card-base card">
				<h3>{entry.title}</h3>
				{#if entry.body}<p class="body">{entry.body}</p>{/if}
				{#if entry.imageIds.length}<div class="images">{#each entry.imageIds as imageId}<a href={imageUrl(imageId)} target="_blank" rel="noopener noreferrer"><img src={imageUrl(imageId)} alt={`${entry.title}的图片`} loading="lazy" /></a>{/each}</div>{/if}
				<div class="foot"><time datetime={entry.updatedAt}>最后编辑：{date(entry.updatedAt)}</time>{#if admin}<button onclick={() => open(entry)}>编辑</button>{/if}</div>
			</article>
		{/each}
	</div>
</section>

<dialog bind:this={loginDialog} class="card-base panel" aria-label="站长登录"><form onsubmit={login}><h2>站长登录</h2><input type="password" bind:value={password} autocomplete="current-password" placeholder="管理员密码" required /><div class="actions"><button type="button" onclick={() => loginDialog.close()}>取消</button><button class="primary" disabled={busy}>登录</button></div></form></dialog>
<dialog bind:this={editor} class="card-base panel editor" aria-label={`编辑${label}`} oncancel={(event) => { event.preventDefault(); finish(); }}>
	{#if active}<h2>{active.revision ? `编辑${label}` : `新建${label}`}</h2>
		<p>完成后自动发布；关闭浏览器时保留本机草稿。图片会自动压缩为 WebP。</p>
		<label>标题<input bind:this={titleInput} maxlength="160" bind:value={active.title} oninput={backup} disabled={busy} /></label>
		<label>内容<textarea maxlength="10000" rows="8" bind:value={active.body} oninput={backup} disabled={busy}></textarea></label>
		<label>添加图片（最多 10 MB，{kind === "gallery" ? "最多 20 张" : "最多 5 张"}）<input bind:this={picker} type="file" accept="image/*" multiple onchange={upload} disabled={busy} /></label>
		{#if active.imageIds.length}<div class="images">{#each active.imageIds as imageId}<div class="image-edit"><img src={imageUrl(imageId)} alt="已上传图片" /><button disabled={busy} onclick={() => { if (active) { active.imageIds = active.imageIds.filter((id) => id !== imageId); backup(); } }}>移除</button></div>{/each}</div>{/if}
		{#if editorError}<p class="error" role="alert">{editorError}</p>{/if}
		<div class="actions"><button disabled={busy} onclick={finish}>{busy ? "正在处理……" : "完成并发布"}</button></div>
	{/if}
</dialog>

<style>
	.managed { margin: 1rem 0; } .toolbar, .foot, .actions { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
	.toolbar { margin-bottom: .75rem; } h2 { font-size: 1.2rem; font-weight: 700; } h3 { font-size: 1.25rem; font-weight: 700; }
	button { padding: .5rem .8rem; border-radius: .6rem; background: var(--btn-regular-bg); } .primary { background: var(--primary); color: #102c23; }
	.cards { display: grid; gap: 1rem; } .card { padding: 1.2rem; } .body { white-space: pre-wrap; margin: .75rem 0; line-height: 1.7; }
	.images { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: .5rem; margin: .75rem 0; }
	.images img { width: 100%; aspect-ratio: 1.3; object-fit: cover; border-radius: .5rem; } .image-edit { position: relative; } .image-edit button { position: absolute; right: .3rem; bottom: .3rem; }
	.foot { margin-top: .8rem; color: var(--content-meta); font-size: .85rem; } .error { color: #c33; } .draft { margin: .5rem 0; }
	.panel { margin: auto; width: min(700px, calc(100vw - 2rem)); max-height: 90dvh; overflow: auto; border: 0; padding: 1.4rem; color: var(--content-meta); }
	.panel::backdrop { background: #0008; } .panel label { display: block; margin: .8rem 0; } .panel input:not([type=file]), .panel textarea { display: block; width: 100%; padding: .7rem; border: 1px solid var(--line-divider); border-radius: .5rem; background: transparent; }
	.panel input[type=file] { display: block; width: 100%; margin-top: .4rem; } .actions { justify-content: flex-end; margin-top: 1rem; }
</style>
