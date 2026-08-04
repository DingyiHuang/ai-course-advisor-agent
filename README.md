# AI课程顾问 Agent

面向 OPC“首届软件与智能体开发大赛”的统一赛题作品。系统服务学生/家长、教师、机构/学校三类用户，在素材 A、B、C 的严格资料边界内完成身份澄清、约束采集、课程或服务推荐、连续追问、程序化来源引用和异常恢复。

## 在线访问

- Vercel Production：TASK-07A 部署完成后回填
- Public GitHub：[DingyiHuang/ai-course-advisor-agent](https://github.com/DingyiHuang/ai-course-advisor-agent)
- 演示视频：将在 v1.0.0 GitHub Release 中提供

普通访问地址不会显示测试控件。部署完成后可在 Production 地址后添加 `/?test=1` 进入测试模式。

## 三类用户与核心能力

- 学生/家长：咨询三个营期、北京/上海线下和线上直播班，结合地区、营期、出行、授课方式和回放需要形成推荐。
- 教师：咨询 L1/L2/L3、暑期集训与周末研修，结合当前基础、目标等级、能否脱岗、时间和前置条件形成推荐。
- 机构/学校：咨询平台权益、企业培训、学校采购和项目交付，只使用素材 C，不进入个人班型推荐。

“我想学AI”等模糊输入会先澄清身份。信息不足时系统继续采集必要约束，不直接猜测；形成有效约束后推荐真实产品，并可通过“继续咨询该班”继承当前班型追问日期、地点、费用、大纲、设备或物资。知识回答先检索类型化知识块，再把转述资料和当前会话短历史注入 LLM；模型严格返回正文、`usedChunkIds`和追问建议，程序完成grounding后追加来源。模型失败、网络异常或接地校验失败会显示脱敏错误并支持重试，不返回固定课程答案冒充成功。

## 本地启动

环境要求：Node.js 20.9 或更高版本、npm。

```bash
npm install
cp .env.example .env.local
npm run dev
```

浏览器访问终端显示的 `Local` 地址，默认通常为 `http://localhost:3000`。真实配置只保存在本地或部署平台的服务端环境变量中，不应写入前端、仓库、日志、截图或对话导出。

| 环境变量 | 用途 |
|---|---|
| `LLM_BASE_URL` | OpenAI 兼容模型服务的基础地址 |
| `LLM_API_KEY` | 仅供服务端调用模型的凭据 |
| `LLM_MODEL` | 服务端使用的模型标识 |
| `LLM_TIMEOUT_MS` | 单次外部模型请求的超时毫秒数 |

## 技术架构

- Next.js 16 App Router、React 19、TypeScript
- 服务端 `POST /api/chat`，前端不直接访问模型
- 类型化知识实体和字段级来源映射
- 基于身份、当前实体、约束和当前会话历史的知识块检索
- 确定性推荐、日期、费用、前置条件和资料域规则
- classifier 与严格JSON composer分工的可替换 LLM 适配层
- Vitest 自动回归和真实 API/浏览器分层证据

主要目录：

```text
src/app/                 页面与服务端 Route Handler
src/components/          对话界面与结构化推荐展示
src/lib/knowledge/       素材 A/B/C 的类型化知识与字段来源
src/lib/retrieval/       当前身份、实体、约束与会话历史驱动的知识块检索
src/lib/rules/           推荐、费用、日期、前置和机构边界
src/lib/conversation/    会话状态、路由、编排与异常恢复
src/lib/llm/             服务端模型适配、classifier、composer
src/lib/validation/      金额、日期、事实与生成接地校验
src/lib/export/          当前真实会话的 Markdown 导出
tests/                   单元与 Mock Route Handler 集成测试
test-evidence/task06/    TASK-06 最终真实 API 与浏览器证据
test-evidence/task-b02/  TASK-B02 本地真实模型逐次证据与断点状态
docs/                    使用、技术、测试和演示文档
```

确定性代码负责资料域、约束清洗、产品筛选、日期、费用、优惠、前置条件、状态流转、知识块选择、高风险事实校验与来源追加；LLM只接收已确认事实、检索到的转述知识块、程序计算、决策轨迹和当前会话短历史，负责严格结构化的自然语言正文及逐项推荐理由。模型不能自行决定金额、日期或来源章节，`usedChunkIds`也不能引用本轮未注入的知识块。

## 测试与测试模式

TASK-06 最终结果：

- Mock/自动测试：17 个测试文件、227/227 通过
- 真实 `POST /api/chat`：39/39 组通过
- 浏览器人工测试：5/5 组通过
- 官方用例：25/25 组通过
- 补充高风险用例：14/14 组通过

TASK-B02 本地结果：

- 自动测试：26个测试文件、326/326通过（保留TASK-B01的301项基线）
- 真实模型功能场景：11/11通过
- 库内知识：6/6；资料外拒答：4/4；动态同义表达：1/1
- 逐次证据、失败attempt和检查点：`test-evidence/task-b02/`

质量检查：

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

测试模式仅在地址包含 `?test=1` 时显示 `TEST MODE` 和“模拟模型失败”。该按钮只让下一次模型请求失败，故障消费后自动清除；点击“重试原请求”应在保留会话状态的同时恢复正常调用。普通地址不会显示测试标识或故障按钮。

页面支持填写测试/会话编号并点击“导出 Markdown”。导出文件来自当前实际消息和服务端状态，包括身份、约束、当前班型或服务、推荐、来源、测试模式及实际异常状态，不生成虚构对话。

## 已知限制

- 实时余位、真实报名、付款、联系人和外部系统状态不在素材范围内，需要人工确认。
- 班型规模和最低开班人数不是实时余位。
- 外部模型供应商可能出现瞬时 503、限流或网络波动；系统支持一次静默重试及用户可见重试，但不能保证第三方服务始终可用。
- 推荐准确性依赖用户提供足够且不冲突的身份、地区、时间和形式信息。
- Vercel Production 的函数时长必须覆盖真实模型链路；TASK-07A 会按当前账户明确支持的上限核实，不猜测套餐能力。

## 文档与证据

- [需求解读与方案](docs/01_需求解读与方案.md)
- [使用说明](docs/02_使用说明.md)
- [技术说明](docs/03_技术说明.md)
- [测试记录](docs/04_测试记录.md)
- [AI辅助开发记录](docs/05_AI辅助开发记录.md)
- [演示视频脚本](docs/06_演示视频脚本.md)
- [提交检查清单](docs/07_提交检查清单.md)
- [TASK-06 最终证据清单](test-evidence/task06/evidence-manifest.md)
- [TASK-06 最终汇总](test-evidence/task06/summary.md)
- [TASK-B02 真实模型验证汇总](test-evidence/task-b02/summary.md)

原始 Word、人工测试 Word、环境变量、录屏和视频不会进入公开 Git 历史。
