# 11-dynamic-teacher-paraphrases 第1次尝试

- 开始：2026-08-04T02:18:10.309Z
- 完成：2026-08-04T02:18:44.242Z
- 耗时：33933 ms
- HTTP状态：200
- 公开错误码：无
- 检索chunk ID：teacher-l1-weekend-schedule、teacher-product-overview、teacher-l1-prerequisite、teacher-l1-pricing、teacher-l1-curriculum、teacher-device-and-replay
- usedChunkIds：teacher-l1-weekend-schedule、teacher-l1-prerequisite、teacher-l1-pricing、teacher-l1-curriculum、teacher-device-and-replay
- 来源：素材B《初高中教师AI素养培训体系介绍》第二、四章；素材B《初高中教师AI素养培训体系介绍》第一、六章；素材B《初高中教师AI素养培训体系介绍》第五章；素材B《初高中教师AI素养培训体系介绍》第三章；素材B《初高中教师AI素养培训体系介绍》第四章
- 模型调用次数：2
- grounding重新生成次数：0
- 结论：通过

## 预期

推荐一致、关键chunk重合、正文表达明显不同，且两次均真实调用composer。

## 最终公开回答

根据您“刚开始接触AI，平日走不开，但周末可以上课”的情况，推荐L1周末研修班。该班型面向零基础教师，没有先修要求，课程安排在8月2日上午4课时线上、下午4课时线下工作坊，能避开您的工作日时间。课程覆盖提示词、AI备课、课件与图像、作业反馈、教学伦理，完成后可产出含教案、课件和练习的AI辅助教学资源包。线下工作坊设在北京、上海、广州，线上部分通过腾讯会议进行，并提供30天回放。需要提醒：该班报名已于2026-07-26截止，目前无法再提交报名；标准价格为2980元，早鸟优惠也已过期，费用包含课程、资料和考核。您可以继续询问这一班型的细节，或查看其他班型。

来源：素材B《初高中教师AI素养培训体系介绍》第二、四章；素材B《初高中教师AI素养培训体系介绍》第一、六章；素材B《初高中教师AI素养培训体系介绍》第五章；素材B《初高中教师AI素养培训体系介绍》第三章；素材B《初高中教师AI素养培训体系介绍》第四章

## 请求阶段

- teacher-paraphrase-a:create_session：201 / 无 / 224 ms
- teacher-paraphrase-a:select_teacher_domain：200 / 无 / 699 ms
- teacher-paraphrase-a:target_question：200 / 无 / 20611 ms
- teacher-paraphrase-b:create_session：201 / 无 / 119 ms
- teacher-paraphrase-b:select_teacher_domain：200 / 无 / 760 ms
- teacher-paraphrase-b:target_question：200 / 无 / 11490 ms

## 校验

- 通过：usedChunkIds全部来自本轮retrievedChunkIds
- 通过：来源由程序追加且与usedChunkIds对应
- 通过：两次推荐结果均为L1周末研修班
- 通过：关键知识块一致或合理重合
- 通过：两次正文组织和措辞有明显差异
- 通过：两次均有真实composer调用
