import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { OnlinePost, SaveOnlinePost } from "../types/online-posts";

type DbResult<T> = { results: T[]; meta: { changes: number } };
export interface Statement {
	bind(...values: unknown[]): Statement;
	first<T>(): Promise<T | null>;
	all<T>(): Promise<DbResult<T>>;
	run(): Promise<DbResult<unknown>>;
}
export interface BlogEnv {
	ASSETS: { fetch(request: Request): Promise<Response> };
	BLOG_DB: { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> };
	BLOG_ADMIN_CREDENTIAL: string;
}
const cookieName = "__Host-firefly_admin";
const encoder = new TextEncoder();
const fields = "id, title, body, created_at AS createdAt, updated_at AS updatedAt, revision";
const sessionDuration = 7 * 24 * 60 * 60;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), { status, headers: {
		"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff", ...headers,
	} });
}
function hex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function digest(text: string): Promise<string> {
	return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}
function sessionCookie(token: string, age = sessionDuration): string {
	return `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${age}`;
}
function tokenFrom(request: Request): string {
	const token = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
		.find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
	return /^[a-f0-9]{64}$/.test(token) ? token : "";
}
async function isAdmin(request: Request, env: BlogEnv): Promise<boolean> {
	const token = tokenFrom(request);
	if (!token || !env.BLOG_ADMIN_CREDENTIAL) return false;
	const session = await env.BLOG_DB.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ? AND credential_tag = ? AND expires_at > ?")
		.bind(await digest(token), await digest(env.BLOG_ADMIN_CREDENTIAL), Date.now()).first();
	return !!session;
}
async function readJson(request: Request, limit: number): Promise<unknown> {
	if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw new Error("JSON_REQUIRED");
	if (Number(request.headers.get("Content-Length")) > limit) throw new Error("TOO_LARGE");
	const reader = request.body?.getReader();
	if (!reader) throw new Error("JSON_REQUIRED");
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) { await reader.cancel(); throw new Error("TOO_LARGE"); }
			chunks.push(value);
		}
	} finally { reader.releaseLock(); }
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return JSON.parse(new TextDecoder().decode(bytes));
}
async function rendered(post: OnlinePost): Promise<OnlinePost> {
	return { ...post, html: sanitizeHtml(await marked.parse(post.body), {
		allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2", "del"],
		allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, img: ["src", "alt", "title"], code: ["class"] },
		allowedSchemes: ["https", "http", "mailto"],
	}) };
}
async function login(request: Request, env: BlogEnv): Promise<Response> {
	if (!env.BLOG_ADMIN_CREDENTIAL) return json({ error: "管理员登录尚未配置" }, 503);
	const payload = await readJson(request, 4096) as { password?: unknown };
	if (typeof payload?.password !== "string" || payload.password.length > 256) return json({ error: "密码格式错误" }, 400);
	const now = Date.now();
	const ip = request.headers.get("CF-Connecting-IP") || "local";
	const bucket = await digest(`${ip}:${Math.floor(now / 900000)}`);
	const attempt = await env.BLOG_DB.prepare("INSERT INTO login_attempts (bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts")
		.bind(bucket, now + 900000).first<{ attempts: number }>();
	if (!attempt || attempt.attempts > 10) return json({ error: "尝试次数过多，请 15 分钟后再试" }, 429, { "Retry-After": "900" });
	const credential = JSON.parse(env.BLOG_ADMIN_CREDENTIAL) as { salt: string; hash: string };
	const key = await crypto.subtle.importKey("raw", encoder.encode(payload.password), "PBKDF2", false, ["deriveBits"]);
	const actual = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(credential.salt), iterations: 100000, hash: "SHA-256" }, key, 256));
	let difference = actual.length ^ credential.hash.length;
	for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ (credential.hash.charCodeAt(i) || 0);
	if (difference !== 0) return json({ error: "密码不正确" }, 401);
	const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
	await env.BLOG_DB.batch([
		env.BLOG_DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
		env.BLOG_DB.prepare("DELETE FROM login_attempts WHERE expires_at < ?").bind(now),
		env.BLOG_DB.prepare("INSERT INTO admin_sessions (token_hash, credential_tag, expires_at) VALUES (?, ?, ?)").bind(await digest(token), await digest(env.BLOG_ADMIN_CREDENTIAL), now + sessionDuration * 1000),
	]);
	return json({ admin: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

export async function handleBlog(request: Request, env: BlogEnv): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/$/, "");
	if (!url.pathname.startsWith("/api/blog/")) return env.ASSETS.fetch(request);
	try {
		if (!env.BLOG_DB) return json({ error: "文章服务尚未就绪" }, 503);
		if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== url.origin) {
			return json({ error: "请求来源无效" }, 403);
		}
		if (path === "/api/blog/session" && request.method === "GET") return json({ admin: await isAdmin(request, env) });
		if (path === "/api/blog/avatar" && request.method === "GET") {
			const profile = await env.BLOG_DB.prepare("SELECT avatar FROM profile_settings WHERE id = 1").first<{ avatar: string }>();
			return json({ avatar: profile?.avatar || null });
		}
		if (path === "/api/blog/avatar" && request.method === "PUT") {
			if (!(await isAdmin(request, env))) return json({ error: "请先登录站长账号" }, 401);
			const payload = await readJson(request, 400000) as { avatar?: unknown };
			const avatar = payload?.avatar;
			if (typeof avatar !== "string" || (avatar.length - 23) % 4 !== 0 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar)) return json({ error: "请选择有效的头像图片" }, 400);
			const binary = atob(avatar.slice(23));
			if (binary.length < 4 || !binary.startsWith("\xff\xd8\xff") || !binary.endsWith("\xff\xd9")) return json({ error: "图片格式无效" }, 400);
			await env.BLOG_DB.prepare("INSERT INTO profile_settings (id, avatar, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET avatar = excluded.avatar, updated_at = excluded.updated_at")
				.bind(avatar, new Date().toISOString()).run();
			return json({ avatar });
		}
		if (path === "/api/blog/login" && request.method === "POST") return await login(request, env);
		if (path === "/api/blog/logout" && request.method === "POST") {
			const token = tokenFrom(request);
			if (token) await env.BLOG_DB.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await digest(token)).run();
			return json({ admin: false }, 200, { "Set-Cookie": sessionCookie("", 0) });
		}
		if (path === "/api/blog/posts" && request.method === "GET") {
			const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get("offset")) || 0));
			const result = await env.BLOG_DB.prepare("SELECT id, title, substr(body, 1, 240) AS body, created_at AS createdAt, updated_at AS updatedAt, revision FROM online_posts ORDER BY updated_at DESC, id DESC LIMIT 21 OFFSET ?")
				.bind(Math.floor(offset)).all<OnlinePost>();
			return json({ posts: result.results.slice(0, 20), more: result.results.length > 20 });
		}
		const id = path.slice("/api/blog/posts/".length);
		if (path.startsWith("/api/blog/posts/") && uuidPattern.test(id) && request.method === "GET") {
			const post = await env.BLOG_DB.prepare(`SELECT ${fields} FROM online_posts WHERE id = ?`).bind(id).first<OnlinePost>();
			return post ? json(await rendered(post)) : json({ error: "文章不存在" }, 404);
		}
		if (path === "/api/blog/posts" && request.method === "PUT") {
			if (!(await isAdmin(request, env))) return json({ error: "请先登录管理员账号" }, 401);
			const payload = await readJson(request, 850000) as SaveOnlinePost;
			if (!payload || typeof payload.id !== "string" || !uuidPattern.test(payload.id) || typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 160 || typeof payload.body !== "string" || payload.body.length > 200000 || !Number.isSafeInteger(payload.revision) || payload.revision < 0) {
				return json({ error: "请填写标题（最多 160 字），正文最多 20 万字" }, 400);
			}
			const previous = await env.BLOG_DB.prepare(`SELECT ${fields} FROM online_posts WHERE id = ?`).bind(payload.id).first<OnlinePost>();
			// An unchanged editor must not alter the last edited timestamp.
			if (previous && previous.revision >= payload.revision && previous.title === payload.title.trim() && previous.body === payload.body) return json(await rendered(previous));
			const now = new Date().toISOString();
			const result = payload.revision === 0
				? await env.BLOG_DB.prepare("INSERT OR IGNORE INTO online_posts (id, title, body, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, 1)").bind(payload.id, payload.title.trim(), payload.body, now, now).run()
				: await env.BLOG_DB.prepare("UPDATE online_posts SET title = ?, body = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?").bind(payload.title.trim(), payload.body, now, payload.id, payload.revision).run();
			if (!result.meta.changes) return json({ error: "文章已在其他窗口更新。你的内容已保留，请下载备份后重新打开最新文章。" }, 409);
			const post = await env.BLOG_DB.prepare(`SELECT ${fields} FROM online_posts WHERE id = ?`).bind(payload.id).first<OnlinePost>();
			return json(await rendered(post!));
		}
		return json({ error: "接口不存在或请求方式不支持" }, 404);
	} catch (error) {
		if (error instanceof SyntaxError || (error instanceof Error && error.message === "JSON_REQUIRED")) return json({ error: "请求内容格式错误" }, 400);
		if (error instanceof Error && error.message === "TOO_LARGE") return json({ error: "上传内容过大" }, 413);
		console.error("Blog request failed", error instanceof Error ? error.name : "unknown");
		return json({ error: "暂时无法保存，请稍后重试。编辑内容已保留。" }, 503);
	}
}

const worker: { fetch: typeof handleBlog } = { fetch: handleBlog };
export default worker;
