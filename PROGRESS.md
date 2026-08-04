# 项目进度

## v1状态

- 当前阶段：TASK-06已完成封版；真实API 39组和参赛人浏览器5项均已执行并通过。
- TASK-05最终基线：`4a2eb7dcbb3ac4e40472c6f743596ac95af0901c`；TASK-06在该基线上形成独立封版提交。
- 本地保护标签：`task05-v1-passed`指向上述基线，注释为`TASK-05 browser-verified candidate`。
- 真实API：官方25/25通过、补充14/14通过；浏览器人工E01、E02、E03、E05、X10为5/5通过。
- 最终总体：官方25/25、补充14/14，合计39/39通过，0失败、0阻塞，通过率100%。
- 自动回归：17个测试文件、227条全部通过；TypeScript、ESLint、生产构建和`git diff --check`通过。
- 明确边界：TASK-06提交完成后停止；不进入TASK-07、不部署、不执行正式参赛提交。

## Mock API集成测试

- Mock API集成测试、真实模型Route重放与浏览器人工复验分开记录。
- `tests/integration/api-chat.spec.ts`在TASK-06A后共76条，直接调用真实`src/app/api/chat/route.ts`。
- 仅mock外部模型供应商；规则、会话编排、状态更新、grounding、来源、presentation和API序列化均走真实应用实现。
- 覆盖显式闭集冲突、推荐实体不变量、学校采购两次grounding、广州降级理由、北京追问白名单、返回菜单、外部承诺、生产测试标志和客户端重试状态；新增覆盖深圳、成都、编造城市、广州→天津真实路径，以及E04天气、长交通数据、股票、合法上下文追问、提示注入、无关后恢复和缺失intent证据；最终对抗补充覆盖首轮城市grounding、出行地点污染、短无关价格问句和夹带业务词的Git指令。该结果不替代真实模型与浏览器结果。

## 真实模型Route重放

- 调用方式：启动本地应用，以真实环境模型调用真实`POST /api/chat`；全新state、`testMode=false`、只输出脱敏结构化诊断和耗时。
- 学校20人采购：3/3 HTTP 200，均为`platform-school-procurement`，直接包含20人起、5万元起，只用素材C，无2980和可见中间错误。
- 广州第一期线下且均不便出行：3/3两轮HTTP 200，均为`camp-p1-online`、period 1、3980/3980、30天回放；保留offline偏好，三条降级理由齐全，无第二/三期和“完全符合”。
- 北京第一期线下：3/3首轮保留约束并澄清身份，选择学生后均为`camp-p1-bj`；不追问区县、学校、周末/晚间、考级或泛化目标。
- 补充：返回菜单后“我想学AI”重新澄清身份；显式索要真实人工联系、提交需求时，最终响应无冒充、安排、联系、提交、锁位或报名承诺。
- 其他城市增量：深圳和成都均两轮HTTP 200，跨轮保留`region=other`及各自`regionDisplayName`；最终均为第一期`camp-p1-online`、3980/3980、30天回放并保留offline，不出现广州或错误“完全符合”。深圳正文使用允许的中性“您所在地区”，成都正文明确成都。
- E04增量：在已建立学校采购状态后，天气、港口/公路/交通/经济长文本、项目开发进度与Git要求三轮分别在12ms、14ms、11ms返回`unrelated`；composer 0次，本轮实体、推荐、机构卡和来源全空，不含20人、5万元或2980，旧状态保留；随后均可恢复“至少多少人”上下文并回答20人起，只引用素材C。
- 最终对抗加固后再次抽查：深圳两轮21722+29765ms，首轮明确深圳且无广州，最终仍为第一期线上、3980元、30天回放；天气、交通、夹带“学校采购”的Git指令分别11ms、11ms、15ms返回空业务`unrelated`，短无关“一斤苹果多少钱？”也未继承采购；人数追问5830ms恢复20人起和素材C。
- 真实模型曾在一次E04预备建态阶段返回HTTP 503；该次未满足“已建立学校采购状态”的验证前提。全新state重建后HTTP 200、composer一次成功并完成有效链路。此瞬时外部模型波动保留为剩余风险。

## 全量自动测试

