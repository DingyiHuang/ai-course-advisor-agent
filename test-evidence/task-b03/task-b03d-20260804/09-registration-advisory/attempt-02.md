# 09-registration-advisory 第2次尝试

- 开始：2026-08-04T04:50:05.983Z
- 完成：2026-08-04T04:50:43.705Z
- 耗时：37718 ms
- HTTP状态：503
- 公开错误码：grounding_rejected
- calculationMode：无
- responseMode：无
- groundingReasonCodes：[{"attempt":2,"reasonCode":"missing_required_fact","detailCode":"date_advisory_registration_deadline_missing"}]
- expectedAmount：无
- modelAmount：无
- firstPassMatched：无
- grounding重新生成次数：1
- 结论：功能检查未通过

## 预期

提供两项截止日期、中国标准时间基准和主办方通知边界，不作最终裁决。

## 最终公开回答

当前资料核对未通过，请重试。原有对话已保留。

## 检查

- [ ] 日期咨询HTTP 200且无公开错误
- [ ] 包含两项截止日期和时间基准
- [ ] 同时使用报名截止和早鸟截止知识块
- [ ] 保留主办方通知边界且不作报名裁决
- [x] 不推荐其他营期或课程
- [ ] 来源只覆盖两个日期事实
