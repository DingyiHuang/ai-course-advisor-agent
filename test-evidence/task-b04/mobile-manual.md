# TASK-B04 iPhone Safari人工复验证据

## 基线

- Preview URL: `https://ai-course-advisor-agent-tx9784jke-projectmanagement1.vercel.app`
- Deployment ID: `dpl_vmLMi2GaJXfjrHNRnxrZ8VvyTr14`
- Preview状态: `READY`
- Git SHA: `87bbd936132bf29c3763d9c4f988c28b7d22f762`
- 分支: `feature/b-level-v2`
- 记录日期: 2026-08-05（Asia/Shanghai）
- 保护标签: `task-b04r2-before-ios-followup-fix-20260805`保留；本地注释标签剥离后指向`964fb31634ec53536333c1e2e0be5487db594920`

## 设备与范围

- 测试设备范围: 一台iPhone Safari真机。
- 设备型号: 参赛人未填写。
- iOS版本: 参赛人未填写。
- 网络环境: 参赛人未填写。
- 具体测试时间: 参赛人未填写。
- Android: 仅完成Chrome模拟移动尺寸检查，未进行Android真机测试。

## 历史问题与复验过程

### TASK-B04A首次失败情况

TASK-B04A完成本地桌面与模拟移动尺寸准备，但iPhone Safari人工验收未通过。主要问题为移动端快捷问题和场景提示长期占用底部空间，影响对话内容查看和历史滚动；真机失败记录不得被本地模拟尺寸通过覆盖。

### TASK-B04R第一次修复及失败情况

TASK-B04R收起移动端快捷内容，并修复完整目录意图与个性化推荐意图混用问题。本地Headless Chrome模拟尺寸通过，学生9个班型和教师6个班型目录规则通过；但后续iPhone Safari仍暴露输入聚焦后页面滑到空白区域、关闭键盘后页面根滚动残留，以及选择具体班型后的组合追问未稳定继承当前班型的问题，因此TASK-B04R不能封闭。

### TASK-B04R2当前班型修复结果

TASK-B04R2/R3对应Preview和Git SHA为本文件基线所列版本。参赛人选择第2期线上直播班后输入“多少钱，在哪里上课?”，系统能够继承当前班型，回答同时包含腾讯会议直播和3980元；不再询问城市、月份或授课形式；当前实体保持`camp-p2-online`；不生成新的目录卡或推荐卡。

### TASK-B04R3最终真机复验结果

以下12项经参赛人使用iPhone Safari真实复验，全部通过：

1. 普通页面不显示Viewport Debug。
2. 点击输入框后不再滑到空白区域。
3. 输入框和发送按钮保持在软键盘上方。
4. 关闭键盘后没有底部空白。
5. 消息区滚动位置保持正常。
6. 移动端输入字号符合要求。
7. 页面根滚动能够恢复，不影响消息区滚动。
8. 选择第2期线上直播班后输入“多少钱，在哪里上课?”，能够继承当前班型。
9. 回答同时包含腾讯会议直播和3980元。
10. 不再询问城市、月份或授课形式。
11. 当前实体保持`camp-p2-online`。
12. 不生成新的目录卡或推荐卡。

## 诊断与安全边界

- Viewport Debug仅用于Preview诊断。
- 普通模式不得显示Viewport Debug。
- 只有非Production环境且显式使用`viewportDebug=1`时才允许显示诊断。
- Production即使带有`?viewportDebug=1`也不得显示诊断面板。
- Production响应不得返回视口诊断、Prompt、知识块ID或内部错误原因。
- 对应自动测试保留在`tests/unit/course-advisor-ui.spec.ts`。

## 模型503记录

本次iPhone Safari最终复验中，参赛人未填写是否发生模型503；本记录不自行推断。项目记录继续保留第三方模型瞬时503风险，历史TASK-B04A/R阶段的本地模型或grounding波动不改写为本次真机503。

## 总体结论

TASK-B04 iPhone Safari真机验收通过。Android真机未测试。设备型号、iOS版本、网络环境和具体测试时间均按“参赛人未填写”记录，未用模拟设备信息替代。
