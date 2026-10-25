<script lang="ts">
	import { onMount, tick } from "svelte";
	import NewPostCard from "@/components/controls/NewPostCard.svelte";
	import type { OnlinePost, SaveOnlinePost } from "@/types/online-posts";

	type Backup = SaveOnlinePost & { updated: string };
	const backupKey = "firefly:online-post-backups:v1";
	const legacyKey = "firefly:local-post-drafts:v1";
	let posts = $state<OnlinePost[]>([]);
	let backups = $state<Backup[]>([]);
	let admin = $state(false);
	let loading = $state(true);
	let more = $state(false);
	let error = $state("");
	let editorError = $state("");
	let loginError = $state("");
	let status = $state("");
	let password = $state("");
	let busy = $state(false);
	let active = $state<SaveOnlinePost | null>(null);
	let reading = $state<OnlinePost | null>(null);
	let dirty = $state(false);
	let original = "";
	let legacyId: string | null = null;
	let editor: HTMLDialogElement;
	let reader: HTMLDialogElement;
	let loginDialog: HTMLDialogElement;
	let titleInput: HTMLInputElement;
	let passwordInput: HTMLInputElement;
	let loadSequence = 0;

	async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
		const response = await fetch(`/api/blog/${path}`, {
			...options, credentials: "same-origin", cache: "no-store",
			headers: { "Content-Type": "application/json", ...options.headers },
			signal: AbortSignal.timeout(20000),
		});
		const data = await response.json();
		if (!response.ok) {
			if (response.status === 401) admin = false;
			throw new Error(data.error || "操作失败，请稍后重试");
		}
		return data;
	}
	function message(cause: unknown): string {
		return cause instanceof Error && cause.name !== "TimeoutError" && cause.name !== "TypeError"
			? cause.message : "网络暂时不可用，请重试。编辑内容仍保留在窗口中。";
	}
	function date(value: string): string {
		return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
	}
	function readBackups(): Backup[] {
		const data = JSON.parse(localStorage.getItem(backupKey) || "[]");
		if (!Array.isArray(data) || !data.every((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.body === "string" && Number.isSafeInteger(item.revision))) throw new Error("无法读取本机备份，请先下载文章");
		return data;
	}
	function refreshBackups() {
		try { backups = readBackups(); } catch (cause) { error = message(cause); }
	}
	function backup(): boolean {
		if (!active || !dirty) return true;
		try {
			const next = [{ ...active, updated: new Date().toISOString() }, ...readBackups().filter((item) => item.id !== active?.id)];
			localStorage.setItem(backupKey, JSON.stringify(next));
			backups = next;
			status = "已备份到当前浏览器，完成后自动发布";
			return true;
		} catch {
			status = "本机备份失败，请保持窗口打开，发布或下载备份后再退出";
			return false;
		}
	}
	async function load(append = false) {
		const sequence = ++loadSequence;
		loading = true;
		try {
			const result = await api<{ posts: OnlinePost[]; more: boolean }>(`posts?offset=${append ? posts.length : 0}`);
			if (sequence !== loadSequence) return;
			posts = append ? [...posts, ...result.posts.filter((post) => !posts.some((existing) => existing.id === post.id))] : result.posts;
			more = result.more;
			error = "";
		} catch (cause) { error = message(cause); }
		finally { if (sequence === loadSequence) loading = false; }
	}
	async function showLogin() {
		password = ""; loginError = "";
		loginDialog.showModal(); await tick(); passwordInput.focus();
	}
	async function login(event: SubmitEvent) {
		event.preventDefault(); busy = true; loginError = "";
		try {
			await api("login", { method: "POST", body: JSON.stringify({ password }) });
			admin = true; password = ""; loginDialog.close(); refreshBackups();
		} catch (cause) { loginError = message(cause); }
		finally { busy = false; }
	}
	async function logout() {
		try { await api("logout", { method: "POST" }); admin = false; backups = []; }
		catch (cause) { error = message(cause); }
	}
	async function edit(post?: SaveOnlinePost, fromLegacy: string | null = null) {
		if (!admin) return;
		active = post ? { id: post.id, title: post.title, body: post.body, revision: post.revision } : { id: crypto.randomUUID(), title: "", body: "", revision: 0 };
		legacyId = fromLegacy;
		original = JSON.stringify(active);
		dirty = !!fromLegacy || !!backups.find((item) => item.id === active?.id);
		editorError = ""; status = dirty ? "未发布的内容已恢复，完成后自动发布" : "完成编辑后自动发布到公网";
		if (reader.open) reader.close();
		await tick(); editor.showModal(); titleInput.focus();
	}
	function update(field: "title" | "body", value: string) {
		if (!active) return;
		active[field] = value;
		dirty = JSON.stringify(active) !== original || active.revision === 0;
		if (dirty) backup();
		else {
			try {
				backups = readBackups().filter((item) => item.id !== active?.id);
				localStorage.setItem(backupKey, JSON.stringify(backups));
			} catch { /* Keep the saved article intact if storage is unavailable. */ }
			status = "内容没有修改";
		}
	}
	async function publishAndClose() {
		if (!active || busy) return;
		if ((!dirty && active.revision > 0) || (!active.title.trim() && !active.body.trim() && active.revision === 0)) {
			try {
				backups = readBackups().filter((item) => item.id !== active?.id);
				localStorage.setItem(backupKey, JSON.stringify(backups));
			} catch { /* An empty editor is safe to close without storage. */ }
			editor.close(); active = null; dirty = false; return;
		}
		if (!active.title.trim()) { editorError = "请先填写文章标题"; titleInput.focus(); return; }
		backup(); busy = true; editorError = "";
		try {
			const published = await api<OnlinePost>("posts", { method: "PUT", body: JSON.stringify(active) });
			try {
				const remaining = readBackups().filter((item) => item.id !== published.id);
				localStorage.setItem(backupKey, JSON.stringify(remaining)); backups = remaining;
				if (legacyId) {
					const legacy = JSON.parse(localStorage.getItem(legacyKey) || "[]");
					localStorage.setItem(legacyKey, JSON.stringify(legacy.filter((item: { id: string }) => item.id !== legacyId)));
				}
			} catch { /* Publication has succeeded even if local cleanup fails. */ }
			dirty = false; active = null; legacyId = null; editor.close();
			await load();
			reading = published; await tick(); reader.showModal();
		} catch (cause) { editorError = message(cause); }
		finally { busy = false; }
	}
	async function openArticle(id: string) {
		try {
			reading = await api<OnlinePost>(`posts/${encodeURIComponent(id)}`);
			await tick(); reader.showModal();
		} catch (cause) { error = message(cause); }
	}
	function restoreLegacy() {
		try {
			const legacy = JSON.parse(localStorage.getItem(legacyKey) || "[]");
			const draft = Array.isArray(legacy) && legacy.find((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.body === "string");
			if (!draft) { error = "当前浏览器没有旧版草稿"; return; }
			// A new server ID keeps imported drafts separate from online articles.
			edit({ id: crypto.randomUUID(), title: draft.title, body: draft.body, revision: 0 }, draft.id);
		} catch { error = "无法读取旧版草稿，原数据仍保留在浏览器中"; }
	}
	function download() {
		if (!active) return;
		const blob = new Blob([`# ${active.title || "未命名文章"}\n\n${active.body}\n`], { type: "text/markdown;charset=utf-8" });
		const url = URL.createObjectURL(blob); const link = document.createElement("a");
		link.href = url; link.download = `${(active.title || "文章").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.md`; link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	onMount(() => {
		load();
		api<{ admin: boolean }>("session").then((result) => { admin = result.admin; if (admin) refreshBackups(); }).catch(() => {});
		const id = new URL(location.href).searchParams.get("article"); if (id) openArticle(id);
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (dirty) { backup(); event.preventDefault(); event.returnValue = ""; }
		};
		const hidden = () => { if (document.visibilityState === "hidden") backup(); };
		window.addEventListener("beforeunload", beforeUnload); window.addEventListener("pagehide", backup);
		document.addEventListener("visibilitychange", hidden);
		return () => {
			backup(); window.removeEventListener("beforeunload", beforeUnload);
			window.removeEventListener("pagehide", backup); document.removeEventListener("visibilitychange", hidden);
		};
	});
</script>

<section class="workspace" aria-label="文章">
	<div class="toolbar">
		<span>{admin ? "站长模式" : "文章"}</span>
		<div class="actions">
			{#if admin}
				<button class="secondary" onclick={restoreLegacy}>恢复旧草稿</button>
				<button class="secondary" onclick={logout}>退出登录</button>
			{:else}<button class="secondary" onclick={showLogin}>站长登录</button>{/if}
		</div>
	</div>
	{#if admin}<NewPostCard onclick={() => edit()} />{/if}
	{#if error}<p role="alert" class="error">{error} <button onclick={() => load()}>重试</button></p>{/if}
	{#if admin && backups.length}
		<div class="card-base backups"><h2>未发布的本机备份</h2>
			{#each backups as draft (draft.id)}<button class="secondary" onclick={() => edit(draft)}>{draft.title || "未命名文章"} · 继续编辑</button>{/each}
		</div>
	{/if}
	{#if !loading && !error && !posts.length && !admin}<div class="card-base empty">还没有发布文章</div>{/if}
	{#each posts as post (post.id)}
		<article class="card-base post-card">
			<a href={`/?article=${post.id}`} data-no-swup onclick={(event) => { event.preventDefault(); event.stopPropagation(); openArticle(post.id); }}><h2>{post.title}</h2></a>
			<p>{post.body}</p>
			<div class="post-footer"><time datetime={post.updatedAt}>最后编辑：{date(post.updatedAt)}</time>
				{#if admin}<button class="secondary" onclick={async () => {
					try { await edit(await api<OnlinePost>(`posts/${post.id}`)); } catch (cause) { error = message(cause); }
				}}>编辑</button>{/if}
			</div>
		</article>
	{/each}
	{#if loading}<p role="status">正在加载文章……</p>{/if}
	{#if more}<button class="secondary" disabled={loading} onclick={() => load(true)}>加载更多</button>{/if}
	<noscript>请启用 JavaScript 阅读在线文章。</noscript>
</section>

<dialog bind:this={loginDialog} class="panel login-panel card-base" aria-labelledby="login-heading" oncancel={() => { password = ""; }}>
	<form onsubmit={login}>
		<h2 id="login-heading">站长登录</h2>
		<label for="admin-password">管理员密码</label>
		<input bind:this={passwordInput} bind:value={password} id="admin-password" type="password" autocomplete="current-password" required maxlength="256" />
		{#if loginError}<p class="error" role="alert">{loginError}</p>{/if}
		<div class="actions"><button type="button" class="secondary" disabled={busy} onclick={() => { password = ""; loginDialog.close(); }}>取消</button><button class="done" disabled={busy}>{busy ? "正在登录……" : "登录"}</button></div>
	</form>
</dialog>

<dialog bind:this={editor} class="panel editor card-base" aria-labelledby="editor-heading" oncancel={(event) => { event.preventDefault(); publishAndClose(); }}>
	{#if active}
		<header><h2 id="editor-heading">{active.revision ? "编辑文章" : "新建文章"}</h2><div class="actions">
			<button class="secondary" onclick={download}>下载备份</button>
			<button class="done" disabled={busy || !admin} onclick={publishAndClose}>{busy ? "正在发布……" : "完成并发布"}</button>
		</div></header>
		<p class="hint">完成并退出时自动发布。直接关闭浏览器时，未发布内容会保留为本机备份。</p>
		<label for="online-title">文章标题</label>
		<input bind:this={titleInput} id="online-title" maxlength="160" value={active.title} disabled={busy} oninput={(event) => update("title", event.currentTarget.value)} />
		<label for="online-body">正文</label>
		<textarea id="online-body" maxlength="200000" placeholder="从这里开始记录……支持 Markdown" value={active.body} disabled={busy} oninput={(event) => update("body", event.currentTarget.value)}></textarea>
		{#if editorError}<p class="error" role="alert">{editorError}</p>{/if}
		{#if !admin}<button class="secondary" onclick={showLogin}>重新登录后发布</button>{/if}
		<p class="hint" role="status">{status}</p>
	{/if}
</dialog>

<dialog bind:this={reader} class="panel reader card-base" aria-labelledby="article-heading">
	{#if reading}
		<header><span>文章</span><div class="actions">{#if admin}<button class="secondary" onclick={() => edit(reading!)}>编辑文章</button>{/if}<button class="secondary" onclick={() => reader.close()}>关闭</button></div></header>
		<h1 id="article-heading">{reading.title}</h1>
		<time datetime={reading.updatedAt}>最后编辑：{date(reading.updatedAt)}（北京时间）</time>
		<div class="article-body">{@html reading.html || ""}</div>
	{/if}
</dialog>

<style>
	.workspace { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; }
	.workspace, .panel { color: var(--content-meta); }
	.toolbar, header, .post-footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; }
	.actions { display: flex; gap: .5rem; flex-wrap: wrap; }
	.secondary, .done { padding: .6rem .85rem; border-radius: .6rem; cursor: pointer; }
	.secondary { background: var(--btn-regular-bg); color: var(--btn-content); }
	.done { background: var(--primary); color: #102c23; }
	button:disabled { opacity: .6; cursor: wait; }
	.post-card, .empty, .backups { padding: 1.75rem 2.25rem; border-radius: var(--radius-large); overflow-wrap: anywhere; }
	.post-card, .empty { min-height: 240px; }
	.empty { display: grid; place-items: center; }
	h2 { font-size: 1.5rem; font-weight: 700; }
	.post-card h2 { font-size: 1.75rem; margin-bottom: .75rem; }
	.post-card a:hover { color: var(--primary); }
	.post-card p { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; margin-bottom: 1rem; }
	time, .hint { font-size: .875rem; }
	.backups h2 { font-size: 1rem; margin-bottom: .5rem; }
	.backups button { margin: .25rem; }
	.panel { position: fixed; inset: 0; margin: auto; width: min(850px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); padding: 2rem; border: 0; border-radius: var(--radius-large); background: var(--card-bg); overflow-y: auto; overscroll-behavior: contain; }
	.panel::backdrop { background: rgb(0 0 0 / .5); backdrop-filter: blur(5px); }
	.login-panel { max-width: 440px; }
	label { display: block; margin: 1rem 0 .5rem; font-weight: 600; }
	input, textarea { display: block; width: 100%; padding: .8rem 1rem; border: 1px solid color-mix(in srgb, var(--primary) 35%, transparent); border-radius: .75rem; background: var(--card-bg); color: inherit; }
	input { font-size: 1.1rem; }
	textarea { min-height: 280px; height: 38dvh; resize: vertical; line-height: 1.8; }
	.hint, .login-panel .actions { margin-top: 1rem; }
	.error { color: #a22b21; background: #fff0eb; padding: .75rem; margin: .75rem 0; border-radius: .5rem; }
	.reader h1 { font-size: 2rem; font-weight: 700; margin: 1rem 0 .5rem; overflow-wrap: anywhere; }
	.article-body { line-height: 1.9; margin-top: 1.5rem; overflow-wrap: anywhere; }
	.article-body :global(p), .article-body :global(ul), .article-body :global(ol) { margin: 1rem 0; }
	.article-body :global(h1), .article-body :global(h2), .article-body :global(h3) { font-size: 1.4rem; font-weight: 700; margin: 1.5rem 0 .75rem; }
	.article-body :global(a) { color: var(--primary); text-decoration: underline; }
	.article-body :global(img) { max-width: 100%; height: auto; border-radius: .5rem; }
	.article-body :global(pre) { overflow-x: auto; padding: 1rem; background: var(--btn-regular-bg); border-radius: .5rem; }
	.article-body :global(ul) { list-style: disc; padding-left: 1.5rem; }
	.article-body :global(ol) { list-style: decimal; padding-left: 1.5rem; }
	.article-body :global(blockquote) { border-left: 3px solid var(--primary); padding-left: 1rem; }
	.article-body :global(table) { display: block; overflow-x: auto; }
	.article-body :global(td), .article-body :global(th) { padding: .5rem; border: 1px solid var(--line-divider); }
	@media (max-width: 600px) {
		.panel { padding: 1rem; }
		.post-card, .empty, .backups { padding: 1.25rem; min-height: 200px; }
		.actions button { font-size: .875rem; }
	}
</style>