- 2026-07-24 TASK-06封版重跑：17个测试文件、227条全部通过，0失败；TASK-05的200条基线未删除、跳过或弱化。
- TypeScript：`tsc --noEmit`退出码0。
- ESLint：退出码0，无错误。
- 生产构建：Next.js 16.2.11编译、类型检查、页面数据和静态页生成成功。
- `git diff --check`：退出码0，无空白错误；只有Windows行尾转换提示。
- 范围与敏感扫描：TASK-06候选提交不包含`.env.local`、原始Word、录屏、临时日志、Authorization、供应商请求头、内部提示词或高置信密钥；41份JSON均可解析，X10仓库副本与参赛人原文件SHA-256一致。

## 浏览器人工复验

执行日期：2026-07-23。执行人：参赛人。浏览器：Chrome。

| 人工项 | 最新真实结论 | 实际结果摘要 |
|---|---|---|
| 原定第1—5项 | 通过 | 参赛人最新人工复验确认全部通过，不需要重复复验 |
| 学校采购可见校验错误 | 否 | 最新补记为未出现校验错误 |
| 其他城市定向复验 | 通过 | 实际使用杭州替代天津；最终第1期线上、3980元、30天回放，地区理由为杭州，无其他错误城市或错误“完全符合”；第一次返回错误，重试后成功 |
| E04天气、交通、Git/部署 | 通过 | 均显示范围提示；交通不含20人、5万元、2980；未执行或复述开发指令 |
| E04恢复咨询 | 通过 | “这个方案至少多少人？”恢复学校采购上下文并回答20人，来源为素材C第六章 |

历史人工失败及其修复过程保留在`docs/04_测试记录.md`，不会用最终结果覆盖。参赛人已直接把原Word中E04“是否新增采购正文/卡片/来源”的记录笔误修正为“否”；当前Word、逐轮Markdown和总体结论一致。Codex未修改该Word。

## 证据位置

- TASK-05人工证据（唯一Word引用，仓库外）：`task05 定向复验.docx`
- 第一轮真实Markdown证据（仓库外）：`AI课程顾问_TASK05-001_20260723-120102.md`
- 最新真实Markdown证据（仓库外）：`AI课程顾问_TASK05-001_20260723-154400.md`
- 其他城市定向证据（实际杭州，仓库外）：`AI课程顾问_TASK05-OTHER-CITY_20260723-164604.md`
- E04定向证据（仓库外）：`AI课程顾问_TASK05-E04_20260723-165225.md`
- TASK-06最终证据与清单：`test-evidence/task06/`、`test-evidence/task06/evidence-manifest.md`
- TASK-06人工Word：`task06 人工确认.docx`；仅在仓库外引用，未复制或提交。
- X10真实导出：`test-evidence/task06/browser/AI课程顾问_TASK06-X10_20260724-095628.md`
- Markdown导出结果：成功；当前资料域汇总与去重正确，完整历史保留。
- Mock API集成、真实模型Route重放和全量检查：`docs/04_测试记录.md`的TASK-05第二轮热修分层记录。

## 剩余风险与参赛人待办

- 定向人工复验已完成，无剩余TASK-05浏览器复验项。
- 外部模型供应商仍存在瞬时HTTP 503风险；本次定向复验实际发生一次，重试后恢复。该风险与E04意图路由逻辑结果分开记录。
- 其他城市记录写明第一次返回错误、重试后成功；证据没有明确证明该次错误与HTTP 503是同一次，不作关联推断。
- TASK-05原Word的E04填报笔误已由参赛人直接修正为“否”；不存在也不需要`task05 定向复验_更正版.docx`。
- TASK-06人工Word中E03“是否HTTP 500：是”与同页“通过”及Network截图（HTTP 400、HTTP 200）存在字段矛盾；最终按真实Network截图和参赛人总体结论记为通过，人工Word未被修改。
- TASK-06已完成；部署、TASK-07和正式参赛提交均未执行。

## TASK-06最终状态

最终完整轮次：2026-07-23 18:44:14—18:54:49（Asia/Shanghai）。

| 范围 | API通过 | API失败 | 浏览器人工通过 | 总体通过 | 总体失败 | 阻塞 |
|---|---:|---:|---:|---:|---:|---:|
| 官方25组 | 25 | 0 | 4 | 25 | 0 | 0 |
| 补充14组 | 14 | 0 | 1 | 14 | 0 | 0 |
| 合计 | 39 | 0 | 5 | 39 | 0 | 0 |

