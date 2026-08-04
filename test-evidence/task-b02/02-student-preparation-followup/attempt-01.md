# 02-student-preparation-followup 第1次尝试

- 开始：2026-08-04T02:08:33.173Z
- 完成：2026-08-04T02:09:55.293Z
- 耗时：82120 ms
- HTTP状态：200
- 公开错误码：无
- 检索chunk ID：student-camp-daily-outline、student-camp-p1-bj-logistics、student-camp-overview、student-camp-p1-bj-pricing、student-camp-required-items、student-camp-equipment
- usedChunkIds：student-camp-p1-bj-logistics、student-camp-required-items、student-camp-equipment
- 来源：素材A《2026暑期AI素养夏令营课程手册》第三章；素材A《2026暑期AI素养夏令营课程手册》第六章
- 模型调用次数：4
- grounding重新生成次数：1
- 结论：通过

## 预期

继承当前学生班型，说明电脑、充电器等准备事项。

## 最终公开回答

根据您在北京、可参加第一期、希望线下的条件，为您推荐第1期北京线下班，授课地点为AI教育中心北京教学基地。针对“需要准备什么”，现有资料显示：所有学员都必须携带笔记本电脑和充电器，并按开营通知提前注册模拟或免费工具账号；由于您选择的是线下班，还需要准备身份证明复印件、洗漱用品、换洗衣物、水杯和雨具。设备要求方面，电脑需使用Windows 10及以上或macOS 12及以上系统，内存至少8GB，并能正常运行Chrome或Edge及腾讯会议。该班营期为2026年8月1日至8月7日，报名截止日期为2026年7月25日，当前资料显示报名已截止、营期已开始，建议按开营通知核对最新准备事项。您可以继续询问当前班型、查看其他营期或返回菜单。

来源：素材A《2026暑期AI素养夏令营课程手册》第三章；素材A《2026暑期AI素养夏令营课程手册》第六章

## 请求阶段

- student-current-entity:create_session：201 / 无 / 1929 ms
- student-current-entity:establish_student_context：200 / 无 / 45696 ms
- student-current-entity:student_followup_1：200 / 无 / 17711 ms
- student-current-entity:target_question：200 / 无 / 16767 ms

## 校验

- 通过：usedChunkIds全部来自本轮retrievedChunkIds
- 通过：来源由程序追加且与usedChunkIds对应
- 通过：正文包含笔记本电脑
- 通过：检索学生准备事项知识块
- 通过：保持第一期北京线下实体
- 通过：来源只属于素材A
