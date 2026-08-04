# 07-live-availability-unavailable 第1次尝试

- 开始：2026-08-04T02:03:47.729Z
- 完成：2026-08-04T02:04:29.157Z
- 耗时：41428 ms
- HTTP状态：200
- 公开错误码：无
- 检索chunk ID：student-camp-p1-bj-logistics、student-camp-overview、student-camp-p1-bj-pricing、student-camp-refund、student-camp-availability-unknown、student-camp-daily-outline
- usedChunkIds：student-camp-availability-unknown、student-camp-overview
- 来源：素材A《2026暑期AI素养夏令营课程手册》第一章（未提供实时余位）；素材A《2026暑期AI素养夏令营课程手册》第三章
- 模型调用次数：3
- grounding重新生成次数：1
- 结论：通过

## 预期

明确现有资料未提供实时余位，不推断剩余名额。

## 最终公开回答

素材A只提供北京和上海学生线下班，未提供还有多少余位学生线下班。
关于余位，现有资料未提供实时余位信息，也不能用班型规模或最低开班人数推断当前剩余名额，最终名额需以实际确认时为准。您之前确认的是第一期、线下偏好，但您所在地区的线下班型在现有资料中未提供；目前资料覆盖的是北京线下、上海线下和线上直播三种选择。为了帮您筛选合适的班型，想先和您确认一下：您近期是否方便前往北京或上海？可选“可以前往北京”“可以前往上海”或“均不便出行”。

来源：素材A《2026暑期AI素养夏令营课程手册》第一章（未提供实时余位）；素材A《2026暑期AI素养夏令营课程手册》第三章

## 请求阶段

- student-current-entity:create_session：201 / 无 / 174 ms
- student-current-entity:establish_student_context：200 / 无 / 27464 ms
- student-current-entity:target_question：200 / 无 / 13727 ms

## 校验

- 通过：usedChunkIds全部来自本轮retrievedChunkIds
- 通过：来源由程序追加且与usedChunkIds对应
- 通过：明确资料未提供实时余位
- 通过：未编造剩余名额
- 通过：使用余位边界知识块
