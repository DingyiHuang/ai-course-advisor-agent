# TASK-B02 本地真实模型验证汇总

- 模式：local real model; testMode=false
- 功能场景通过率：100%
- 首次请求成功率：100%
- 瞬时错误次数：2
- 重试后恢复场景数：0
- grounding重新生成次数：2
- 程序兜底次数：2
- 库内知识准确率：100%
- 资料外拒答准确率：100%
- 平均attempt耗时：25534 ms
- 最长attempt耗时：82120 ms
- 保留但不计入功能准确率的旧证据：1组 / 3次attempt

- 01-student-day-five：尝试1次，瞬时错误0次，通过
- 02-student-preparation-followup：尝试1次，瞬时错误0次，通过
- 03-teacher-l2-weekend-schedule：尝试1次，瞬时错误0次，通过
- 04-teacher-device-context：尝试1次，瞬时错误0次，通过
- 05-school-procurement-pricing：尝试1次，瞬时错误0次，通过
- 06-membership-price-unavailable：尝试1次，瞬时错误0次，通过
- 07-live-availability-unavailable：尝试1次，瞬时错误0次，通过
- 08-contact-unavailable：尝试1次，瞬时错误0次，通过
- 09-extra-discount-unavailable：尝试1次，瞬时错误0次，通过
- 10-provider-comparison-unavailable：尝试1次，瞬时错误0次，通过
- 11-dynamic-teacher-paraphrases：尝试1次，瞬时错误0次，通过
- 04-teacher-device：保留原始3次attempt，替换为04-teacher-device-context；原运行器未先建立教师身份上下文，证据保留但不计入正式统计。
