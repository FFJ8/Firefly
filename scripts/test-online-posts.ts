import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type BlogEnv, handleBlog, type Statement } from "../src/server/blog-worker";

test("online articles enforce owner authentication and preserve edits", async () => {
	const database = new DatabaseSync(":memory:");
	database.exec(readFileSync(new URL("../migrations/0001_online_posts.sql", import.meta.url), "utf8"));
	database.exec(readFileSync(new URL("../migrations/0002_profile_avatar.sql", import.meta.url), "utf8"));
	database.exec(readFileSync(new URL("../migrations/0003_article_organization.sql", import.meta.url), "utf8"));
	database.exec(readFileSync(new URL("../migrations/0004_managed_content.sql", import.meta.url), "utf8"));
	const password = "local-test-password-only";
	const salt = "test-salt";
	class Query implements Statement {
		values: unknown[] = [];
		constructor(private sql: string) {}
		bind(...values: unknown[]): Statement { this.values = values; return this; }
		async first<T>(): Promise<T | null> { return database.prepare(this.sql).get(...this.values as never[]) as T || null; }
		async all<T>(): Promise<{results: T[]; meta: {changes: number}}> { return {results: database.prepare(this.sql).all(...this.values as never[]) as T[], meta: {changes: 0}}; }
		async run(): Promise<{results: unknown[]; meta: {changes: number}}> { return {results: [], meta: {changes: Number(database.prepare(this.sql).run(...this.values as never[]).changes)}}; }
	}
	const env: BlogEnv = {
		BLOG_ADMIN_CREDENTIAL: JSON.stringify({salt,hash:pbkdf2Sync(password,salt,100000,32,"sha256").toString("hex")}),
		BLOG_DB: {prepare: (sql) => new Query(sql), batch: (statements) => Promise.all(statements.map((statement) => statement.run()))},
		ASSETS: {fetch: async () => new Response("asset")},
	};
	let cookie = "";
	const request = (path: string, method = "GET", data?: unknown, authorized = true, origin = "https://wxyjj.top") => handleBlog(new Request(`https://wxyjj.top/api/blog/${path}`, {
		method, headers: {"Content-Type":"application/json", Origin:origin, Cookie:authorized ? cookie : "", "CF-Connecting-IP":"127.0.0.1"}, body:data === undefined ? undefined : JSON.stringify(data),
	}),env);
	try {
		assert.deepEqual(await (await request("session")).json(),{admin:false});
		const id = crypto.randomUUID();
		const article = {id,title:"标题",body:"# 正文\n<script>alert(1)</script>\n[bad](javascript:alert(1))",revision:0};
		assert.equal((await request("posts","PUT",article)).status,401);
		assert.equal((await request("login","POST",{password:"wrong"})).status,401);
		assert.equal((await request("login","POST",{password},true,"https://evil.example")).status,403);
		const loggedIn = await request("login","POST",{password});
		assert.equal(loggedIn.status,200); cookie=loggedIn.headers.get("Set-Cookie")!.split(";")[0];
		assert.match(loggedIn.headers.get("Set-Cookie")!,/HttpOnly; Secure; SameSite=Strict/);
		assert.deepEqual(await (await request("session")).json(),{admin:true});
		const avatar = "data:image/webp;base64," + Buffer.from("RIFF1234WEBP1234").toString("base64");
		assert.equal((await request("avatar", "PUT", {avatar}, false)).status, 401);
		assert.equal((await request("avatar", "PUT", {avatar}, true, "https://evil.example")).status, 403);
		assert.equal((await request("avatar", "PUT", {avatar: "data:image/svg+xml;base64,PHN2Zz4="})).status, 400);
		assert.equal((await request("avatar", "PUT", {avatar: "data:image/jpeg;base64,aGVsbG8="})).status, 400);
		assert.equal((await request("avatar", "PUT", {avatar: "x".repeat(400001)})).status, 413);
		assert.equal((await request("avatar", "PUT", {avatar})).status, 200);
		assert.deepEqual(await (await request("avatar", "GET", undefined, false)).json(), {avatar});
		assert.deepEqual(await (await request("entries?kind=dynamic", "GET", undefined, false)).json(), {entries: []});
		assert.equal((await request("media", "POST", {image: avatar}, false)).status, 401);
		assert.equal((await request("media", "POST", {image: "data:image/jpeg;base64,aGVsbG8="})).status, 400);
		const uploaded = await (await request("media", "POST", {image: avatar})).json() as {id:string;url:string};
		assert.match(uploaded.url, /^\/api\/blog\/media\//);
		const served = await request(`media/${uploaded.id}`, "GET", undefined, false);
		assert.equal(served.status, 200); assert.equal(served.headers.get("Content-Type"), "image/webp");
		const entryId = crypto.randomUUID();
		const entry = {id: entryId, kind:"gallery", title:"图片测试", body:"春天的相册", imageIds:[uploaded.id], revision:0};
		assert.equal((await request("entries", "PUT", entry, false)).status, 401);
		assert.equal((await request("entries", "PUT", {...entry, imageIds:[crypto.randomUUID()]})).status, 400);
		assert.equal((await request("entries", "PUT", entry)).status, 200);
		const gallery = await (await request("entries?kind=gallery", "GET", undefined, false)).json() as {entries:{id:string;imageIds:string[];revision:number}[]};
		assert.equal(gallery.entries[0].id, entryId); assert.deepEqual(gallery.entries[0].imageIds, [uploaded.id]); assert.equal(gallery.entries[0].revision, 1);
		assert.equal((await request("entries", "PUT", {...entry, revision:0, title:"旧窗口"})).status, 409);
		assert.equal((await request("entries", "PUT", {...entry, revision:1, title:"新标题"})).status, 200);
		const entrySearch = await (await request("search?q=春天", "GET", undefined, false)).json() as {results:{url:string}[]};
		assert.equal(entrySearch.results[0].url, `/gallery/#online-${entryId}`);
		assert.deepEqual(await (await request("overview", "GET", undefined, false)).json(), {postCount:0, characterCount:0, lastUpdated:null, categoryCount:0, tagCount:0});
		assert.deepEqual(await (await request("calendar", "GET", undefined, false)).json(), {posts:[]});
		assert.deepEqual(await (await request("search?q=正文", "GET", undefined, false)).json(), {results:[]});
		const created = await request("posts","PUT",article); assert.equal(created.status,200);
		const post = await created.json() as {revision:number;updatedAt:string;html:string};
		assert.equal(post.revision,1); assert.ok(!Number.isNaN(Date.parse(post.updatedAt)));
		assert.ok(!post.html.includes("<script>")); assert.ok(!post.html.includes("javascript:"));
		assert.equal((await request(`posts/${id}`,"GET",undefined,false)).status,200);
		assert.equal((await request("posts","PUT",{...article,revision:1,title:"attack"},false)).status,401);
		assert.equal((await request("posts","PUT",article,true,"https://evil.example")).status,403);
		const retry = await (await request("posts","PUT",article)).json() as {updatedAt:string};
		assert.equal(retry.updatedAt,post.updatedAt,"retry must not duplicate or change timestamps");
		await new Promise((resolve) => setTimeout(resolve,5));
		const edited = await (await request("posts","PUT",{...article,revision:1,body:"新正文"})).json() as {revision:number;updatedAt:string};
		assert.equal(edited.revision,2); assert.ok(edited.updatedAt > post.updatedAt);
		assert.equal((await request("posts","PUT",{...article,revision:1,body:"旧窗口内容"})).status,409);
		assert.equal((await request("posts","PUT",{...article,title:""})).status,400);
		assert.equal((await request("posts","PUT",{...article,body:"x".repeat(200001)})).status,400);
		const organized = {...article, revision: 2, body: "新正文", category: " 日常 ", tags: ["生活", "生活", " C++ & 笔记 "], series: "记录", seriesOrder: 2};
		assert.equal((await request("posts", "PUT", organized, false)).status, 401);
		const categorized = await (await request("posts", "PUT", organized)).json() as {revision: number; tags: string[]; category: string; updatedAt: string; createdAt: string};
		assert.equal(categorized.revision, 3); assert.equal(categorized.category, "日常"); assert.deepEqual(categorized.tags, ["生活", "C++ & 笔记"]);
		const overview = await (await request("overview", "GET", undefined, false)).json() as {postCount:number; categoryCount:number; tagCount:number; characterCount:number; lastUpdated:string};
		assert.equal(overview.postCount, 1); assert.equal(overview.categoryCount, 1); assert.equal(overview.tagCount, 2); assert.equal(overview.characterCount, "新正文".length); assert.equal(overview.lastUpdated, categorized.updatedAt);
		const calendar = await (await request("calendar", "GET", undefined, false)).json() as {posts:{id:string;title:string;published:string}[]};
		assert.deepEqual(calendar.posts, [{id, title:article.title, published:categorized.createdAt}]);
		for (const keyword of ["标题", "新正文", "日常", "生活", "C++ & 笔记", "记录"]) {
			const found = await (await request(`search?q=${encodeURIComponent(keyword)}`, "GET", undefined, false)).json() as {results: {url:string; title:string; excerpt:string}[]};
			const articleResult = found.results.find((result) => result.url === `/articles/?article=${id}`);
			assert.ok(articleResult, `search should find ${keyword}`);
			assert.equal(articleResult.title, article.title);
		}
		assert.deepEqual(await (await request("search?q=不存在的词", "GET", undefined, false)).json(), {results:[]});
		const same = await (await request("posts", "PUT", organized)).json() as {updatedAt: string};
		assert.equal(same.updatedAt, categorized.updatedAt);
		assert.equal((await request("posts", "PUT", {...organized, revision: 2, category: "旧分类"})).status, 409);
		assert.equal((await request("posts", "PUT", {...organized, revision: 3, tags: [5]})).status, 400);
		assert.equal((await request("posts", "PUT", {...organized, revision: 3, seriesOrder: -1})).status, 400);
		assert.equal((await request("posts", "PUT", {...organized, revision: 3, category: "x".repeat(61)})).status, 400);
		assert.equal((await request("posts", "PUT", {...organized, revision: 3, tags: Array(21).fill("tag")})).status, 400);
		for (const mode of ["categories", "tags", "series"]) {
			const data = await (await request(`catalog?mode=${mode}`, "GET", undefined, false)).json() as {groups: {name: string; count: number}[]};
			assert.ok(data.groups.length > 0); assert.equal(data.groups[0].count, 1);
		}
		const tagged = await (await request(`posts?tag=${encodeURIComponent("C++ & 笔记")}`, "GET", undefined, false)).json() as {posts: {id: string}[]};
		assert.equal(tagged.posts[0].id, id);
		const missing = await (await request("posts?category=missing")).json() as {posts: unknown[]}; assert.equal(missing.posts.length, 0);
		const oldClient = await (await request("posts", "PUT", {...article, revision: 3, body: "旧客户端仍保留元数据"})).json() as {category: string; series: string; tags: string[]; createdAt: string};
		assert.equal(oldClient.category, "日常"); assert.equal(oldClient.series, "记录"); assert.deepEqual(oldClient.tags, categorized.tags); assert.equal(oldClient.createdAt, categorized.createdAt);
		const cleared = await request("posts", "PUT", {...article, revision: 4, category: "", tags: [], series: "", seriesOrder: 0}); assert.equal(cleared.status, 200);
		assert.deepEqual(await (await request("catalog?mode=tags")).json(), {groups: []});
		assert.deepEqual(await (await request("catalog?mode=series")).json(), {groups: []});
		assert.deepEqual(await (await request("catalog?mode=categories")).json(), {groups: [{name: "", count: 1}]});
		for (let i = 0; i < 23; i++) database.prepare("INSERT INTO online_posts (id,title,body,created_at,updated_at,revision,category,tags,series,series_order) VALUES (?,?,?,'2025-01-01T00:00:00Z','2026-01-01T00:00:00Z',1,'分页','[]','测试系列',?)").run(crypto.randomUUID(), `文章 ${i}`, "正文", 23-i);
		const firstPage = await (await request("posts?series="+encodeURIComponent("测试系列"))).json() as {posts: {seriesOrder: number}[]; more: boolean};
		assert.equal(firstPage.posts.length, 20); assert.equal(firstPage.more, true); assert.equal(firstPage.posts[0].seriesOrder, 1);
		const secondPage = await (await request("posts?series="+encodeURIComponent("测试系列")+"&offset=20")).json() as {posts: {seriesOrder: number}[]; more: boolean};
		assert.equal(secondPage.posts.length, 3); assert.equal(secondPage.more, false); assert.equal(secondPage.posts[0].seriesOrder, 21);
		const archive = await (await request("posts?sort=archive")).json() as {posts: {id: string}[]}; assert.equal(archive.posts[0].id, id);
		await request("logout","POST"); assert.deepEqual(await (await request("session")).json(),{admin:false});
		assert.equal((await request("posts","PUT",article)).status,401);
		for (let i=0;i<9;i++) await request("login","POST",{password:"wrong"});
		assert.equal((await request("login","POST",{password})).status,429);
	} finally { database.close(); }
});
