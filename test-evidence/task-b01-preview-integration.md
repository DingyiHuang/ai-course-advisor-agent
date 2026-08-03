# TASK-B01 Preview 云端联调记录

- 联调时间：2026-08-03（Asia/Shanghai）
- 分支：`feature/b-level-v2`
- Git SHA：`34b873d929e076ddc1545c2a36effc27e71680f9`
- Deployment ID：`dpl_EfvwSToiRhPGtVQiwetFGASWRnQb`
- Deployment Target：Preview（Vercel API 返回 `target=null`）
- Deployment 状态：`READY`
- 创建时间：2026-08-03 16:06:52（Asia/Shanghai）
- Preview 地址：`https://ai-course-advisor-agent-4ew498mjn-projectmanagement1.vercel.app`
- Production：未部署、未 Promote、未修改

## Preview 变量名称与环境

根据参赛人已确认的 Vercel Preview 配置元数据，以下名称均适用于 Preview；本次只核对名称和环境标签，未读取、显示或记录任何变量值：

- `CONVERSATION_STORE`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TIMEOUT_MS`

名称与 TASK-B01 冻结 SPEC 及运行时代码一致。`SUPABASE_URL` 的值未读取；仅采用参赛人关于其为项目基础地址且不含 `/rest/v1/` 的确认。

## Supabase 五项

1. 创建会话：通过。本地阶段已通过；Preview `POST /api/history/sessions` 返回 HTTP 201 和服务端 UUID。
2. 保存用户和 AI 消息：通过。Preview `POST /api/chat` 返回 HTTP 200，历史中保存 1 条用户消息和 1 条 AI 消息。
3. 查询顺序：通过。Preview 历史接口返回 HTTP 200、共 2 条，顺序为 `user > assistant`；用户内容与提交内容一致，AI 内容与聊天响应一致。
4. Preview 连接 Supabase：通过。Git Integration 部署为 `READY`，Preview 上的创建、写入和查询均真实成功。
5. 页面刷新恢复：通过。隔离 Chrome 会话完成真实对话，刷新后保持同一 sessionId，历史角色、条数和内容完全一致，页面重新显示全部历史消息。

结论：五项全部达成，继续使用 Supabase，`CONVERSATION_STORE=supabase`。

H5 累计有效工时：1 小时 0 分 36 秒。第三阶段于 2026-08-03 16:19:41（Asia/Shanghai）停止计时。

## 会话隔离与安全

- API 会话 A：`4cca4a3c-de24-44ee-92c1-d416b6515532`，历史 2 条。
- API 会话 B：`6c2b8a7f-f6b0-449b-980c-680b5d6e821e`，创建后历史 0 条；与会话 A 不同且未读取会话 A 内容。
- 浏览器点击“重新开始”后生成不同 UUID；新会话历史不含第一会话内容，刷新后仍保持新会话且无串话。
- 浏览器 `localStorage` 只有 `ai-course-advisor.sessionId`；其值为 UUID。未发现 `SUPABASE_SECRET_KEY`、service-role 标识或其他本地存储键。
- 不存在会话的历史查询返回 HTTP 404、`Content-Type: application/json`，正文仅有 `error=session_not_found`；未出现数据库、Supabase、URL、密钥、Authorization、Bearer 或请求头信息。
- Preview 开启 Vercel Authentication；测试使用临时访问会话，临时链接和令牌未写入仓库或本记录。

## 部署前自动检查

- 全量测试：23 个文件、301 项全部通过。
- TypeScript：通过。
- ESLint：通过。
- Next.js Production Build：通过。
- `git diff --check`：通过。
- 敏感扫描：Supabase secret、常见供应商/API token、JWT、私钥材料、实际 Supabase 项目 URL、公开 secret 变量名六类规则均无命中；`.env.local` 未跟踪。
- Build 非阻断警告：Local JSON 存储的动态文件路径触发 Turbopack NFT 整项目追踪提示；不影响本次 Supabase Preview 功能，列为剩余构建体积风险。

## SPEC 偏离与剩余风险

- SPEC 偏离：无。
- Preview 受 Vercel Authentication 保护，未认证请求由 Vercel 平台返回 401；应用 API 联调均在已认证临时会话中完成。
- 尚未进行高并发、多地域或长时间稳定性测试。
- 本任务未修改 Production，Production 尚未验证本次持久化功能；这是边界要求，不构成 TASK-B01 偏离。
