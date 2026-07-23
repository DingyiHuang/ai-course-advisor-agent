import type {
  ChatPresentation,
  ComposerOutput,
  ComposerPlan,
  ConversationState,
  RecommendationReasonItem,
} from "@/lib/domain/conversation";
import type {
  Camp,
  PlatformService,
  TeacherProduct,
} from "@/lib/domain/knowledge";
import type { CollectedSource } from "@/lib/citations";
import { getKnowledgeEntityById } from "./facts";

const CONSTRAINT_LABELS: Record<string, string> = {
  region: "所在地区",
  preferredOfflineCampus: "可前往城市",
  availablePeriods: "可参加营期",
  excludedPeriods: "冲突营期",
  modePreference: "授课形式",
  canTravel: "出行条件",
  needsReplay: "回放需求",
  level: "目标等级",
  goal: "培训目标",
  startingLevel: "当前基础",
  canTakeContinuousLeave: "时间安排",
  availableProductIds: "可参加班型",
  city: "所在城市",
  prerequisiteStatus: "前置条件",
};

const VALUE_LABELS: Record<string, string> = {
  beijing: "北京",
  shanghai: "上海",
  guangzhou: "广州",
  other: "其他地区",
  offline: "偏好线下",
  online: "偏好线上",
  any: "线上线下均可",
  beginner: "零基础",
  tools: "AI工具应用",
  "web-app": "AI Web应用",
  "rag-project": "知识库/RAG项目",
  met: "已满足",
  not_met: "未满足",
  unknown: "待确认",
};

function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) {
    return value.map((item) => VALUE_LABELS[String(item)] ?? String(item)).join("、");
  }
  return VALUE_LABELS[String(value)] ?? String(value ?? "未提供");
}

function constraintValue(
  state: ConversationState,
  key: string,
): string {
  const source =
    state.domain === "student"
      ? state.studentConstraints
      : state.teacherConstraints;
  return displayValue((source as Record<string, unknown>)[key]);
}

function sourcesForEntity(
  sources: CollectedSource[],
  entityId: string,
): CollectedSource[] {
  return sources.flatMap((source) => {
    const factIds = source.factIds.filter((id) => id.startsWith(`${entityId}.`));
    return factIds.length ? [{ ...source, factIds }] : [];
  });
}

function calculationForEntity(
  plan: ComposerPlan,
  entityId: string,
): Record<string, unknown> {
  const calculation = plan.calculations.find((item) =>
    item.label.startsWith(entityId),
  );
  if (
    !calculation ||
    !calculation.value ||
    typeof calculation.value !== "object" ||
    Array.isArray(calculation.value)
  ) {
    return {};
  }
  return calculation.value as Record<string, unknown>;
}

function discountLabel(value: unknown): string {
  if (value === "earlyBird") return "本次适用早鸟优惠";
  if (value === "group") return "本次适用团报优惠";
  return "本次按标准价计算";
}

function reasonsForEntity(input: {
  entityId: string;
  output: ComposerOutput;
  state: ConversationState;
}): Array<
  RecommendationReasonItem & {
    constraintLabel: string;
    constraintValue: string;
  }
> {
  const group = input.output.recommendationReasons.find(
    (item) => item.entityId === input.entityId,
  );
  return (group?.reasons ?? []).map((item) => ({
    ...item,
    constraintLabel: CONSTRAINT_LABELS[item.constraintKey] ?? item.constraintKey,
    constraintValue: constraintValue(input.state, item.constraintKey),
  }));
}

function studentName(camp: Camp): string {
  const form = camp.campus === "online" ? "线上直播班" : `${camp.campus === "bj" ? "北京" : "上海"}线下班`;
  return `2026暑期AI素养夏令营·第${camp.period}期·${form}`;
}

function teacherName(product: TeacherProduct): string {
  const format = product.format === "intensive" ? "暑期集训班" : "周末研修班";
  return `初高中教师AI素养培训·${product.level}·${format}`;
}

function recommendationCard(input: {
  entityId: string;
  plan: ComposerPlan;
  state: ConversationState;
  output: ComposerOutput;
  sources: CollectedSource[];
}): ChatPresentation["recommendations"][number] | undefined {
  const entity = getKnowledgeEntityById(input.entityId);
  if (!entity) return undefined;
  const calculation = calculationForEntity(input.plan, input.entityId);
  const actualPrice = Number(calculation.total);

  if (input.entityId.startsWith("camp-")) {
    const camp = entity as Camp;
    return {
      entityId: camp.id,
      kind: "student",
      name: studentName(camp),
      date: `${camp.startDate} 至 ${camp.endDate}`,
      delivery: `${camp.locationName}｜${camp.addressOrPlatform}`,
      standardPrice: camp.standardPrice,
      actualPrice: Number.isFinite(actualPrice) ? actualPrice : camp.standardPrice,
      discountLabel: discountLabel(calculation.discountKind),
      reasons: reasonsForEntity(input),
      sources: sourcesForEntity(input.sources, camp.id),
      availabilityNote: "资料未提供实时余位；班型规模和最低开班人数均不代表剩余名额。",
    };
  }

  if (input.entityId.startsWith("teacher-")) {
    const product = entity as TeacherProduct;
    return {
      entityId: product.id,
      kind: "teacher",
      name: teacherName(product),
      date: product.schedule.join("；"),
      delivery: product.locationsOrPlatforms.join("；"),
      standardPrice: product.standardPrice,
      actualPrice: Number.isFinite(actualPrice) ? actualPrice : product.standardPrice,
      discountLabel: discountLabel(calculation.discountKind),
      reasons: reasonsForEntity(input),
      sources: sourcesForEntity(input.sources, product.id),
      availabilityNote: "资料未提供实时余位；班型规模和最低开班人数均不代表剩余名额。",
    };
  }

  return undefined;
}

function institutionServiceCard(
  plan: ComposerPlan,
  sources: CollectedSource[],
): ChatPresentation["institutionService"] {
  if (plan.status !== "institution_info" || plan.entityIds.length !== 1) {
    return undefined;
  }
  const entity = getKnowledgeEntityById(plan.entityIds[0]) as
    | PlatformService
    | undefined;
  if (!entity || !entity.id.startsWith("platform-")) return undefined;
  return {
    entityId: entity.id,
    name: entity.category,
    audience: entity.audience,
    pricingRule: entity.pricingRule ?? "资料未提供具体价格",
    boundary: entity.boundary,
    sources: sourcesForEntity(sources, entity.id),
  };
}

export function buildChatPresentation(input: {
  plan: ComposerPlan;
  state: ConversationState;
  output: ComposerOutput;
  sources: CollectedSource[];
}): ChatPresentation {
  const recommendations =
    input.plan.status === "recommended"
      ? input.plan.entityIds.flatMap((entityId) => {
          const card = recommendationCard({ ...input, entityId });
          return card ? [card] : [];
        })
      : [];
  return {
    recommendations,
    institutionService: institutionServiceCard(input.plan, input.sources),
  };
}
