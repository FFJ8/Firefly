<script lang="ts">
	import { onMount, tick } from "svelte";
	import NewPostCard from "@/components/controls/NewPostCard.svelte";

	type Draft = { id: string; title: string; body: string; updated: string };
	const storageKey = "firefly:local-post-drafts:v1";
	let drafts = $state<Draft[]>([]);
	let active = $state<Draft | null>(null);
	let ready = $state(false);
	let error = $state("");
	let saved = $state("");
	let dirty = false;
	let dialog: HTMLDialogElement;
	let titleInput: HTMLInputElement;

	function readDrafts(): Draft[] {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed) || !parsed.every((item) =>
			item && typeof item.id === "string" && typeof item.title === "string" &&
			typeof item.body === "string" && typeof item.updated === "string" &&
			!Number.isNaN(Date.parse(item.updated)))) {
			throw new Error("Invalid drafts");
		}
		return parsed;
	}

	function refresh() {
		try {
			drafts = readDrafts().sort((a, b) => b.updated.localeCompare(a.updated));
			error = "";
		} catch {
			error = "无法读取浏览器草稿。请勿清除浏览器数据；已打开的文章可先下载备份。";
		}
	}

	function save(): boolean {
		if (!active || !dirty) return true;
		try {
			const current = readDrafts();
			if (!active.title.trim() && !active.body.trim() && !current.some((d) => d.id === active?.id)) {
				dirty = false;
				return true;
			}
			const next: Draft = { ...active, updated: new Date().toISOString() };
			const merged = [next, ...current.filter((d) => d.id !== next.id)]
				.sort((a, b) => b.updated.localeCompare(a.updated));
			localStorage.setItem(storageKey, JSON.stringify(merged));
			active = next;
			drafts = merged;
			dirty = false;
			error = "";
			saved = "已自动保存到当前浏览器";
			return true;
		} catch {
			saved = "";
			error = "自动保存失败，浏览器可能禁用了存储或空间已满。请先下载文章备份，再退出。";
			return false;
		}
	}

	async function openDraft(draft?: Draft) {
		active = draft ? { ...draft } : {
			id: crypto.randomUUID(), title: "", body: "", updated: new Date().toISOString(),
		};
		dirty = false;
		saved = draft ? "已自动保存到当前浏览器" : "输入后自动保存";
		await tick();
		dialog.showModal();
		titleInput.focus();
	}

	function update(field: "title" | "body", value: string) {
		if (!active) return;
		active[field] = value;
		dirty = true;
		save();
	}

	function close() {
		if (!save()) return;
		dialog.close();
		active = null;
	}

	function download() {
		if (!active) return;
		const text = `# ${active.title || "未命名文章"}\n\n${active.body}\n`;
		const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = `${(active.title || "未命名文章").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.md`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	onMount(() => {
		refresh();
		ready = true;
		const onVisibility = () => { if (document.visibilityState === "hidden") save(); };
		const onUnload = (event: BeforeUnloadEvent) => {
			if (!save()) { event.preventDefault(); event.returnValue = ""; }
		};
		const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) refresh(); };
		window.addEventListener("pagehide", save);
		window.addEventListener("beforeunload", onUnload);
		window.addEventListener("storage", onStorage);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			save();
			window.removeEventListener("pagehide", save);
			window.removeEventListener("beforeunload", onUnload);
			window.removeEventListener("storage", onStorage);
			document.removeEventListener("visibilitychange", onVisibility);
		};
	});
</script>

<section class="workspace" aria-label="我的文章草稿" data-pagefind-ignore>
	<NewPostCard onclick={() => { if (ready) openDraft(); }} />
	<noscript><p>请启用 JavaScript，以新建文章和保存草稿。</p></noscript>
	{#if error && !active}<p class="error" role="alert">{error}</p>{/if}
	{#each drafts as draft (draft.id)}
		<button type="button" class="card-base draft-card" onclick={() => openDraft(draft)}>
			<span class="draft-label">私密草稿 · 仅当前浏览器</span>
			<h2>{draft.title || "未命名文章"}</h2>
			<p>{draft.body.slice(0, 180) || "点击继续写作"}</p>
			<time datetime={draft.updated}>{new Date(draft.updated).toLocaleString("zh-CN")}</time>
		</button>
	{/each}
</section>

<dialog bind:this={dialog} class="editor card-base" aria-labelledby="editor-heading"
	oncancel={(event) => { event.preventDefault(); close(); }}>
	{#if active}
		<header>
			<h2 id="editor-heading">写文章</h2>
			<div class="actions">
				<button type="button" class="secondary" onclick={download}>下载文章</button>
				<button type="button" class="done" onclick={close}>完成并退出</button>
			</div>
		</header>
		<p class="privacy">草稿仅保存在当前浏览器，不会公开发布。清除网站数据会删除草稿。</p>
		<label for="draft-title">文章标题</label>
		<input bind:this={titleInput} id="draft-title" placeholder="给文章起个标题" value={active.title}
			oninput={(event) => update("title", event.currentTarget.value)} />
		<label for="draft-body">正文</label>
		<textarea id="draft-body" placeholder="从这里开始记录……（支持 Markdown 文本）" value={active.body}
			oninput={(event) => update("body", event.currentTarget.value)}></textarea>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<p class="save-status" role="status">{saved}</p>
	{/if}
</dialog>

<style>
	.workspace, .editor { color: var(--content-meta); }
	.editor { background: var(--card-bg); }
	.workspace { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1rem; }
	.draft-card { width: 100%; min-height: 240px; padding: 1.75rem 2.25rem; border-radius: var(--radius-large); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
	.draft-label, time, .privacy, .save-status { font-size: .875rem; color: var(--primary); }
	.draft-card h2 { font-size: 1.75rem; font-weight: 700; margin: .5rem 0; }
	.draft-card p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin-bottom: 1rem; white-space: pre-wrap; }
	.editor { position: fixed; inset: 0; margin: auto; width: min(850px, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); padding: 2rem; border: 0; border-radius: var(--radius-large); overflow-y: auto; overscroll-behavior: contain; }
	.editor::backdrop { background: rgb(0 0 0 / .5); backdrop-filter: blur(5px); }
	header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
	header h2 { font-size: 1.5rem; font-weight: 700; }
	.actions { display: flex; gap: .5rem; }
	.actions button { padding: .6rem .85rem; border-radius: .6rem; cursor: pointer; }
	.done { background: var(--primary); color: #102c23; }
	.secondary { color: var(--primary); background: var(--btn-regular-bg); }
	.privacy { margin-bottom: 1rem; color: inherit; opacity: .7; }
	label { display: block; margin: 1rem 0 .5rem; font-weight: 600; }
	input, textarea { display: block; width: 100%; padding: .8rem 1rem; border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent); border-radius: .75rem; background: var(--card-bg); color: inherit; }
	input { font-size: 1.3rem; }
	textarea { min-height: 300px; height: 38dvh; resize: vertical; line-height: 1.8; }
	.save-status { margin-top: .75rem; min-height: 1.25rem; }
	.error { color: #c0392b; padding: .75rem; background: #fff0eb; border-radius: .5rem; }
	@media (max-width: 600px) {
		.editor { padding: 1rem; }
		header { flex-wrap: wrap; }
		.draft-card { padding: 1.25rem; min-height: 200px; }
		.actions button { font-size: .875rem; }
	}
</style>
