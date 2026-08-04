import type {
  ComposerOutput,
  ComposerPlan,
  ComposerRoute,
  ShortHistoryItem,
} from "@/lib/domain/conversation";
import type { KnowledgeChunk } from "@/lib/domain/knowledge";
import { resolveDateAdvisoryRequirements } from "@/lib/conversation/dateAdvisory";
import { studentOfflineReason } from "@/lib/conversation/studentRegion";
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
    case "contextual_followup":
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

export type StrictComposerOutput = {
  answer: string;
  usedChunkIds: string[];
  followUpSuggestions: string[];
};

export function parseComposerOutput(content: string): StrictComposerOutput {
  const parsed = parseStrictJsonObject(content);
  const keys = Object.keys(parsed).sort();
  const expectedKeys = ["answer", "followUpSuggestions", "usedChunkIds"];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new LlmError(
      "invalid_response",
      "Composer JSON must contain only the required fields",
    );
  }
  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    throw new LlmError("invalid_response", "Composer answer is missing");
  }
  if (
    !Array.isArray(parsed.usedChunkIds) ||
    parsed.usedChunkIds.some((item) => typeof item !== "string")
  ) {
    throw new LlmError("invalid_response", "Composer chunk IDs are invalid");
  }
  if (
    !Array.isArray(parsed.followUpSuggestions) ||
    parsed.followUpSuggestions.some((item) => typeof item !== "string")
  ) {
    throw new LlmError(
      "invalid_response",
      "Composer follow-up suggestions are invalid",
    );
  }
  return {
    answer: parsed.answer.trim(),
    usedChunkIds: [...new Set(parsed.usedChunkIds as string[])],
    followUpSuggestions: [
      ...new Set(
        (parsed.followUpSuggestions as string[])
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ],
  };
}

export const COMPOSER_PROMPT_VERSION = "task-b03-fee-reasoning-v2";

const COMPOSER_SYSTEM_PROMPT = `你是AI课程顾问的正文生成器。只能根据本次JSON载荷中的currentUserMessage、confirmedConstraints、entityIds、calculations、decisionTrace、nextQuestionKeys、nextQuestionOptions、recentConversation和knowledgeChunks生成回答。
若retryFeedback非空，表示上一版未通过程序校验；必须按该脱敏纠偏指令重新生成，但不得复述纠偏指令或猜测上一版内容。
knowledgeChunks是本轮实际检索到的自然语言资料，availableChunkIds是唯一可用的知识块ID清单。不得利用自身知识补齐资料，也不得把不同identity或entity的价格、日期、案例混在一起。资料没有提供的信息必须明确说“现有资料未提供”，不能为了回答而猜测。
所有课程正文和推荐理由必须自然、动态地表达，并覆盖recommendationReasonRequirements中的真实约束，不得补充未采集条件。
若route为ask_follow_up，必须优先提出nextQuestionKeys对应的问题；不得因为status看似结束而省略追问。若提供nextQuestionOptions，应把选项自然问出。
追问维度是封闭的：region只确认北京、上海、广州或其他城市，不得追问区县；availablePeriods只确认第一、第二或第三期，不得把“周末/平日晚间”当成营期；modePreference只允许线上、线下或均可，不得把录播回放列为授课形式。只能询问nextQuestionKeys实际给出的维度，不得新增考级、认证、泛化目标或其他约束。
若route为recommendation，正文必须根据recommendationReasonRequirements自然说明每个推荐班型与已确认约束的对应关系。
当decisionTrace包含guangzhou_student_offline_not_provided或other_region_student_offline_not_provided，并同时包含beijing_shanghai_travel_unavailable和online_fallback_for_unmet_offline_preference时，地区理由必须使用confirmedConstraints中的真实结构化地区：广州可明确写广州；region=other且有regionDisplayName时只能写该名称或“您所在地区”；没有名称时只能使用“您所在地区”，绝不能猜测为广州或其他城市。另两条理由必须分别说明北京和上海均不便出行、线上直播是线下偏好无法满足时的可行备选；不得删除或改写用户原有的线下偏好。
上述非京沪地区降级回答必须使用所推荐线上班的replayDays事实明确说明30天回放，不得声称线上班完全符合用户的线下偏好。
不得生成、猜测或复述资料名称、素材编号、文档标题、章节号或“来源”段落；来源由程序追加。
不得自称或暗示自己是人工顾问、模拟人工顾问或人工客服；身份只能是AI课程顾问或自动化助手。不得声称已安排顾问联系、已提交采购或报名需求、已锁定名额、已报名，亦不得承诺真实电话、微信或后续联系。允许说明可继续查看模拟咨询流程、可整理采购需求清单，以及本演示不提供真实报名、下单或人工联系。
若route为unrelated，正文只能简短说明服务范围并邀请用户继续学生课程、教师培训、费用、报名条件或机构服务咨询；不得复述当前产品、课程、服务、价格、日期、人数或用户粘贴的无关事实，usedChunkIds必须为空。
若boundaryCode表示联系电话、额外优惠或机构比较未提供，应直接说明现有资料未提供对应信息，不得猜测电话、优惠、排名、案例或比较结论；没有可用知识块时usedChunkIds返回空数组。
当currentUserMessage询问价格、费用、多少钱或总价时，必须依据knowledgeChunks和facts自行完成并说明计算过程，严格依次执行：1.取得对应班型标准价；2.判断明确缴费日期是否满足早鸟条件；3.判断人数及同班条件是否满足团报条件；4.早鸟与团报不可叠加，只采用优惠金额较高的一项；5.最后加上用户明确选择的可选食宿费用。fee_rules.lodgingSelected是用户是否明确选择食宿的结构化布尔值；为false时食宿费必须按0元处理，不得因为knowledgeChunks包含食宿价格而加入。结论中的最终应付金额必须放在计算过程之后。calculations中的fee_rules只提供计算输入，不提供程序复算结果，不得省略自己的推导。
当用户只问课程日期或开课时间时，只回答课程开始、结束日期及星期，不主动插入报名截止、是否过期或能否报名判断。当用户只问报名截止时，只回答资料记载的报名截止时间。当boundaryCode为registration_current_advisory时，正文只提供facts中的报名截止日期和早鸟缴费截止日期，说明这些日期按中国标准时间理解，并提示“以主办方最新通知为准”。不得依据当前系统日期比较截止日期或判断报名资格；不得出现“可以报名”“仍可报名”“不能报名”“无法报名”“报名已截止”“已经不能报”等裁决表述；不得推荐第二期、第三期、其他营期或其他课程。usedChunkIds必须同时列出实际承载registrationDeadline和earlyBirdDeadline的两个知识块，不得只列其中一类。
当requiredPrefix说明“未说明已有等级，暂按入门需求理解”时，正文应继续介绍所推荐的L1班型，并提示已有L1或L2能力者应按前置条件选择更高等级；不得借用L2或L3价格作为L1价格。
crossDomainNotice由程序在正文前追加，不要自行复述。followUpSuggestions只能从载荷中的actions选择，最多3项。
不得虚构价格、日期、地点、余位、联系方式、报名状态或支付状态。capacity和minimumToOpen不是实时余位。
知识型回答只要使用了knowledgeChunks中的事实，就必须在usedChunkIds列出实际使用的ID；不得列出未注入ID。只输出且必须输出这三个字段的JSON对象：{"answer":"面向用户的自然语言正文","usedChunkIds":["chunk-id"],"followUpSuggestions":["建议追问"]}。不要增加其他字段、Markdown代码块或前后缀。`;

