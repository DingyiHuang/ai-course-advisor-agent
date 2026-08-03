# B 级测试业务与技术基线（TASK-B01）

状态：已冻结

冻结日期：2026-08-03（Asia/Shanghai）

适用分支：`feature/b-level-v2`

保护标签：`b-level-baseline-20260803`

基线提交：`319d709dce71406cd87c0f9c60fa327b284334f5`

开始时 Production Deployment：`dpl_6isbAReWHqn5LTMindafXksbJs9K`（`READY`，稳定地址 HTTP 200）

本文档是 TASK-B01 唯一业务与技术基线。上一轮 SPEC、测试和证据只读保留，不覆盖、不删除。本任务仅建立 B 级开发基线、统一对话存储、Supabase 最小能力和 H5 止损判断；完成后立即停止，不进入 TASK-B02。

## 1. 已冻结的业务决策

1. 对外统一使用“检索增强的资料注入”，不以“轻量 RAG”作为主要表述。
2. 知识块采用自然语言转述，保留事实、条件关系及来源章节。
3. 禁止把主办方 Word 原文、大段原文或原始素材提交到公开仓库。
4. 面向用户的主要回答由 LLM 生成。
5. 程序负责资料检索、费用复算、事实校验、来源核对和异常拦截。
6. 费用采用 A 方案：LLM 按照五步顺序计算，程序独立复算。本任务只冻结该决定，不实现费用改造。
7. 日期问题提供资料依据，不替用户作最终报名裁决。
8. “同问不同答”使用推荐理由类问题，不使用金额或日期问题。
9. 正式测试以 20 至 24 组真实证据为目标，每组增加“改进映射”。本任务不提前执行下一阶段的正式证据生产。
10. 查看所有学生课程时应覆盖 9 个实体；总览可将线上直播合并为“三期可选”，展开后必须显示各期具体日期。本任务不修改现有课程展示规则。

## 2. 范围与禁止事项

### 2.1 本任务范围

- 保护稳定基线并在独立 feature 分支开发。
- 冻结本文档。
- 固定 `ConversationStore` 类型、接口、工厂和三种实现入口。
- 完成本地 JSON 实现及统一契约测试。
- 完成 Supabase 服务端实现、数据库迁移和不依赖真实密钥的模拟测试。
- 在用户明确确认本地及 Preview 变量已配置后，执行 Supabase 五项真实检查。
- 在 H5 形成继续 Supabase、切换 Blob 或云端配置阻塞的唯一决策，并写入 `PROGRESS.md`。

### 2.2 明确禁止

- 不修改现有课程事实、价格、日期、推荐规则和知识内容。
- 不改造检索增强的资料注入，不实现费用 A 方案。
- 不改移动端页面，不进入 TASK-B02。
- 不合并 `main`，不部署或 Promote Production，不修改 Production 环境变量。
- 不删除、跳过或弱化上一轮测试和证据。
- 不提交原始 Word、真实聊天记录、密钥、数据库响应快照或临时数据库文件。
- 不读取、输出、截图、记录或提交任何环境变量值；只允许核对变量名称是否存在。

## 3. 统一存储架构

### 3.1 唯一上层接口

上层只允许依赖一个 `ConversationStore`：

```ts
interface ConversationStore {
  createSession(input: CreateSessionInput): Promise<ChatSession>;
  appendMessage(input: AppendMessageInput): Promise<ChatMessage>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
}
```

预定目录如下；如现有路径别名需要微调，只能调整物理位置，不能改变职责：

```text
src/lib/history/
  types.ts
  conversationStore.ts
  createConversationStore.ts
  supabaseConversationStore.ts
  localJsonConversationStore.ts
  vercelBlobConversationStore.ts
```

接口、类型、工厂和三个实现的可编译空壳必须先完成，再实现具体存储。API 和页面不得判断存储类型；切换实现时不修改 API 或前端代码。

### 3.2 统一数据类型

