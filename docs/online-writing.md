# 在线写作

首页使用 Cloudflare Worker 和 D1 提供在线文章。访客只能阅读；管理员登录后才显示新建、编辑和旧草稿恢复入口。文章正文支持 Markdown，服务端清理渲染后的 HTML。

## 使用

1. 首页点击「站长登录」，输入管理员密码。
2. 点击「＋」或已发布文章的「编辑」。
3. 点击「完成并发布」，或按 Escape 完成编辑，保存成功后所有访客可见。保存失败时保留编辑窗口。
4. 输入过程中会在当前浏览器备份。直接关闭浏览器会提示有未发布内容；这种情况下不会假装已完成网络上传，下次登录可恢复备份。

文章内显示服务器记录的最后编辑时间（北京时间）。没有实际修改时不改变时间。多窗口修改使用版本检查，拒绝用旧内容覆盖新版本。

旧版私密草稿不会自动公开。登录后点击「恢复旧草稿」，检查内容并完成发布；发布成功后才清除相应旧草稿。

## 部署

- `pnpm build` 生成静态资源。
- `pnpm exec wrangler d1 migrations apply firefly-articles --remote` 初始化数据库结构。
- `pnpm exec wrangler deploy` 发布静态资源和 API 到同一 Worker。GitHub 自动部署也必须使用此 Wrangler 配置，不能只上传静态文件。
- D1 绑定、原有域名在 `wrangler.jsonc` 中。正文存于 D1，网站重新构建不会删除文章。
- `BLOG_ADMIN_CREDENTIAL` 必须设置为 Worker secret，内容为 JSON：`{"salt":"随机盐","hash":"PBKDF2-SHA256 的十六进制结果"}`。使用 100000 次迭代，输出 32 字节，盐按 UTF-8 编码。
- 初始密码存于站长本机的登录信息文件，不能提交到仓库。更换密码时生成新盐与哈希，并通过 `wrangler secret put BLOG_ADMIN_CREDENTIAL` 更新；旧会话会立即失效。
- `.dev.vars` 仅用于本机测试，已加入 Git 忽略。生产环境没有正确 secret 时管理员登录关闭。

会话令牌使用随机 256 位值，仅以哈希存储于数据库；Cookie 使用 HttpOnly、Secure、SameSite=Strict。写入请求必须同源并通过会话检查。登录按 IP 每 15 分钟最多尝试 10 次，失败不会泄露密码信息。

## 验证

`pnpm check`、`pnpm type-check`、`pnpm build`，以及 `pnpm exec tsx --test scripts/test-online-posts.ts`。

本地真实运行使用 `pnpm exec wrangler d1 migrations apply firefly-articles --local` 和 `pnpm exec wrangler dev --local`，不应使用仅提供静态资源的 `astro preview` 来验证在线 API。

参考：[Cloudflare 静态资源路由](https://developers.cloudflare.com/workers/static-assets/binding/)、[D1 Workers API](https://developers.cloudflare.com/d1/worker-api/)、[Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)。