- 最终P0/P1/P2失败清单均为空。
- 供应商429为0次，供应商503为0次。F05有一次应用接地503后自动恢复；E05有一次预期的测试模式503并按实际返回state恢复，均不计作供应商故障。
- 真实API主证据：`test-evidence/task06/`；汇总：`test-evidence/task06/summary.md`、`summary.json`；浏览器结果：`test-evidence/task06/browser/`。
- 历史轮次6个目录、350个证据文件已原样移动到仓库外目录`task06-evidence-history/`；复跑脚本另存于该目录的`_runner/`。仓库外合计351个文件，均未删除；最终统计只采用仓库内最后完整39组和浏览器5项。
- 自动测试当前为17个文件、227条通过；Route Handler集成套件76条。
- 官方25/25、补充14/14、总体39/39，最终通过率100%，达到官方90%门槛。
- TASK-05人工证据仅引用仓库外文件`task05 定向复验.docx`；该文件由参赛人填写和修正，未修改、复制或提交。
- TASK-06封版后停止，不进入TASK-07、不部署、不执行正式比赛提交。

## TASK-B01 存储基础与迁移准备

- 有效工时开始：2026-08-03 14:29:50（Asia/Shanghai）。
- 计时规则：实现、自动测试和本地检查计入 H5；停止点之后等待参赛人在 Supabase SQL Editor 执行迁移的时间不计入 H5。
- 本阶段边界：只完成统一存储接口、工厂、Local JSON、Supabase 服务端实现与模拟测试、Blob 可编译入口及数据库迁移文件；不执行远程迁移，不部署 Preview，不修改 Production，不进入 TASK-B02。
- 第一阶段有效工时停止：2026-08-03 15:00:04（Asia/Shanghai）；H5 累计使用 0 小时 30 分钟，现进入不计时的迁移等待。
- 本地检查：新增存储测试 37 项、全量 292 项全部通过；TypeScript、ESLint、Production Build 和 `git diff --check` 通过。
- 第二阶段首次恢复计时：2026-08-03 15:09:20 至 15:17:43，共 8 分 23 秒。本地开发服务重启后，第 1 项创建会话返回 HTTP 503、公开错误码 `persistence_error`；脱敏鉴权探针为 HTTP 401、原因分类 `INVALID_API_KEY`，失败发生在表访问和 RLS 判断之前。第 2 至 5 项未执行，未切换存储方案。
- 第二阶段本地配置修正后复验：2026-08-03 15:28:37 至 15:30:15，共 1 分 38 秒。确认使用新进程加载本地配置；第 1 项创建会话仍返回 HTTP 503、公开错误码 `persistence_error`，脱敏鉴权探针仍为 HTTP 401、原因分类 `INVALID_API_KEY`。配置未被系统级同名变量覆盖，项目 URL 结构检查通过；第 2、3 项未执行，暂不部署 Preview，不修改 Production，不切换存储方案。
- 第二阶段新建 Secret Key 后复验：2026-08-03 15:38:18 至 15:39:42，共 1 分 24 秒。全新本地进程启动成功；第 1 项创建会话返回 HTTP 503、公开错误码 `persistence_error`。脱敏探针显示 Supabase 已接受新 key，但表访问为 HTTP 403，原因分类 `TABLE_PERMISSION_DENIED`；失败已从鉴权入口推进到数据库表权限层。第 2、3 项未执行，未创建公开 RLS 策略，未切换存储方案。
- 第二阶段 service_role 最小授权后复验：2026-08-03 15:44:18 至 15:47:37，共 3 分 19 秒。本地第 1 项创建会话通过（HTTP 201，1121ms，会话 `251e3400-0c4c-43cd-ae04-f5e0afe7522c`）；第 2 项保存用户与 AI 消息通过（HTTP 200，17074ms，响应状态 `needs_identity`，内容摘要分别为 `a79bcdffa539`、`4cdf03705d09`）；第 3 项查询顺序、内容和隔离通过（主会话 HTTP 200，1433ms，角色顺序 `user > assistant`，2 条内容均与写入响应一致；隔离会话创建 141ms、查询 295ms、消息数 0）。本地开发服务随后停止，未进入 Preview。
- 独立授权迁移：新增 `supabase/migrations/20260803000100_grant_chat_history_service_role.sql`，原迁移未修改；只向 `service_role` 授予 `chat_sessions` 的 SELECT/INSERT/UPDATE/DELETE 和 `chat_messages` 的 SELECT/INSERT/DELETE。静态测试确认没有 `anon`、`authenticated`、`grant all`、公开 RLS 策略或关闭 RLS；定向 18/18、全量 301/301、TypeScript、ESLint、Production Build 和 `git diff --check` 通过。
- H5 累计有效工时：0 小时 44 分 58 秒。本地三项已全部通过并按要求停止；五项中的 Preview 连接和刷新恢复尚未执行，因此暂不形成最终 H5 存储决策，不部署 Preview，不修改 Production，不进入 TASK-B02。
- 第三阶段恢复计时：2026-08-03 16:04:03（Asia/Shanghai）。仅继续 TASK-B01 的部署前复验、Preview 部署与真实联调，不修改 Production，不合并 `main`，不进入 TASK-B02。
- Preview Deployment：`dpl_EfvwSToiRhPGtVQiwetFGASWRnQb`，地址 `https://ai-course-advisor-agent-4ew498mjn-projectmanagement1.vercel.app`，创建时间 2026-08-03 16:06:52（Asia/Shanghai），Target 为 Preview，状态 `READY`，Git SHA `34b873d929e076ddc1545c2a36effc27e71680f9`，分支 `feature/b-level-v2`。Production Deployment 未修改。
- Preview 真实联调：创建会话、保存用户与 AI 消息、按 `user > assistant` 顺序查询、刷新恢复同一会话和完整消息、第二会话隔离、浏览器仅保存 `ai-course-advisor.sessionId`、标准 JSON 错误脱敏均通过。变量核对仅检查名称及 Preview 适用环境，未读取、显示或记录变量值。
H5检查：Supabase五项全部达成，决定继续使用Supabase。当前CONVERSATION_STORE=supabase。
- 第三阶段有效工时停止：2026-08-03 16:19:41（Asia/Shanghai），本阶段 0 小时 15 分 38 秒；H5 累计有效工时 1 小时 0 分 36 秒。完成后停止在 TASK-B01，不进入 TASK-B02。

