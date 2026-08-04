# 09-registration-advisory 第3次尝试

- 开始：2026-08-04T05:08:16.360Z
- 完成：2026-08-04T05:08:28.790Z
- 耗时：12427 ms
- HTTP状态：200
- 公开错误码：无
- calculationMode：无
- responseMode：无
- groundingReasonCodes：无
- dateAdvisoryAttemptResults：[{"attemptIndex":1,"stage":"completed","publicReasonCode":null,"elapsedMs":12039,"groundingReasonCodes":[],"hasValidUsedChunkIds":true}]
- expectedAmount：无
- modelAmount：无
- firstPassMatched：无
- grounding重新生成次数：0
- 结论：通过

## 预期

提供两项截止日期、中国标准时间基准和主办方通知边界，不作最终裁决。

## 最终公开回答

关于第1期报名，现有资料显示：报名截止时间为2026年7月25日24:00，早鸟缴费截止日期为2026年7月11日。上述日期按中国标准时间理解，具体请以主办方最新通知为准。

来源：素材A《2026暑期AI素养夏令营课程手册》第三章；素材A《2026暑期AI素养夏令营课程手册》第五章

## 检查

- [x] 日期咨询HTTP 200且无公开错误
- [x] 包含两项截止日期和时间基准
- [x] 同时使用报名截止和早鸟截止知识块
- [x] 保留主办方通知边界且不作报名裁决
- [x] 不推荐其他营期或课程
- [x] 来源只覆盖两个日期事实
