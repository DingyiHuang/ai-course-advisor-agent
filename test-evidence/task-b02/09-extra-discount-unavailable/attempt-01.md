# 09-extra-discount-unavailable 第1次尝试

- 开始：2026-08-04T02:17:12.861Z
- 完成：2026-08-04T02:17:17.892Z
- 耗时：5031 ms
- HTTP状态：200
- 公开错误码：无
- 检索chunk ID：无
- usedChunkIds：无
- 来源：无
- 模型调用次数：1
- grounding重新生成次数：0
- 结论：通过

## 预期

明确资料未提供额外优惠，不承诺新折扣。

## 最终公开回答

现有资料未提供关于额外优惠的信息，因此我无法确认当前是否还能获得额外优惠。建议您以官方最新发布为准，也可以继续了解其他课程、费用或报名条件等问题。

## 请求阶段

- isolated:create_session：201 / 无 / 240 ms
- isolated:target_question：200 / 无 / 4786 ms

## 校验

- 通过：usedChunkIds全部来自本轮retrievedChunkIds
- 通过：来源由程序追加且与usedChunkIds对应
- 通过：明确额外优惠未提供
- 通过：不注入无关知识块或来源
