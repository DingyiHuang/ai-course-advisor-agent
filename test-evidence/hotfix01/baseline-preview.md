# HOTFIX-01 未修改业务行为的 Preview 基线

## 部署

- Git 提交：`f9b99671967a7b538e454f7e026b9f92560f3a18`
- Preview Deployment：`dpl_6YRsUiY46yLgycAYAdeKp7HWixGp`
- Preview URL：`https://ai-course-advisor-agent-a1180h2qm-projectmanagement1.vercel.app`
- Vercel 状态：`READY`
- Vercel 目标：`preview`
- Production Deployment：`dpl_wT9qdCQQkkBSm2VV6vNJUTEVoB33`，保持 `READY`

该 Preview 只加入 Development/Preview 脱敏诊断，业务路由、提取、规则、composer 和 grounding 行为与 `9692821` 相同。项目级 Preview 环境没有模型变量；经参赛人确认，仅对这个临时 Deployment 注入本地现有同值运行时变量，没有修改项目级环境变量或 Production。

## 三次结果

时间单位为毫秒。`total` 是服务端 Route Handler 总耗时，不包含 Vercel CLI 认证入口本身的固定开销。

| 场景 | 轮次 | HTTP | 状态 | 实体 | context | extract | classifier | rules | composer | grounding | composer retry | 外部调用 | total |
|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A | 1 | 200 | unrelated | - | 2 | 3 | 3073 | 0 | 0 | 0 | 0 | 1 | 3080 |
| A | 2 | 200 | unrelated | - | 0 | 0 | 7346 | 3 | 0 | 0 | 0 | 1 | 7350 |
| A | 3 | 200 | unrelated | - | 0 | 0 | 4847 | 0 | 0 | 0 | 0 | 1 | 4848 |
| B | 1 | 200 | recommended | teacher-l1-weekend | 1 | 1 | 7837 | 1 | 12466 | 5 | 0 | 2 | 20314 |
| B | 2 | 200 | recommended | teacher-l1-weekend | 0 | 0 | 3320 | 0 | 7617 | 0 | 0 | 2 | 10939 |
| B | 3 | 200 | recommended | teacher-l1-weekend | 0 | 0 | 5964 | 0 | 37395 | 0 | 1 | 3 | 43360 |
| C setup | 1 | 200 | needs_more_information | - | 0 | 0 | 2342 | 0 | 2972 | 1 | 0 | 2 | 5317 |
| C setup | 2 | 200 | needs_more_information | - | 0 | 0 | 2554 | 0 | 2265 | 0 | 0 | 2 | 4819 |
| C setup | 3 | 200 | needs_more_information | - | 0 | 0 | 2891 | 0 | 3647 | 0 | 0 | 2 | 6540 |
| C | 1 | 200 | recommended | teacher-l1-intensive | 0 | 0 | 6296 | 0 | 10606 | 1 | 0 | 2 | 16904 |
| C | 2 | 200 | recommended | teacher-l1-intensive | 0 | 0 | 10804 | 0 | 5929 | 0 | 0 | 2 | 16735 |
| C | 3 | 200 | recommended | teacher-l1-intensive | 0 | 0 | 4301 | 0 | 7065 | 0 | 0 | 2 | 11367 |

## 中位数与诊断结论

| 场景 | classifier | composer | rules | grounding | 外部调用 | total |
|---|---:|---:|---:|---:|---:|---:|
| A | 4847 | 0 | 0 | 0 | 1 | 4848 |
| B | 5964 | 12466 | 0 | 0 | 2 | 20314 |
| C setup | 2554 | 2972 | 0 | 0 | 2 | 5317 |
| C | 6296 | 7065 | 0 | 0 | 2 | 16735 |

- A 三次都被 classifier 判为 `unrelated`。
- B 三次都依赖一次 classifier 和一次成功 composer；其中一轮 composer 首次模型调用发生可重试错误，导致第三次外部调用。
- C 的回答轮三次都调用 classifier；日期灵活三次都没有进入已确认约束，城市有一轮丢失。
- Preview 的正常 grounding 校验没有触发重试，耗时不是瓶颈。
- 同一提交的本地真实 Route Handler 测量曾在 C 的一轮出现 `ungrounded_date`，说明日期归一化需要保留关注，但不能据此取消 grounding。
- 优化重点应是代码层路由与约束提取、跳过不必要 classifier，以及降低 composer 首稿失败概率；规则执行和正常 grounding 无需削弱。
