# 03-teacher-l2-weekend-schedule 第1次尝试

- 开始：2026-08-04T02:10:03.336Z
- 完成：2026-08-04T02:10:12.122Z
- 耗时：8786 ms
- HTTP状态：200
- 公开错误码：无
- 检索chunk ID：teacher-l2-weekend-schedule、teacher-product-overview、teacher-l2-pricing、teacher-l2-prerequisite、teacher-l2-curriculum、teacher-device-and-replay
- usedChunkIds：teacher-l2-weekend-schedule
- 来源：素材B《初高中教师AI素养培训体系介绍》第二、四章
- 模型调用次数：1
- grounding重新生成次数：0
- 结论：通过

## 预期

给出8月8日、8月9日和8月15日，不混用其他班型。

## 最终公开回答

L2周末研修班的上课安排为：8月8日线上8课时，8月9日线下8课时，8月15日上午线上4课时，共20课时。报名截止日期为2026年8月1日。线上部分使用腾讯会议，线下部分为线下工作坊。

来源：素材B《初高中教师AI素养培训体系介绍》第二、四章

## 请求阶段

- isolated:create_session：201 / 无 / 1077 ms
- isolated:target_question：200 / 无 / 7704 ms

## 校验

- 通过：usedChunkIds全部来自本轮retrievedChunkIds
- 通过：来源由程序追加且与usedChunkIds对应
- 通过：包含三天课程日期
- 通过：实体为L2周末研修班
- 通过：来源只属于素材B