## TASK-B02 检索增强的资料注入与 LLM 结构化生成

- 开始时间：2026-08-03 16:30:59（Asia/Shanghai）。
- 开始检查：当前分支 `feature/b-level-v2`，HEAD 与 `origin/feature/b-level-v2` 均为 `6dd3097aef1d1dcbfb8db2fd3b676251381768b8`，工作区干净；`origin/main` 仍为 `319d709dce71406cd87c0f9c60fa327b284334f5`。
- TASK-B01 保护标签：本地注释标签 `task-b01-complete-20260803` 已创建并核验指向 `6dd3097aef1d1dcbfb8db2fd3b676251381768b8`，未指向较早的 `34b873d929e076ddc1545c2a36effc27e71680f9` 功能提交。
- TASK-B01 Preview：部署 `dpl_EfvwSToiRhPGtVQiwetFGASWRnQb` 经 Vercel 只读接口复核仍为 `READY`；未部署新 Preview，未修改 Production。
- TASK-B02实现：新增83个带稳定ID和来源的类型化知识块，素材A/学生24个、素材B/教师19个、素材C/机构40个；检索器每轮按当前身份、实体、约束、待追问和最近会话历史选择5—8块，资料外问题不为凑数注入无关块。
- 生成链路固定为四步：检索知识块；注入自然语言转述资料与最近会话；LLM以`temperature=0.6`严格生成`answer`、`usedChunkIds`和`followUpSuggestions`；程序校验chunk白名单、金额、日期、来源与推荐一致性后，根据`usedChunkIds`追加来源。classifier保持低温，ConversationStore选型和TASK-B01存储边界未修改。
- TASK-B02E真实验证运行器：Node.js直接发送UTF-8 JSON，串行并发1；每个请求后原子保存attempt与`run-state.json`，每个场景独立session，瞬时错误使用新会话按10秒/30秒等待且最多3次，场景间等待8秒、每3场景暂停30秒；通过检查点不会重复调用。
- 三组小批与三批正式真实模型验证全部完成：11/11功能场景通过，首次请求成功率100%，库内知识6/6、资料外拒答4/4、教师同义表达1/1通过；同义表达均推荐`teacher-l1-weekend`，5个关键chunk重合且正文不同。会员回答明确价格未提供，没有把6980元作为教师L2价格示例；实时余位明确资料未提供。
- 运行器审计保留：旧教师设备验证因未先建立教师身份，检索混入学生块，3份attempt原样保留并标记为superseded，不计入功能准确率；其中2次`model_unavailable`分别保留HTTP状态、公开错误码、耗时和应用模型调用次数。修正后的教师身份场景首次通过，6个检索块全部属于教师域。汇总仍统计旧证据的2次瞬时错误、2次grounding重生成和2次程序兜底，不隐藏失败尝试。
- 真实证据：`test-evidence/task-b02/`包含`run-state.json`、`summary.json`、`summary.md`、11个正式结果目录和1个superseded审计目录，共14份attempt；无临时半截文件，所有正式场景`usedChunkIds`均为本轮`retrievedChunkIds`子集。
- 最终本地门禁（2026-08-04）：26个测试文件、326条测试全部通过，原有301条未删除、跳过或弱化；TypeScript、ESLint、Next.js 16.2.11 Production Build、`git diff --check`、敏感信息扫描、原始Word扫描和长段原文扫描全部通过。构建仅保留既有Local JSON会话存储的Turbopack文件追踪警告。
- TASK-B02有效工作于2026-08-04 10:25:20（Asia/Shanghai）完成本地验证；未部署Preview或Production，未推送，未合并`main`，未进入TASK-B03。

