<script lang="ts">
	import { onMount, tick } from "svelte";
	let { initialContent }: { initialContent: string } = $props();
	const instanceId = $props.id();
	let content = $state(initialContent);
	let draft = $state(initialContent);
	let admin = $state(false);
	let busy = $state(false);
	let error = $state("");
	let dialog: HTMLDialogElement;
	let editor: HTMLTextAreaElement;
	async function read() {
		const response = await fetch("/api/blog/announcement", { cache: "no-store", credentials: "same-origin" });
		if (!response.ok) throw new Error("公告暂时无法加载");
		const data = await response.json() as { content: string };
		content = data.content;
	}
	async function open() {
		if (!admin) return;
		draft = content; error = ""; await tick(); dialog.showModal(); editor.focus();
	}
	async function save() {
		if (!admin || busy) return;
		busy = true; error = "";
		try {
			const response = await fetch("/api/blog/announcement", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft }) });
			const data = await response.json() as { content?: string; error?: string };
			if (!response.ok) { if (response.status === 401) admin = false; throw new Error(data.error || "公告保存失败"); }
			content = data.content || "";
			window.dispatchEvent(new CustomEvent("blog-announcement-change", { detail: content }));
			dialog.close();
		} catch (cause) { error = cause instanceof Error ? cause.message : "公告保存失败"; }
		finally { busy = false; }
	}
	onMount(() => {
		let active = true;
		read().catch(() => {});
		fetch("/api/blog/session", { cache: "no-store", credentials: "same-origin" }).then((response) => response.json()).then((data) => { if (active) admin = data.admin; }).catch(() => {});
		const auth = (event: Event) => { admin = (event as CustomEvent<{ admin: boolean }>).detail.admin; if (!admin && dialog.open) dialog.close(); };
		const changed = (event: Event) => { content = (event as CustomEvent<string>).detail; };
		window.addEventListener("blog-auth-change", auth);
		window.addEventListener("blog-announcement-change", changed);
		return () => { active = false; window.removeEventListener("blog-auth-change", auth); window.removeEventListener("blog-announcement-change", changed); };
	});
</script>

<div class="announcement">
	<p>{content || "暂无公告"}</p>
	{#if admin}<button class="edit" type="button" onclick={open}>编辑公告</button>{/if}
</div>
<dialog bind:this={dialog} class="card-base" aria-labelledby={`${instanceId}-title`} oncancel={(event) => { if (busy) event.preventDefault(); }}>
	<h2 id={`${instanceId}-title`}>编辑公告</h2>
	<p>保存后会立即显示给所有访客。</p>
	<textarea bind:this={editor} bind:value={draft} maxlength="2000" rows="7" aria-label="公告内容"></textarea>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="actions"><button disabled={busy} onclick={() => dialog.close()}>取消</button><button class="primary" disabled={busy || !admin} onclick={save}>{busy ? "正在保存……" : "保存公告"}</button></div>
</dialog>

<style>
	.announcement p { white-space: pre-wrap; line-height: 1.65; color: var(--content-meta); }
	.edit { margin-top: .6rem; padding: .4rem .65rem; border-radius: .5rem; color: var(--primary); background: var(--btn-regular-bg); font-size: .85rem; }
	dialog { margin: auto; width: min(560px, calc(100vw - 2rem)); max-height: 90dvh; overflow: auto; border: 0; padding: 1.3rem; color: var(--content-meta); }
	dialog::backdrop { background: #0008; } h2 { font-size: 1.2rem; font-weight: 700; } dialog p { margin: .5rem 0 1rem; }
	textarea { width: 100%; padding: .7rem; border: 1px solid var(--line-divider); border-radius: .6rem; background: transparent; color: inherit; }
	.actions { display: flex; justify-content: flex-end; gap: .6rem; margin-top: 1rem; }
	.actions button { padding: .5rem .85rem; border-radius: .5rem; background: var(--btn-regular-bg); }
	.actions .primary { background: var(--primary); color: #102c23; }
	.error { color: #c33; } button:disabled { opacity: .6; }
</style>