`ChatSession` 至少包含不透明会话 ID、创建时间、更新时间和 JSON 元数据。会话 ID 由服务端生成，不接受浏览器提供的可预测固定编号。

`ChatMessage` 至少包含消息 ID、会话 ID、`user | assistant | system` 角色、正文、来源数组、JSON 元数据和创建时间。AI 消息元数据允许保存恢复 UI 所需的当前 `ConversationState`、展示数据和操作项；不得保存密钥或原始资料。来源只保存应用已经允许返回给浏览器的章节级引用信息。

三种实现必须返回相同字段和 ISO 8601 时间格式。`getMessages` 按创建时间升序返回；时间相同时使用稳定的次序键，保证单会话顺序确定。不同会话的数据严格隔离。

### 3.3 统一错误

所有实现只向上抛出 `ConversationStoreError`，至少统一以下代码：

- `invalid_input`：参数或数据结构无效。
- `session_not_found`：会话不存在。
- `configuration_error`：当前实现缺少所需变量或配置。
- `persistence_error`：底层读写失败。
- `unsupported_operation`：本阶段尚未启用的实现能力。

错误对象不得包含令牌、连接串、数据库原始响应、SQL 文本或底层堆栈。API 将错误映射为稳定的 HTTP 状态和公开错误代码，不把供应商错误原样返回浏览器。

### 3.4 工厂

`createConversationStore()` 是唯一选择入口，根据服务端环境变量返回实现：

- `CONVERSATION_STORE=supabase`
- `CONVERSATION_STORE=json`
- `CONVERSATION_STORE=blob`

缺失值或未知值返回 `configuration_error`，不静默回落到另一种存储，避免 Preview 意外使用临时文件系统。工厂及所有服务端实现必须标记为 server-only；浏览器代码不得导入它们。

## 4. API 与页面数据流

1. 页面首次加载时从浏览器本地存储读取不透明 `sessionId`；不存在时调用 `POST /api/history/sessions` 创建并保存该 ID。该 ID 是服务端生成的高熵 UUID，必须与当前可编辑的导出/测试编号分离。浏览器本地存储只保存存储会话 ID，不保存供应商配置。
2. 页面用 `GET /api/history/sessions/[sessionId]/messages` 恢复历史。动态 Route Handler 必须按 Next.js 16 约定异步取得并校验 `params`；公开端点只返回统一数据和错误。
3. 页面提交现有聊天请求时携带存储 `sessionId`。现有聊天 Route Handler 在请求函数内部惰性调用工厂，先验证会话并保存用户消息；模块加载和构建阶段不得读取或强制校验存储环境变量。未携带 `sessionId` 的既有自动测试调用继续走原业务路径，不产生存储副作用。
4. 现有 `runConversationTurn` 继续负责业务回答，课程事实、推荐和费用逻辑不变。
5. 聊天 Route Handler 保存 AI 或系统响应及其来源、展示元数据和最新会话状态快照，然后返回现有聊天响应。浏览器不得提交一条自称 AI 响应的历史记录绕过服务端生成流程。
6. 页面刷新时只调用统一历史 API 的 `getMessages`，复用现有客户端 reducer 恢复当前会话的可见消息，并从最新有效响应元数据恢复会话状态。初始化使用一次性保护和取消标记；恢复完成前禁止发送，避免开发模式重复 effect、双建会话和加载/发送竞态。
7. 用户主动重新开始会话时创建新的存储会话并替换浏览器本地会话 ID；原会话历史不删除。
8. API 和页面均不知道 Supabase、JSON 或 Blob 的具体存在；存储切换只改环境变量。
9. 写入失败必须显式返回统一错误，不得显示“已保存”或静默伪造持久化成功。现有模型失败重试语义不得被削弱；追加使用稳定消息 ID 或请求 ID 保证重试不重复写入。