## TASK-B03 上轮扣分项定向修复与费用问答增强

- 开始时间：2026-08-04 10:41:30（Asia/Shanghai）。
- 开始检查：当前分支 `feature/b-level-v2`，HEAD 为 `50a1e49e3ec42af2a6b7e0ba9d7d5018ea6eb04a`，工作区干净；`origin/main` 仍为 `319d709dce71406cd87c0f9c60fa327b284334f5`；注释标签 `task-b01-complete-20260803` 剥离后仍指向 `6dd3097aef1d1dcbfb8db2fd3b676251381768b8`。
- TASK-B02 保护标签：本地注释标签 `task-b02-complete-20260804` 已创建并核验指向 `50a1e49e3ec42af2a6b7e0ba9d7d5018ea6eb04a`，未覆盖任何已有标签。
- TASK-B03费用与对话修复已完成：六组费用均由LLM给出有效金额，首次命中5/6；最终金额依次为6980、6680、9040、3280、3280、5980元，最终通过证据中的费用fallback为0。场景01至08在日期修复期间保持冻结且未重跑。
- TASK-B03D旧场景09证据保持原样：attempt-01证据不足，原因码维持10；attempt-02保留HTTP 503及第二次composer缺少完整报名截止事实的诊断，未追溯补写第一次失败类别。TASK-B03D2将两个日期、精确知识块ID和必含短语作为结构化事实清单注入日期Prompt，并把日期fallback改为“两个composer机会均未产生合格答案”后触发；脱敏诊断逐次记录阶段、公开原因码、耗时、grounding原因和usedChunkIds有效性，Production不返回该诊断。
- 场景09正式attempt-03首次LLM生成通过：HTTP 200、composer 1次、重生成0、`responseMode`为空、日期fallback 0；正文包含2026年7月25日24:00、2026年7月11日、中国标准时间及主办方最新通知边界，不作报名裁决，不推荐其他营期；`usedChunkIds`精确包含报名截止与早鸟截止知识块，程序追加素材A第三章、第五章两处来源。
- 从断点继续的场景10至13均通过，未重跑01至08。场景10问候、11特殊符号和13提示注入均无模型调用；场景12学生目录发生一次composer重生成后通过。最终13个功能场景均有通过证据；最终采用的通过结果中fallback总数为0。历史失败证据仍完整保留，其中早期场景02失败attempt出现过一次系统费用兜底，不计入最终通过统计。
- TASK-B03D2自动测试在原382项基础上新增16项，最终28个测试文件、398项全部通过，0删除、0跳过、0弱化；TypeScript、ESLint、Next.js 16.2.11 Production Build和`git diff --check`均通过。Build仅保留既有Local JSON会话存储的Turbopack文件追踪警告。
- 证据目录`test-evidence/task-b03/`共89个文件、52份JSON；全部JSON可解析，65个冻结证据文件SHA-256逐一未变，D2新增24个文件。敏感信息、原始Word、禁提交类型和长段知识原文复制扫描均为0命中；8条超过500字符的证据行均为结构化学生目录回答及其镜像字段，不是资料原文复制。
- TASK-B03只创建本地提交，不推送、不部署Preview或Production、不合并`main`，并停止在TASK-B03，不进入TASK-B04。