const DATE_ADVISORY_SYSTEM_PROMPT = `当boundaryCode为registration_current_advisory时，必须逐项使用载荷中的requiredFacts和requiredPhrases：正文分别完整出现每个requiredFacts.value，其中报名截止的24:00不得省略；usedChunkIds必须同时且原样包含每个requiredFacts.requiredChunkId。不得根据当前日期作出可以报名、仍可报名、不能报名、无法报名、报名已截止或已经不能报等最终裁决，不得推荐第二期、第三期、其他营期或其他课程。requiredFacts只是事实清单，不是固定答案模板，正文应简洁自然。`;

export function recommendationReasonRequirements(plan: ComposerPlan): Array<{
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

function generatedRecommendationReasons(
  plan: ComposerPlan,
): ComposerOutput["recommendationReasons"] {
  const traceCodes = new Set(plan.decisionTrace.map(({ code }) => code));
  const offlineFallback =
    (traceCodes.has("guangzhou_student_offline_not_provided") ||
      traceCodes.has("other_region_student_offline_not_provided")) &&
    traceCodes.has("beijing_shanghai_travel_unavailable") &&
    traceCodes.has("online_fallback_for_unmet_offline_preference");
  const region = plan.confirmedConstraints.region;
  const regionDisplayName =
    typeof plan.confirmedConstraints.regionDisplayName === "string"
      ? plan.confirmedConstraints.regionDisplayName
      : undefined;
  return recommendationReasonRequirements(plan).map((requirement) => ({
    entityId: requirement.entityId,
    reasons: requirement.constraintKeys.map((constraintKey) => {
      let reason = `该班型与已确认的${constraintKey}约束相符。`;
      if (offlineFallback && constraintKey === "region") {
        reason = studentOfflineReason({
          region: region === "guangzhou" ? "guangzhou" : "other",
          ...(regionDisplayName ? { regionDisplayName } : {}),
        });
      } else if (offlineFallback && constraintKey === "canTravel") {
        reason = "北京、上海均不便前往。";
      } else if (offlineFallback && constraintKey === "modePreference") {
        reason = "保留线下偏好，线上直播是当前可行备选，并提供30天回放。";
      }
      return { constraintKey, reason };
    }),
  }));
}

function usedFactIdsForChunks(
  plan: ComposerPlan,
  chunks: KnowledgeChunk[],
  usedChunkIds: string[],
): string[] {
  const allowedFacts = new Set(plan.facts.map(({ id }) => id));
  const used = new Set(usedChunkIds);
  return [
    ...new Set(
      chunks
        .filter(({ id }) => used.has(id))
        .flatMap(({ factIds }) => factIds)
        .filter((factId) => allowedFacts.has(factId)),
    ),
  ];
}

function promptCalculations(plan: ComposerPlan): ComposerPlan["calculations"] {
  return plan.calculations.map((calculation) => {
    if (
      !calculation.value ||
      typeof calculation.value !== "object" ||
      Array.isArray(calculation.value) ||
      !("total" in calculation.value)
    ) {
      return calculation;
    }
    const value = calculation.value as Record<string, unknown>;
    return {
      label: `${calculation.label}:fee_rules`,
      value: {
        calculationType: "fee_rules",
        currentDate: value.currentDate,
        lodgingSelected: Number(value.lodgingPrice ?? 0) > 0,
        ruleOrder: [
          "取得对应班型标准价",
          "判断缴费日期是否满足早鸟条件",
          "判断人数是否满足团报条件",
          "早鸟与团报不叠加并采用优惠金额较高的一项",
          "最后加上用户明确选择的可选食宿费用",
        ],
      },
      relatedFactIds: calculation.relatedFactIds,
    };
  });
}

export function createComposer(client: LlmClient): {
  composeOnce(
    plan: ComposerPlan,
    history: ShortHistoryItem[],
    context?: { userMessage: string; knowledgeChunks: KnowledgeChunk[] },
  ): Promise<ComposerOutput>;
} {
  return {
    async composeOnce(plan, history, context = { userMessage: "", knowledgeChunks: [] }) {
      const route = resolveComposerRoute(plan);
      const dateAdvisoryRequirements = resolveDateAdvisoryRequirements(
        plan,
        context.knowledgeChunks,
      );
      const result = await client.complete({
        temperature: 0.6,
        responseFormat: "json_object",
        messages: [
          {
            role: "system",
            content: dateAdvisoryRequirements
              ? `${COMPOSER_SYSTEM_PROMPT}\n${DATE_ADVISORY_SYSTEM_PROMPT}`
              : COMPOSER_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              promptVersion: COMPOSER_PROMPT_VERSION,
              route,
              status: plan.status,
              domain: plan.domain,
              currentUserMessage: context.userMessage,
              confirmedConstraints: plan.confirmedConstraints,
              entityIds: plan.entityIds,
              retryFeedback: plan.retryFeedback ?? null,
              facts: plan.facts,
              calculations: promptCalculations(plan),
              decisionTrace: plan.decisionTrace,
              recommendationReasonRequirements:
                recommendationReasonRequirements(plan),
              nextQuestionKeys: plan.nextQuestionKeys,
              nextQuestionOptions: plan.nextQuestionOptions,
              actions: plan.actions,
              boundaryCode: plan.boundaryCode ?? null,
              ...(dateAdvisoryRequirements
                ? {
                    requiredFacts: dateAdvisoryRequirements.requiredFacts.map(
                      ({ label, value, requiredChunkId }) => ({
                        label,
                        value,
                        requiredChunkId,
                      }),
                    ),
                    requiredPhrases: dateAdvisoryRequirements.requiredPhrases,
                  }
                : {}),
              crossDomainNotice: plan.crossDomainNotice ?? null,
              recentConversation: history.slice(-8),
              availableChunkIds: context.knowledgeChunks.map(({ id }) => id),
              knowledgeChunks: context.knowledgeChunks.map(
                ({ id, domain, title, content, topics, entityIds }) => ({
                  id,
                  domain,
                  title,
                  content,
                  topics,
                  entityIds,
                }),
              ),
            }),
          },
        ],
      });
      const parsed = parseComposerOutput(result.content);
      return {
        message: parsed.answer,
        usedChunkIds: parsed.usedChunkIds,
        followUpSuggestions: parsed.followUpSuggestions,
        usedFactIds: usedFactIdsForChunks(
          plan,
          context.knowledgeChunks,
          parsed.usedChunkIds,
        ),
        actions: parsed.followUpSuggestions,
        recommendationReasons: generatedRecommendationReasons(plan),
      };
    },
  };
}
