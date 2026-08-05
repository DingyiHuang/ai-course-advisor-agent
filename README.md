# AI课程顾问 Agent

AI课程顾问 Agent 是面向 OPC“首届软件与智能体开发大赛”的 B 级交付作品。项目围绕学生及家长、教师、机构及学校三类用户，提供基于参赛资料边界的课程咨询、资料问答、费用复算、连续追问、来源展示、会话持久化和 Markdown 导出能力。系统的基本原则是：事实和规则由程序校验，面向用户的自然语言由大模型在已注入资料范围内生成，最终回答再由程序进行金额、日期、实体、来源和 `usedChunkIds` 校验。

## 访问与交付

- Production 正式地址：https://ai-course-advisor-agent.vercel.app
- Public GitHub：[DingyiHuang/ai-course-advisor-agent](https://github.com/DingyiHuang/ai-course-advisor-agent)
- 测试记录表：`E:/桌面/【比赛资料】/【B级测试】/交付物/03_AI课程顾问测试记录表.xlsx`
- 仓库内证据目录：`test-evidence/`
- 发布回归证据目录：`E:/桌面/【比赛资料】/【B级测试】/发布证据/`

发布状态：2026-08-05 已完成 Preview 回归、B05R 全量验证、`main` 合并和 Production 发布。应用功能基线为 `a7106c36f45ac03b8bedfa42283cd3388991e8b1`；后续文档收口提交不修改应用逻辑。Preview 环境仅用于回归验证，因 Vercel 访问保护会跳转登录页，不作为评委提交演示链接。

普通 Production 页面不显示内部诊断、Prompt、知识块 ID 或 Viewport Debug。测试模式和脱敏证据模式只用于本地或 Preview 验证，不作为普通 Production 页面能力展示。

## 用户范围

系统显式区分三类身份，不在身份未确认时直接推荐课程。

- 学生及家长：咨询暑期 AI 素养夏令营，支持北京线下、上海线下和线上直播组合；根据地区、营期、授课形式、是否可出行、回放需求和食宿选择推荐真实班型。
- 教师：咨询 L1、L2、L3、暑期集训和周末研修；根据起始水平、目标等级、能否脱岗、时间形式、前置条件和设备要求推荐对应教师培训产品。
- 机构及学校：咨询平台会员权益、企业培训、学校采购和项目交付；仅使用机构及学校资料，不混入学生或教师个人班型价格。

三类身份的状态、当前实体、推荐结果和资料域相互隔离。跨身份切换时，服务端会清理旧身份业务状态；浏览器只保留可见历史和服务端返回的新状态，不把旧推荐作为新身份事实。

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- CSS Modules
- Vitest
- Supabase JavaScript SDK
- Supabase PostgreSQL
- OpenAI 兼容 Chat Completions 接口
- Vercel Git Integration

前端只调用 Next.js Route Handler。浏览器不会直接访问模型服务、Supabase 数据库或任何服务端 Secret Key。

## 安装与运行

Node.js 要求：本地建议 Node.js 20.9 或更高版本；Vercel 项目当前配置为 Node.js 24.x。首次安装和本地启动：

```bash
npm install
cp .env.example .env.local
npm run dev
```

浏览器访问终端显示的本地地址，通常是 `http://localhost:3000`。本地如需生产模式验证：

```bash
npm run build
npm run start
```

本地、Preview 和 Production 的真实配置只允许保存在 `.env.local` 或部署平台环境变量中，不能写入源码、文档、截图、日志、测试记录、对话导出或提交历史。

## 环境变量

Production 使用 7 项服务端变量名称：

| 名称 | 范围 | 说明 |
|---|---|---|
| `LLM_BASE_URL` | 服务端 | OpenAI 兼容模型服务基础地址 |
| `LLM_API_KEY` | 服务端 | 模型服务访问凭据 |
| `LLM_MODEL` | 服务端 | 模型标识 |
| `LLM_TIMEOUT_MS` | 服务端 | 单次模型请求超时毫秒数 |
| `CONVERSATION_STORE` | 服务端 | 会话存储类型，Production 使用 `supabase` |
| `SUPABASE_URL` | 服务端 | Supabase 项目 URL，格式为 Supabase HTTPS 项目基址 |
| `SUPABASE_SECRET_KEY` | 服务端 | Supabase 服务端 Secret Key |

`SUPABASE_SERVICE_ROLE_KEY` 是兼容旧项目的二选一后备名称，新项目优先使用 `SUPABASE_SECRET_KEY`。`LOCAL_HISTORY_DIR` 只用于本地 JSON 存储开发；`BLOB_READ_WRITE_TOKEN` 只用于 Blob 降级方案。任何 Secret Key 或 service-role 变量都不得添加 `NEXT_PUBLIC_` 前缀。

## Supabase 迁移

数据库迁移位于 `supabase/migrations/`：

- `20260803000000_create_chat_history.sql`
- `20260803000100_grant_chat_history_service_role.sql`

迁移建立 `chat_sessions` 和 `chat_messages` 两张表，启用 RLS，并仅允许服务端 Secret Key 通过服务端接口写入和读取。浏览器只保存 `sessionId`，不会保存数据库凭据、模型配置或消息数组。部署到新的 Supabase 项目时，应由参赛人先在数据库执行迁移，再在 Vercel 的 Production/Preview 环境中配置变量名称和值；变量值不进入仓库。

## 核心功能

- 身份澄清：对“我想学AI”等模糊输入先确认学生及家长、教师、机构及学校身份。
- 课程推荐：根据已确认约束推荐真实学生班型或教师产品，约束不足时继续追问。
- 全部班型浏览：学生完整目录包含 9 个班型组合，教师完整目录包含 6 个产品；完整目录不被已有个性化约束删减。
- 当前班型追问：用户选择某一班型后，短追问会继承当前实体，例如费用、地点、上课日期、设备和回放。
- 机构问答：学校采购 20 人按机构资料回答 5 万元起，不混入个人课程价格。
- 会话持久化：通过统一 `ConversationStore` 保存会话和消息，刷新后按服务端历史恢复。
- Markdown 导出：导出当前真实会话、身份、约束、推荐、来源和实际异常状态，不生成示例对话。
- 移动端体验：支持桌面双栏、移动端单列、软键盘可用输入区、历史滚动和回到最新。

## 检索增强资料注入

运行时知识库包含 83 个知识块。每轮检索会根据身份、当前实体、用户约束、当前消息和最近会话历史选择 5 至 8 个相关块。资料外问题不为凑数量注入无关块。检索到的块以转述资料、结构化字段和稳定 ID 形式注入大模型；模型只能基于本轮资料生成正文和 `usedChunkIds`，不能自行编造来源章节。

服务端在模型返回后执行严格 JSON 校验。`usedChunkIds` 必须是本轮 `retrievedChunkIds` 的子集；知识型回答至少使用一个合法块；金额、日期、实体和必要事实必须能被程序规则或本轮资料支持。校验通过后，来源由程序根据合法 `usedChunkIds` 追加，模型正文中的伪造来源不会进入最终来源列表。

## 费用复算

费用由规则层独立复算。学生费用支持报名状态、早鸟、同一期同班型团报、食宿加价和优惠择优；教师费用支持 L1/L2/L3、集训/周末产品和前置条件；机构采购费用与个人课程价格隔离。模型可以解释费用组成，但金额必须与程序复算一致。未提供的会员价格、实时余位、报名电话、额外折扣或外部机构比较会按资料边界拒答。

## 测试模式与脱敏证据模式

开发和 Preview 可使用 `?test=1` 验证一次性模型失败注入与重试恢复；故障消费后自动清除，重试沿用原请求并避免重复消息。`?evidence=1` 只显示脱敏统计，例如检索数量、使用数量、是否 grounding 和响应模式，不显示 Prompt、知识块全文、内部原因、密钥或模型配置。Production 普通页面和 `?viewportDebug=1` 页面均不得显示 Viewport Debug。

## 测试命令

提交前应运行：

```bash
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

项目还保留真实模型与浏览器证据运行器，用于特定任务复验。运行器使用 Node.js 发送 UTF-8 JSON 请求，避免 PowerShell 默认中文编码影响请求内容。真实模型证据只记录 HTTP 状态、脱敏结果、公开错误码、耗时和断言，不记录密钥、请求头、完整 Prompt 或模型配置值。

## 安全说明

`.gitignore` 忽略 `.env*`、`.data/chat-history/`、`.vercel/`、Word 原始材料、录屏、日志、构建产物和临时文件。公开仓库只保存二次加工后的结构化知识、代码、测试、文档和脱敏证据。提交前需要扫描高置信密钥、禁提交类型、原始 Word、长段资料原文和 Markdown 链接。Production 环境变量只核对名称和范围，不读取、输出或记录变量值。

## AI辅助代码标注

本项目不是“全部由 AI 自动生成”。职责划分如下：

人工负责：

- 素材事实核对
- 金额、日期、地点和边界确认
- 业务规则和验收决策
- 真实浏览器和 iPhone 测试
- 是否合并和发布

AI辅助：

- 代码实现
- 测试补充
- 问题诊断
- 文档草拟
- 运行器编制

所有 AI 辅助输出都必须经过人工业务规则、真实证据和自动化门禁复核后才能进入交付判断。

## 文档索引

- [交付物索引](docs/00_B级交付物索引.md)
- [需求解读与方案](docs/01_需求解读与方案.md)
- [使用说明](docs/02_使用说明.md)
- [技术说明](docs/03_技术说明.md)
- [测试记录](docs/04_测试记录.md)
- [AI辅助开发记录](docs/05_AI辅助开发记录.md)
- [演示视频脚本](docs/06_演示视频脚本.md)
- [系统架构说明](docs/07_系统架构说明.md)
- [提交检查清单](docs/07_提交检查清单.md)
