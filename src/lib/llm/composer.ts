import type {
  ComposerOutput,
  ComposerPlan,
  ComposerRoute,
  ShortHistoryItem,
} from "@/lib/domain/conversation";
import { parseStrictJsonObject } from "./json";
import type { LlmClient } from "./types";
import { LlmError } from "./types";

export function resolveComposerRoute(
  input: Pick<ComposerPlan, "status" | "nextQuestionKeys">,
): ComposerRoute {
  if (input.nextQuestionKeys.length > 0) return "ask_follow_up";
  switch (input.status) {
    case "recommended":
      return "recommendation";
    case "fact_answer":
      return "fact_answer";
    case "boundary_follow_up":
    case "prerequisite_blocked":
      return "boundary";
    case "institution_info":
      return "institution";
    case "insufficient_information":
      return "insufficient_information";
    case "no_match":
      return "no_match";
    case "unrelated":
      return "unrelated";
    case "needs_identity":
    case "needs_more_information":
      return "ask_follow_up";
  }
}

export function parseComposerOutput(content: string): ComposerOutput {
  const parsed = parseStrictJsonObject(content);
  if (typeof parsed.message !== "string" || !parsed.message.trim()) {
    throw new LlmError("invalid_response", "Composer message is missing");
  }
  if (
    !Array.isArray(parsed.usedFactIds) ||
    parsed.usedFactIds.some((item) => typeof item !== "string")
  ) {
    throw new LlmError("invalid_response", "Composer fact IDs are invalid");
  }
  if (
    parsed.actions !== undefined &&
    (!Array.isArray(parsed.actions) ||
      parsed.actions.some((item) => typeof item !== "string"))
  ) {
    throw new LlmError("invalid_response", "Composer actions are invalid");
  }
  return {
    message: parsed.message.trim(),
    usedFactIds: [...new Set(parsed.usedFactIds as string[])],
    actions: parsed.actions ? [...new Set(parsed.actions as string[])] : [],
  };
}

const COMPOSER_SYSTEM_PROMPT = `你是AI课程顾问的正文生成器。只能根据本次JSON载荷中的facts、calculations、decisionTrace、nextQuestionKeys、nextQuestionOptions和短上下文生成回答。
所有课程正文和推荐理由必须自然、动态地表达，每条推荐理由都要对应decisionTrace中的真实约束，不得补充未采集条件。
若route为ask_follow_up，必须优先提出nextQuestionKeys对应的问题；不得因为status看似结束而省略追问。若提供nextQuestionOptions，应把选项自然问出。
不得生成、猜测或复述资料名称、素材编号、文档标题、章节号或“来源”段落；来源由程序追加。
crossDomainNotice由程序在正文前追加，不要自行复述。actions只能从载荷中的actions选择。
不得虚构价格、日期、地点、余位、联系方式、报名状态或支付状态。capacity和minimumToOpen不是实时余位。
只输出JSON对象：{"message":"正文","usedFactIds":["实际使用的fact id"],"actions":["可选操作"]}。不要Markdown代码块或其他前后缀。usedFactIds只能取自facts中的id。`;

export function createComposer(client: LlmClient): {
  composeOnce(plan: ComposerPlan, history: ShortHistoryItem[]): Promise<ComposerOutput>;
} {
  return {
    async composeOnce(plan, history) {
      const route = resolveComposerRoute(plan);
      const result = await client.complete({
        temperature: 0.6,
        responseFormat: "json_object",
        messages: [
          { role: "system", content: COMPOSER_SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              route,
              status: plan.status,
              domain: plan.domain,
              facts: plan.facts,
              calculations: plan.calculations,
              decisionTrace: plan.decisionTrace,
              nextQuestionKeys: plan.nextQuestionKeys,
              nextQuestionOptions: plan.nextQuestionOptions,
              actions: plan.actions,
              crossDomainNotice: plan.crossDomainNotice ?? null,
              shortContext: history.slice(-4),
            }),
          },
        ],
      });
      return parseComposerOutput(result.content);
    },
  };
}
