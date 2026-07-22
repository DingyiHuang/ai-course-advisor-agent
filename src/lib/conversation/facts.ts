import type { FactTopic, GroundedFact } from "@/lib/domain/conversation";
import type { KnowledgeEntity } from "@/lib/domain/knowledge";
import {
  CAMPS,
  PLATFORM_SERVICES,
  TEACHER_PRODUCTS,
} from "@/lib/knowledge";

const FIELD_LABELS: Record<string, string> = {
  locationName: "地点名称",
  addressOrPlatform: "地址或平台",
  startDate: "开始日期",
  endDate: "结束日期",
  registrationDeadline: "报名截止日期",
  earlyBirdDeadline: "早鸟截止日期",
  standardPrice: "标准价格",
  earlyBirdPrice: "早鸟价格",
  earlyBirdDiscount: "早鸟优惠金额",
  groupDiscount: "团报优惠金额",
  groupMinimum: "团报最低人数",
  groupScope: "团报适用范围",
  lodgingPrice: "食宿套餐价格",
  feeIncludes: "费用包含",
  replayDays: "回放天数",
  dailyOutline: "逐日课程大纲",
  requiredItems: "需携带物品",
  equipmentRequirements: "设备要求",
  refundRules: "退款规则",
  capacity: "班型规模",
  minimumToOpen: "最低开班人数",
  availabilityKnown: "实时余位是否已知",
  level: "能力等级",
  format: "班型形式",
  cities: "城市",
  locationsOrPlatforms: "地点或平台",
  schedule: "课程安排",
  deviceRequirements: "设备要求",
  replayPolicy: "回放规则",
  refundPolicyProvided: "是否提供退款规则",
  prerequisite: "前置条件",
  curriculumModules: "课程模块",
  outcome: "学习产出",
  category: "服务类别",
  audience: "适用对象",
  pricingRule: "计价规则",
  minimumPeople: "最低人数",
  minimumPricePerPerson: "最低人均价格",
  maximumPricePerPerson: "最高人均价格",
  minimumTotalPrice: "最低项目总价",
  minimumPrice: "最低价格",
  maximumPrice: "最高价格",
  priceProvided: "是否提供价格",
  grantsOrderPermission: "是否授予订单权限",
  grantsDirectOrderPermission: "是否直接授予订单权限",
  boundary: "资料边界",
};

const TOPIC_FIELDS: Record<FactTopic, string[]> = {
  schedule: ["startDate", "endDate", "schedule"],
  registration: ["registrationDeadline", "earlyBirdDeadline"],
  price: [
    "standardPrice",
    "earlyBirdPrice",
    "earlyBirdDiscount",
    "earlyBirdDeadline",
    "groupDiscount",
    "groupMinimum",
    "groupScope",
    "pricingRule",
    "minimumPricePerPerson",
    "maximumPricePerPerson",
    "minimumTotalPrice",
    "minimumPrice",
    "maximumPrice",
    "priceProvided",
  ],
  location: [
    "locationName",
    "addressOrPlatform",
    "cities",
    "locationsOrPlatforms",
  ],
  required_items: ["requiredItems", "equipmentRequirements", "deviceRequirements"],
  fee_includes: ["feeIncludes", "lodgingPrice"],
  refund: ["refundRules", "refundPolicyProvided"],
  replay: ["replayDays", "replayPolicy"],
  availability: ["availabilityKnown", "capacity", "minimumToOpen"],
  curriculum: ["dailyOutline", "curriculumModules", "outcome"],
  prerequisite: ["prerequisite"],
};

export function getKnowledgeEntityById(id: string): KnowledgeEntity | undefined {
  return (
    CAMPS.find((item) => item.id === id) ??
    TEACHER_PRODUCTS.find((item) => item.id === id) ??
    PLATFORM_SERVICES.find((item) => item.id === id)
  );
}

export function groundedFactFromId(factId: string): GroundedFact {
  const separator = factId.lastIndexOf(".");
  if (separator <= 0 || separator === factId.length - 1) {
    throw new Error(`Invalid fact ID: ${factId}`);
  }
  const entityId = factId.slice(0, separator);
  const field = factId.slice(separator + 1);
  const entity = getKnowledgeEntityById(entityId);
  if (!entity || !Object.prototype.hasOwnProperty.call(entity, field)) {
    throw new Error(`Fact value not found: ${factId}`);
  }
  return {
    id: factId,
    label: FIELD_LABELS[field] ?? field,
    value: (entity as unknown as Record<string, unknown>)[field],
  };
}

export function groundedFactsFromIds(factIds: string[]): GroundedFact[] {
  return [...new Set(factIds)].map(groundedFactFromId);
}

export function factsForTopics(
  entityId: string,
  topics: FactTopic[],
): GroundedFact[] {
  const entity = getKnowledgeEntityById(entityId);
  if (!entity) return [];
  const available = entity as unknown as Record<string, unknown>;
  const fields = [...new Set(topics.flatMap((topic) => TOPIC_FIELDS[topic]))];
  return fields
    .filter((field) => Object.prototype.hasOwnProperty.call(available, field))
    .map((field) => groundedFactFromId(`${entityId}.${field}`));
}
