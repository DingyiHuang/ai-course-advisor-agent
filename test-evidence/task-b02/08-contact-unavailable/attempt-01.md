# 08-contact-unavailable 第1次尝试

- 开始：2026-08-04T02:16:58.190Z
- 完成：2026-08-04T02:17:04.749Z
- 耗时：6559 ms
- HTTP状态：200
- 公开错误码：无
- 检索chunk ID：无
- usedChunkIds：无
- 来源：无
- 模型调用次数：1
- grounding重新生成次数：0
- 结论：通过

## 预期

明确资料未提供联系电话，不编造联系方式。

## 最终公开回答

现有资料未提供报名联系电话，建议您继续咨询或返回菜单了解其他信息。

## 请求阶段

- isolated:create_session：201 / 无 / 327 ms
- isolated:target_question：200 / 无 / 6149 ms

## 校验

- 通过：usedChunkIds全部来自本轮retrievedChunkIds
- 通过：来源由程序追加且与usedChunkIds对应
- 通过：明确联系电话未提供
- 通过：无编造手机号
- 通过：不注入无关知识块或来源
