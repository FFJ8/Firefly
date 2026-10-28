<script lang="ts">
	import { onMount } from "svelte";
	import { compressWebp } from "@/utils/webp-upload";
	const instanceId = $props.id();
	let avatar = $state<string | null>(null);
	let admin = $state(false);
	let preview = $state("");
	let error = $state("");
	let busy = $state(false);
	let dialog: HTMLDialogElement;
	let input: HTMLInputElement;
	async function api(path: string, options: RequestInit = {}) {
		const response = await fetch(`/api/blog/${path}`, { ...options, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
		const data = await response.json();
		if (!response.ok) {
			if (response.status === 401) admin = false;
			throw new Error(data.error || "保存失败，请重试");
		}
		return data;
	}
	function open() {
		if (!admin || busy) return;
		preview = ""; error = ""; input.value = "";
		dialog.showModal();
		// Keep the native picker in the original click gesture; do not await UI or network work.
		input.click();
	}
	async function select() {
		const file = input.files?.[0];
		if (!file) return;
		preview = ""; error = "";
		busy = true;
		try {
			preview = await compressWebp(file, { maxDimension: 512, maxBytes: 280000, square: true });
		} catch (cause) { error = cause instanceof Error ? cause.message : "无法读取图片，请重新选择"; }
		finally { busy = false; }
	}
	async function save() {
		if (!preview || busy) return;
		busy = true; error = "";
		try {
			const result = await api("avatar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatar: preview }) });
			avatar = result.avatar; window.dispatchEvent(new CustomEvent("blog-avatar-change", { detail: avatar })); dialog.close();
		} catch (cause) { error = cause instanceof Error ? cause.message : "网络不可用，请重试"; }
		finally { busy = false; }
	}
	onMount(() => {
		let active = true;
		let authChanged = false;
		api("avatar").then((data) => { if (active) avatar = data.avatar; }).catch(() => {});
		api("session").then((data) => { if (active && !authChanged) admin = data.admin; }).catch(() => {});
		const auth = (event: Event) => {
			authChanged = true; admin = (event as CustomEvent<{ admin: boolean }>).detail.admin;
			if (!admin && dialog.open) dialog.close();
		};
		const changed = (event: Event) => { avatar = (event as CustomEvent<string>).detail; };
		window.addEventListener("blog-avatar-change", changed);
		window.addEventListener("blog-auth-change", auth);
		return () => { active = false; window.removeEventListener("blog-avatar-change", changed); window.removeEventListener("blog-auth-change", auth); };
	});
</script>

{#if avatar}<img class="custom-avatar" src={avatar} alt="站长头像" width="512" height="512" />{/if}
{#if admin}<button type="button" class="change" onclick={open} disabled={busy}>更换头像</button>{/if}
<dialog bind:this={dialog} class="card-base" aria-labelledby={`${instanceId}-heading`} oncancel={(event) => { if (busy) event.preventDefault(); }}>
	<h2 id={`${instanceId}-heading`}>更换头像</h2>
	<p>选择图片后预览，保存后所有访客都能看到新头像。</p>
	<label for={`${instanceId}-file`}>选择图片（最多 10 MB，保存时自动压缩为 WebP）</label>
	<input id={`${instanceId}-file`} bind:this={input} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onchange={select} disabled={busy} />
	{#if !preview && !busy}<p class="picker-hint">若文件窗口未打开或已取消，可点击上方「选择文件」重试。</p>{/if}
	{#if preview}<img class="preview" src={preview} alt="新头像预览" width="240" height="240" />{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="actions"><button disabled={busy} onclick={() => dialog.close()}>取消</button><button class="save" disabled={!preview || busy || !admin} onclick={save}>{busy ? "正在处理……" : "保存头像"}</button></div>
</dialog>

<style>
	.custom-avatar { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 10; pointer-events: none; }
	.change { position: absolute; bottom: .6rem; right: .6rem; z-index: 20; background: var(--card-bg); color: var(--primary); border-radius: .6rem; padding: .45rem .75rem; box-shadow: 0 2px 8px #0002; }
	dialog { margin: auto; width: min(460px, calc(100vw - 2rem)); max-height: 90dvh; overflow: auto; padding: 1.5rem; border: 0; color: var(--content-meta); }
	dialog::backdrop { background: #0008; }
	h2 { font-size: 1.3rem; font-weight: bold; } p, label { display: block; margin: .8rem 0; } p { opacity: .8; }
	input { width: 100%; min-height: 44px; cursor: pointer; }
	input::file-selector-button { margin-right: .6rem; padding: .65rem .9rem; border: 0; border-radius: .6rem; background: var(--btn-regular-bg); color: var(--btn-content); cursor: pointer; }
	.picker-hint { font-size: .85rem; }
	.preview { display: block; margin: 1rem auto; border-radius: .8rem; }
	.actions { display: flex; justify-content: flex-end; gap: .7rem; margin-top: 1rem; }
	.actions button { padding: .5rem 1rem; border-radius: .6rem; background: var(--btn-regular-bg); }
	.actions .save { background: var(--primary); color: #102c23; } button:disabled { opacity: .5; cursor: not-allowed; }
	.error { color: #d33; opacity: 1; }
</style>