本阶段只增加维持 H5 所需的最小会话 API、请求字段和刷新恢复行为，不重构现有业务编排，不实施移动端专项改版。

## 5. 三种存储实现

### 5.1 Supabase

Supabase 是 Preview 和 Production 的首选实现，但本任务只配置和验证 Preview，不配置或修改 Production。

新增迁移建立：

- `chat_sessions`
- `chat_messages`

`chat_messages.session_id` 使用外键关联 `chat_sessions.id`，并建立 `(session_id, created_at, id)` 复合索引。查询固定按 `created_at`、`id` 双重升序；第二排序键保证时间相同时结果稳定。角色、正文、来源和元数据在数据库层具有明确类型或约束。

两张表均开启 RLS，不创建匿名、登录用户或其他公开访问策略。新项目优先使用 Supabase 当前的 secret key（`sb_secret_...`），同时兼容旧的 `service_role` key。两类密钥都只允许在服务端使用；浏览器不得创建 Supabase 客户端、不得直接访问表，也不得出现带 `NEXT_PUBLIC_` 前缀的 secret key 或 service-role 变量。

服务端按以下固定顺序选择密钥，不得改变优先级或把值传到浏览器：

```ts
process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY
```

服务端客户端使用 `SUPABASE_URL` 和上述二选一密钥创建，并固定关闭 `persistSession`、`autoRefreshToken` 和 `detectSessionInUrl`，避免特权客户端吸收用户会话。两项密钥都缺失时返回 `configuration_error`。每次调用显式检查底层错误并按稳定错误码规范化，不能暴露数据库响应；`getMessages` 先查询会话是否存在，以区分“空会话”和“不存在的会话”。真实测试使用专用测试会话，清理动作只限本任务创建且已精确识别的测试数据；不得把真实响应写入快照。

### 5.2 本地 JSON

本地 JSON 用于本地开发、统一契约测试和应急本地运行，默认根目录：

```text
.data/chat-history/
```

推荐布局为每个会话单独目录、会话元数据单独文件、每条消息单独文件，避免以“读取整个会话后覆盖写回”作为追加方式。写入采用同目录临时文件加原子重命名，查询只读取指定会话目录并排序。

`.data/chat-history/` 必须进入 `.gitignore`，真实对话、测试临时目录和临时写入文件不得进入 Git。本地 JSON 不被宣称为 Vercel 长期持久化方案。

### 5.3 Vercel Blob

若 Supabase 五项通过，本阶段只要求 Blob 具备统一接口、可编译入口、统一错误和文件命名设计，不要求完整接入。

若 H5 决定切换 Blob，只有已确认 `BLOB_READ_WRITE_TOKEN` 名称存在时才允许实施和启用。每条消息使用独立对象：

```text
sessions/{sessionId}/messages/{timestamp}-{messageId}.json
```

禁止读取整个会话 JSON 后覆盖写回。查询按会话前缀列出消息并按时间排序。Blob 降级只承诺单会话顺序读写，不承诺高并发。若需要会话元数据，使用独立会话对象，不与消息数组合并覆盖。

## 6. 环境变量

`.env.example` 只增加名称和示例占位符：

```dotenv
CONVERSATION_STORE=supabase
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SUPABASE_SERVICE_ROLE_KEY=
BLOB_READ_WRITE_TOKEN=
LOCAL_HISTORY_DIR=.data/chat-history
```

`SUPABASE_SECRET_KEY` 与 `SUPABASE_SERVICE_ROLE_KEY` 二选一；新项目优先填写 `SUPABASE_SECRET_KEY`，旧项目可继续使用 `SUPABASE_SERVICE_ROLE_KEY`。二者不得使用 `NEXT_PUBLIC_` 前缀。

`.env.local` 必须继续被 `.gitignore` 忽略。只检查以下名称是否存在，不读取或输出值：

