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
    case "catalog":
      return "catalog";
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
  const recommendationReasons = parsed.recommendationReasons ?? [];
  if (
    !Array.isArray(recommendationReasons) ||
    recommendationReasons.some((group) => {
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        return true;
      }
      const value = group as Record<string, unknown>;
      return (
        typeof value.entityId !== "string" ||
        !Array.isArray(value.reasons) ||
        value.reasons.some((reason) => {
          if (!reason || typeof reason !== "object" || Array.isArray(reason)) {
            return true;
          }
          const item = reason as Record<string, unknown>;
          return (
            typeof item.constraintKey !== "string" ||
            typeof item.reason !== "string" ||
            !item.reason.trim()
          );
        })
      );
    })
  ) {
    throw new LlmError(
      "invalid_response",
      "Composer recommendation reasons are invalid",
    );
  }
  return {
    message: parsed.message.trim(),
    usedFactIds: [...new Set(parsed.usedFactIds as string[])],
    actions: parsed.actions ? [...new Set(parsed.actions as string[])] : [],
    recommendationReasons: recommendationReasons.map((group) => {
      const value = group as {
        entityId: string;
        reasons: Array<{ constraintKey: string; reason: string }>;
      };
      return {
        entityId: value.entityId,
        reasons: value.reasons.map((reason) => ({
          constraintKey: reason.constraintKey,
          reason: reason.reason.trim(),
        })),
      };
    }),
  };
}

const COMPOSER_SYSTEM_PROMPT = `你是AI课程顾问的正文生成器。只能根据本次JSON载荷中的facts、calculations、decisionTrace、nextQuestionKeys、nextQuestionOptions和短上下文生成回答。
所有课程正文和推荐理由必须自然、动态地表达，每条推荐理由都要对应decisionTrace中的真实约束，不得补充未采集条件。
若route为ask_follow_up，必须优先提出nextQuestionKeys对应的问题；不得因为status看似结束而省略追问。若提供nextQuestionOptions，应把选项自然问出。
追问维度是封闭的：region只确认北京、上海、广州或其他城市，不得追问区县；availablePeriods只确认第一、第二或第三期，不得把“周末/平日晚间”当成营期；modePreference只允许线上、线下或均可，不得把录播回放列为授课形式。只能询问nextQuestionKeys实际给出的维度，不得新增考级、认证、泛化目标或其他约束。
若route为recommendation，必须根据recommendationReasonRequirements为每个班型输出recommendationReasons：每个要求的constraintKey恰好给出一条动态理由，理由只说明该用户约束与本班型事实如何对应。其他route返回空数组。
当decisionTrace包含guangzhou_student_offline_not_provided、beijing_shanghai_travel_unavailable和online_fallback_for_unmet_offline_preference时，对应动态理由必须分别明确表达：广州没有学生线下班、北京和上海均不便出行、线上直播是线下偏好无法满足时的可行备选；不得删除或改写用户原有的线下偏好。
不得生成、猜测或复述资料名称、素材编号、文档标题、章节号或“来源”段落；来源由程序追加。
不得自称或暗示自己是人工顾问、模拟人工顾问或人工客服；身份只能是AI课程顾问或自动化助手。需要转人工时，只能说明“需人工确认”或“联系人工顾问”，不得扮演人工。
crossDomainNotice由程序在正文前追加，不要自行复述。actions只能从载荷中的actions选择。
不得虚构价格、日期、地点、余位、联系方式、报名状态或支付状态。capacity和minimumToOpen不是实时余位。
只输出JSON对象：{"message":"正文","usedFactIds":["实际使用的fact id"],"actions":["可选操作"],"recommendationReasons":[{"entityId":"班型id","reasons":[{"constraintKey":"约束键","reason":"动态理由"}]}]}。不要Markdown代码块或其他前后缀。usedFactIds只能取自facts中的id。`;

function recommendationReasonRequirements(plan: ComposerPlan): Array<{
  entityId: string;
  constraintKeys: string[];
}> {
  if (plan.status !== "recommended") return [];
  return plan.entityIds.map((entityId) => ({
    entityId,
    constraintKeys: [
      ...new Set(
        plan.decisionTrace
          .filter((trace) =>
            trace.factIds.some((factId) => factId.startsWith(`${entityId}.`)),
          )
          .flatMap((trace) => trace.constraintKeys),
      ),
    ],
  }));
}

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
              recommendationReasonRequirements:
                recommendationReasonRequirements(plan),
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
