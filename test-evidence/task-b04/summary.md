# TASK-B04A 本地前端验收汇总

## 证据性质

- 日期：2026-08-04（Asia/Shanghai）
- 浏览器：Windows 10 / Headless Chrome 150
- 视口声明：`width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`
- 本目录全部为本地浏览器和模拟尺寸证据，不是iOS或Android真机证据。

## 四种目标尺寸

| 尺寸 | 横向滚动 | 输入区 | 卡片/来源 | 快捷入口 | 状态面板 | 证据 |
|---|---|---|---|---|---|---|
| 1440×900 | 无 | 完整可见 | 无溢出 | 可见、可点击 | 桌面常驻 | `local/1440x900.png` |
| 1280×720 | 无 | 完整可见 | 无溢出 | 可见、可换行 | 桌面常驻 | `local/1280x720.png` |
| 390×844 | 无 | 完整可见 | 推荐卡/来源无溢出 | 所有可见主按钮不小于44×44 | 可展开/收起 | `local/390x844.png`、`local/390x844-restored-recommendation.png` |
| 360×800 | 无 | 完整可见 | 无溢出 | 所有可见主按钮不小于44×44 | 默认收起 | `local/360x800.png` |

360×500视觉视口压缩时，页面壳和输入区底部均保持在500px视口内；20行输入增长到160px后输入框内部滚动。见`local/360x500-keyboard-multiline-fixed.png`。这只是软键盘尺寸模拟，不是真机键盘结果。

## 交互证据

- `local/error-card.png`：Test Mode模拟失败后的脱敏错误卡与重试入口。
- `local/retry-loading.png`：原位重试期间显示“正在检索资料并核对回答”，发送禁用且对话仍可滚动。
- `local/retry-success.png`：重试成功后错误卡原位替换，只有一份用户消息、AI消息和推荐卡。
- `local/1280x720-interaction-fixed.png`：1280×720下包含快捷入口和推荐交互时输入区仍完整可见。
- `local/evidence-mode.png`：脱敏证据模式显示检索6、使用2、grounding是、重生成否和`responseMode=normal`；不显示Prompt、chunk ID或内部原因。
- 刷新恢复保持sessionId `93eef699-b459-49ca-9e66-269aeabb3b70`不变并恢复身份、当前实体和完整成功消息；重新开始后创建新sessionId `f07c0d3f-85e8-42e1-b553-092167dd5136`且不读取旧消息。上述ID只是本地测试会话标识，不含密钥或正文。
- localStorage检查仅有`ai-course-advisor.sessionId`。

## 已知本地现象与后续复核

本地“查看所有学生班型”真实动态调用连续两次因模型/grounding未形成可交付回答，页面均按设计显示友好错误并提供重试；失败截图保留为`local/student-catalog-1280x720.png`。学生9个实体和教师6个班型已由自动测试及TASK-B03真实证据锁定，但该入口必须在新Preview桌面冒烟中再次实测，不能把本地失败写成成功。

## 自动门禁

- Vitest：31个测试文件、425项通过；原398项保留，新增27项。
- TypeScript：通过。
- ESLint：通过。
- Production Build：通过；仅既有Local JSON ConversationStore的Turbopack文件追踪告警。
- `git diff --check`：通过，仅有Windows行尾提示。
- 扫描：31个候选文件；禁提交类型0项、原始Word 0项、高置信密钥/令牌/私钥0命中；知识层80字符以上长字面量直接复制0命中，新增超过500字符的单行0项。