- 本地：`CONVERSATION_STORE`、`SUPABASE_URL`，以及 `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 至少一个。
- Vercel Preview：`CONVERSATION_STORE`、`SUPABASE_URL`，以及 `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 至少一个。
- Blob 降级前：`BLOB_READ_WRITE_TOKEN`

Supabase 变量未配置期间，允许完成接口、工厂、JSON、Supabase 代码、迁移和模拟测试。真实 Supabase 联调必须等待用户明确回复“Supabase本地及Preview变量已配置”。Preview 变量变更只对变更后的新部署生效；真实检查使用新 Preview，不复用旧部署得出结论。

## 7. H5 硬性止损

从 TASK-B01 实际开始累计 5 个有效工时。五项检查在真实条件具备且实现可测后立即执行，最迟不得晚于 H5：

1. 本地能够创建会话。
2. 能够保存用户和 AI 消息。
3. 能够查询并按顺序返回当前会话消息。
4. Vercel Preview 能够连接 Supabase。
5. 页面刷新后能够恢复历史消息。

决策规则：

- 五项全部通过：继续使用 Supabase，`CONVERSATION_STORE=supabase`。
- 任一关键技术项未通过：停止继续排查 Supabase；只有 `BLOB_READ_WRITE_TOKEN` 已存在时才切换并实施 Blob，不得同时修 Supabase 和推进后续任务。
- H5 时 Supabase 变量仍缺失：记为“配置条件未达成”，不得伪装成 Supabase 技术失败。
- H5 时 Supabase 未达成且 Blob 令牌也不存在：立即停止并报告“云端存储配置阻塞”，不得把 Vercel 本地 JSON 冒充为持久化存储。

`PROGRESS.md` 必须写入以下单行记录；空白处用实际结果填写，不得省略：

```text
H5检查：Supabase五项达成/未达成，未达成为：____；决定继续使用Supabase/切换Vercel Blob/云端存储配置阻塞。当前CONVERSATION_STORE=____。
```

若因配置缺失未达成，`未达成为` 必须明确写“配置条件未达成”及受影响项，不得写成连接或实现失败。

## 8. 测试基线

统一存储契约测试至少覆盖：

1. `createSession` 返回有效会话 ID。
2. `appendMessage` 能写入用户消息。
3. `appendMessage` 能写入 AI 消息和来源信息。
4. `getMessages` 按创建时间返回消息。
5. 不存在的会话返回统一错误。
6. 不同会话的数据不能混合。
7. 存储实现切换不影响 API 调用方式。
8. 本地 JSON 目录不进入 Git。

本地 JSON 使用隔离的临时测试目录。Supabase 采用模拟客户端或 HTTP 边界测试来覆盖成功、顺序和错误规范化；真实联调另行记录，不把密钥或数据库响应写入快照。若 H5 启用 Blob，同一套契约必须在 Blob 实现上通过。

原有测试不得删除、跳过或弱化。最终必须通过：

- 新增定向测试和全量测试。
- TypeScript 类型检查。
- ESLint。
- Next.js Production Build。
- `git diff --check`。
- 工作区变更范围检查。
- 敏感信息名称与内容扫描；报告只列规则和结论，不显示疑似值。

## 9. 完成标准

TASK-B01 只有在以下条件全部满足时才完成：

1. 本文档已创建并包含全部冻结决策。
2. `ConversationStore` 接口已固定。
3. 三个实现具有统一入口。
4. Supabase 最小存储功能通过，或已严格按 H5 规则切换 Blob；若两类云端配置都缺失，则任务保持阻塞而不能假称完成。
5. `PROGRESS.md` 已记录 H5 决策。
6. `.env.example` 和 `.gitignore` 已更新。
7. 新增测试全部通过。
8. 原有测试无删除、跳过或弱化。
9. TypeScript、ESLint、Production Build 和 `git diff --check` 全部通过。
10. 工作区变更范围和敏感信息扫描通过。

完成后只报告任务卡要求的十一项结果，并立即停止等待下一张任务卡。
