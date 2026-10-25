import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type BlogEnv, handleBlog, type Statement } from "../src/server/blog-worker";

test("online articles enforce owner authentication and preserve edits", async () => {
	const database = new DatabaseSync(":memory:");
	database.exec(readFileSync(new URL("../migrations/0001_online_posts.sql", import.meta.url), "utf8"));
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
		await request("logout","POST"); assert.deepEqual(await (await request("session")).json(),{admin:false});
		assert.equal((await request("posts","PUT",article)).status,401);
		for (let i=0;i<9;i++) await request("login","POST",{password:"wrong"});
		assert.equal((await request("login","POST",{password})).status,429);
	} finally { database.close(); }
});
