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
const fields = "id, title, body, created_at AS createdAt, updated_at AS updatedAt, revision, category, tags, series, series_order AS seriesOrder";
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
type StoredPost = Omit<OnlinePost, "tags"> & { tags: string };
function decodePost(post: StoredPost): OnlinePost {
	return { ...post, tags: JSON.parse(post.tags) as string[] };
}
async function rendered(post: StoredPost): Promise<OnlinePost> {
	return { ...decodePost(post), html: sanitizeHtml(await marked.parse(post.body), {
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
		if (path === "/api/blog/overview" && request.method === "GET") {
			const summary = await env.BLOG_DB.prepare("SELECT COUNT(*) AS postCount, COALESCE(SUM(length(body)), 0) AS characterCount, MAX(updated_at) AS lastUpdated FROM online_posts")
				.first<{ postCount: number; characterCount: number; lastUpdated: string | null }>();
			const categories = await env.BLOG_DB.prepare("SELECT COUNT(DISTINCT category) AS count FROM online_posts WHERE category != ''").first<{ count: number }>();
			const tags = await env.BLOG_DB.prepare("SELECT COUNT(DISTINCT value) AS count FROM online_posts, json_each(online_posts.tags)").first<{ count: number }>();
			return json({ postCount: summary?.postCount || 0, characterCount: summary?.characterCount || 0, lastUpdated: summary?.lastUpdated || null, categoryCount: categories?.count || 0, tagCount: tags?.count || 0 });
		}
		if (path === "/api/blog/calendar" && request.method === "GET") {
			const result = await env.BLOG_DB.prepare("SELECT id, title, created_at AS published FROM online_posts ORDER BY created_at DESC, id DESC").all<{ id: string; title: string; published: string }>();
			return json({ posts: result.results });
		}
		if (path === "/api/blog/search" && request.method === "GET") {
			const query = (url.searchParams.get("q") || "").trim();
			if (!query) return json({ results: [] });
			if (query.length > 100) return json({ error: "搜索词不能超过 100 字" }, 400);
			const result = await env.BLOG_DB.prepare(`SELECT id, title, body, category, tags, series FROM online_posts
				WHERE instr(lower(title), lower(?)) > 0 OR instr(lower(body), lower(?)) > 0
				OR instr(lower(category), lower(?)) > 0 OR instr(lower(tags), lower(?)) > 0
				OR instr(lower(series), lower(?)) > 0 ORDER BY updated_at DESC, id DESC`)
				.bind(query, query, query, query, query).all<{ id: string; title: string; body: string; category: string; tags: string; series: string }>();
			const needle = query.toLocaleLowerCase();
			return json({ results: result.results.map((post) => {
				const fields = [post.title, post.body, post.category, ...JSON.parse(post.tags) as string[], post.series];
				const matched = fields.find((value) => value.toLocaleLowerCase().includes(needle)) || post.title;
				const index = matched.toLocaleLowerCase().indexOf(needle);
				const excerpt = matched.slice(Math.max(0, index - 45), index + query.length + 75).replace(/\s+/g, " ");
				return { url: `/articles/?article=${encodeURIComponent(post.id)}`, title: post.title, excerpt };
			}) });
		}
		if (path === "/api/blog/catalog" && request.method === "GET") {
			const mode = url.searchParams.get("mode");
			const query = mode === "categories" ? "SELECT category AS name, COUNT(*) AS count FROM online_posts GROUP BY category ORDER BY count DESC, name"
				: mode === "tags" ? "SELECT value AS name, COUNT(*) AS count FROM online_posts, json_each(online_posts.tags) GROUP BY value ORDER BY count DESC, name"
				: mode === "series" ? "SELECT series AS name, COUNT(*) AS count FROM online_posts WHERE series != '' GROUP BY series ORDER BY name" : null;
			if (!query) return json({ error: "目录类型无效" }, 400);
			return json({ groups: (await env.BLOG_DB.prepare(query).all<{ name: string; count: number }>()).results });
		}
		if (path === "/api/blog/posts" && request.method === "GET") {
			const offset = Math.max(0, Math.min(100000, Number(url.searchParams.get("offset")) || 0));
			const conditions: string[] = [];
			const values: unknown[] = [];
			for (const field of ["category", "series"] as const) {
				if (url.searchParams.has(field)) { conditions.push(`${field} = ?`); values.push(url.searchParams.get(field)); }
			}
			if (url.searchParams.has("tag")) { conditions.push("EXISTS (SELECT 1 FROM json_each(online_posts.tags) WHERE value = ?)"); values.push(url.searchParams.get("tag")); }
			const order = url.searchParams.has("series") ? "series_order ASC, created_at ASC, id ASC"
				: url.searchParams.get("sort") === "archive" ? "created_at DESC, id DESC" : "updated_at DESC, id DESC";
			const result = await env.BLOG_DB.prepare(`SELECT ${fields.replace("title, body,", "title, substr(body, 1, 240) AS body,")} FROM online_posts ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY ${order} LIMIT 21 OFFSET ?`)
				.bind(...values, Math.floor(offset)).all<StoredPost>();
			return json({ posts: result.results.slice(0, 20).map(decodePost), more: result.results.length > 20 });
		}
		const id = path.slice("/api/blog/posts/".length);
		if (path.startsWith("/api/blog/posts/") && uuidPattern.test(id) && request.method === "GET") {
			const post = await env.BLOG_DB.prepare(`SELECT ${fields} FROM online_posts WHERE id = ?`).bind(id).first<StoredPost>();
			return post ? json(await rendered(post)) : json({ error: "文章不存在" }, 404);
		}
		if (path === "/api/blog/posts" && request.method === "PUT") {
			if (!(await isAdmin(request, env))) return json({ error: "请先登录管理员账号" }, 401);
			const payload = await readJson(request, 850000) as SaveOnlinePost;
			if (!payload || typeof payload.id !== "string" || !uuidPattern.test(payload.id) || typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 160 || typeof payload.body !== "string" || payload.body.length > 200000 || !Number.isSafeInteger(payload.revision) || payload.revision < 0) {
				return json({ error: "请填写标题（最多 160 字），正文最多 20 万字" }, 400);
			}
			const previous = await env.BLOG_DB.prepare(`SELECT ${fields} FROM online_posts WHERE id = ?`).bind(payload.id).first<StoredPost>();
			const category = payload.category ?? previous?.category ?? "";
			const series = payload.series ?? previous?.series ?? "";
			const seriesOrder = payload.seriesOrder ?? previous?.seriesOrder ?? 0;
			const inputTags = payload.tags ?? (previous ? JSON.parse(previous.tags) : []);
			if (typeof category !== "string" || category.length > 60 || typeof series !== "string" || series.length > 60 || !Number.isSafeInteger(seriesOrder) || seriesOrder < 0 || seriesOrder > 100000 || !Array.isArray(inputTags) || inputTags.length > 20 || inputTags.some((tag: unknown) => typeof tag !== "string" || tag.length > 40)) return json({ error: "分类和系列最多 60 字；标签最多 20 个，每个最多 40 字；系列顺序须为 0 到 100000 的整数" }, 400);
			const tags = JSON.stringify([...new Set(inputTags.map((tag: string) => tag.trim()).filter(Boolean))]);
			// An unchanged editor must not alter the last edited timestamp.
			if (previous && previous.revision >= payload.revision && previous.title === payload.title.trim() && previous.body === payload.body && previous.category === category.trim() && previous.series === series.trim() && previous.seriesOrder === seriesOrder && previous.tags === tags) return json(await rendered(previous));
			const now = new Date().toISOString();
			const result = payload.revision === 0
				? await env.BLOG_DB.prepare("INSERT OR IGNORE INTO online_posts (id, title, body, created_at, updated_at, revision, category, tags, series, series_order) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)").bind(payload.id, payload.title.trim(), payload.body, now, now, category.trim(), tags, series.trim(), seriesOrder).run()
				: await env.BLOG_DB.prepare("UPDATE online_posts SET title = ?, body = ?, updated_at = ?, revision = revision + 1, category = ?, tags = ?, series = ?, series_order = ? WHERE id = ? AND revision = ?").bind(payload.title.trim(), payload.body, now, category.trim(), tags, series.trim(), seriesOrder, payload.id, payload.revision).run();
			if (!result.meta.changes) return json({ error: "文章已在其他窗口更新。你的内容已保留，请下载备份后重新打开最新文章。" }, 409);
			const post = await env.BLOG_DB.prepare(`SELECT ${fields} FROM online_posts WHERE id = ?`).bind(payload.id).first<StoredPost>();
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
