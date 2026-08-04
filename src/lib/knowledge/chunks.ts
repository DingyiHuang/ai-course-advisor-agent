import type {
  Camp,
  KnowledgeChunk,
  KnowledgeChunkSource,
  PlatformService,
  SourceDocument,
  TeacherProduct,
} from "@/lib/domain/knowledge";
import { CAMPS } from "./camps";
import {
  PLATFORM_SERVICES,
  PLATFORM_SERVICE_FIELD_SOURCES,
} from "./platform";
import { TEACHER_PRODUCTS } from "./teachers";

export const MATERIAL_TITLES: Record<SourceDocument, string> = {
  A: "2026暑期AI素养夏令营课程手册",
  B: "初高中教师AI素养培训体系介绍",
  C: "OPC超级个体赋能平台产品白皮书",
};

function source(
  material: SourceDocument,
  chapter: string,
  section?: string,
): KnowledgeChunkSource {
  return {
    material,
    documentTitle: MATERIAL_TITLES[material],
    chapter,
    ...(section ? { section } : {}),
  };
}

function entityFacts(entityId: string, fields: readonly string[]): string[] {
  return fields.map((field) => `${entityId}.${field}`);
}

function kebabField(field: string): string {
  return field.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
}

function campLabel(camp: Camp): string {
  const delivery =
    camp.campus === "online"
      ? "线上直播班"
      : `${camp.campus === "bj" ? "北京" : "上海"}线下班`;
  return `第${camp.period}期${delivery}`;
}

const CAMP_LOGISTICS_FIELDS = [
  "period",
  "campus",
  "deliveryMode",
  "locationName",
  "addressOrPlatform",
  "startDate",
  "endDate",
  "registrationDeadline",
  "replayDays",
] as const;

const CAMP_PRICE_FIELDS = [
  "earlyBirdDeadline",
  "standardPrice",
  "earlyBirdPrice",
  "groupDiscount",
  "groupMinimum",
  "groupScope",
  "lodgingPrice",
  "accommodationPrice",
  "mealPrice",
  "feeIncludes",
] as const;

function campLogisticsChunk(camp: Camp): KnowledgeChunk {
  const replay =
    camp.deliveryMode === "online"
      ? `课程还提供${camp.replayDays}天回放。`
      : "该班型为线下授课，资料没有把线下实操作为回放服务。";
  return {
    id: `student-${camp.id}-logistics`,
    domain: "student",
    title: `${campLabel(camp)}的营期、地点与报名时间`,
    content:
      `${campLabel(camp)}从${camp.startDate}开营，到${camp.endDate}结营，报名截至${camp.registrationDeadline}。` +
      `授课地点为${camp.locationName}，具体安排是${camp.addressOrPlatform}。${replay}`,
    topics: ["overview", "schedule", "location", "registration", "replay"],
    entityIds: [camp.id],
    source: source("A", "第三章"),
    factIds: entityFacts(camp.id, CAMP_LOGISTICS_FIELDS),
  };
}

function campPriceChunk(camp: Camp): KnowledgeChunk {
  const lodging =
    camp.deliveryMode === "offline"
      ? `如自愿选择食宿套餐，合计${camp.lodgingPrice}元，其中住宿${camp.accommodationPrice}元、餐费${camp.mealPrice}元。`
      : "线上费用包含课程、30天回放和在线答疑，不涉及线下食宿。";
  return {
    id: `student-${camp.id}-pricing`,
    domain: "student",
    title: `${campLabel(camp)}的费用与优惠条件`,
    content:
      `${campLabel(camp)}标准价为${camp.standardPrice}元，在${camp.earlyBirdDeadline}前符合条件时早鸟价为${camp.earlyBirdPrice}元。` +
      `同一期、同一班型满${camp.groupMinimum}人团报，每人可优惠${camp.groupDiscount}元。${lodging}`,
    topics: ["price", "discount", "fee_includes", "registration"],
    entityIds: [camp.id],
    source: source("A", "第五章"),
    factIds: entityFacts(camp.id, CAMP_PRICE_FIELDS),
  };
}

const ALL_CAMP_IDS = CAMPS.map(({ id }) => id);

const STUDENT_SHARED_CHUNKS: KnowledgeChunk[] = [
  {
    id: "student-camp-overview",
    domain: "student",
    title: "学生夏令营班型与三期概览",
    content:
      "学生夏令营共有第一期、第二期和第三期，每期都有北京线下、上海线下与腾讯会议线上直播三种选择；展开具体班型时应以各期各地的日期和地点为准。",
    topics: ["overview", "catalog", "schedule", "location"],
    entityIds: ALL_CAMP_IDS,
    source: source("A", "第三章"),
    factIds: CAMPS.flatMap((camp) =>
      entityFacts(camp.id, ["period", "campus", "deliveryMode", "startDate", "endDate"]),
    ),
  },
  {
    id: "student-camp-daily-outline",
    domain: "student",
    title: "学生夏令营七天学习安排",
    content:
      "七天课程依次覆盖AI认知与工具体验、提示词工程、AI绘画、AI视频、智能体搭建、项目冲刺以及路演结营。第五天重点学习Agent、知识库、工作流、测试与边界，并完成个人学习助手Bot。",
    topics: ["curriculum", "day_1", "day_2", "day_3", "day_4", "day_5", "day_6", "day_7"],
    entityIds: ALL_CAMP_IDS,
    source: source("A", "第二章"),
    factIds: CAMPS.map(({ id }) => `${id}.dailyOutline`),
  },
  {
    id: "student-camp-required-items",
    domain: "student",
    title: "学生参营需要准备的物品",
    content:
      "所有学员都必须携带笔记本电脑和充电器，并按开营通知提前注册模拟或免费工具账号。线下学员还需准备身份证明复印件、洗漱用品、换洗衣物、水杯和雨具。",
    topics: ["required_items", "materials", "preparation"],
    entityIds: ALL_CAMP_IDS,
    source: source("A", "第六章"),
    factIds: CAMPS.map(({ id }) => `${id}.requiredItems`),
  },
  {
    id: "student-camp-equipment",
    domain: "student",
    title: "学生课程的电脑与网络要求",
    content:
      "电脑需使用Windows 10及以上或macOS 12及以上系统，内存至少8GB，并能正常运行Chrome或Edge及腾讯会议；参加线上班时，建议网络带宽不低于20Mbps。",
    topics: ["required_items", "equipment", "preparation"],
    entityIds: ALL_CAMP_IDS,
    source: source("A", "第六章"),
    factIds: CAMPS.map(({ id }) => `${id}.equipmentRequirements`),
  },
  {
    id: "student-camp-refund",
    domain: "student",
    title: "学生夏令营退款条件",
    content:
      "开营前至少15日取消可退90%，开营前7至14日取消可退50%；开营前不足7日或开营后取消不退款。",
    topics: ["refund", "registration", "boundary"],
    entityIds: ALL_CAMP_IDS,
    source: source("A", "第七章"),
    factIds: CAMPS.map(({ id }) => `${id}.refundRules`),
  },
  {
    id: "student-camp-availability-unknown",
    domain: "student",
    title: "学生班实时余位资料边界",
    content:
      "现有学生课程资料没有提供实时余位，因此不能用班型规模或最低开班人数推断当前剩余名额。",
    topics: ["availability", "unavailable", "boundary"],
    entityIds: ALL_CAMP_IDS,
    source: source("A", "第一章", "未提供实时余位"),
    factIds: CAMPS.map(({ id }) => `${id}.availabilityKnown`),
  },
];

function teacherLabel(product: TeacherProduct): string {
  return `${product.level}${product.format === "intensive" ? "暑期集训班" : "周末研修班"}`;
}

function teacherScheduleChunk(product: TeacherProduct): KnowledgeChunk {
  const cities = product.cities.length
    ? `资料列出的城市包括${product.cities.join("、")}。`
    : "资料没有为该班型指定固定城市，应以班型列出的腾讯会议与线下工作坊安排为准。";
  return {
    id: `${product.id}-schedule`,
    domain: "teacher",
    title: `${teacherLabel(product)}的时间、城市与授课安排`,
    content:
      `${teacherLabel(product)}的课程安排为${product.schedule.join("；")}，报名截至${product.registrationDeadline}。` +
      `${cities}授课地点或平台为${product.locationsOrPlatforms.join("、")}。`,
    topics: ["overview", "schedule", "location", "registration", product.level.toLowerCase(), product.format],
    entityIds: [product.id],
    source: source("B", "第二、四章"),
    factIds: entityFacts(product.id, [
      "level",
      "format",
      "cities",
      "locationsOrPlatforms",
      "startDate",
      "schedule",
      "registrationDeadline",
    ]),
  };
}

const TEACHER_BY_LEVEL = (["L1", "L2", "L3"] as const).map((level) => ({
  level,
  products: TEACHER_PRODUCTS.filter((product) => product.level === level),
}));

const TEACHER_LEVEL_CHUNKS: KnowledgeChunk[] = TEACHER_BY_LEVEL.flatMap(
  ({ level, products }) => {
    const sample = products[0];
    const entityIds = products.map(({ id }) => id);
    return [
      {
        id: `teacher-${level.toLowerCase()}-pricing`,
        domain: "teacher" as const,
        title: `${level}教师培训的费用与优惠`,
        content:
          `${level}教师培训标准价为${sample.standardPrice}元，在对应班型的早鸟截止日前报名可优惠${sample.earlyBirdDiscount}元。` +
          `同一班型满${sample.groupMinimum}人团报时每人可优惠${sample.groupDiscount}元，费用包含${sample.feeIncludes.join("、")}。`,
        topics: ["price", "discount", "fee_includes", level.toLowerCase()],
        entityIds,
        source: source("B", "第五章"),
        factIds: entityIds.flatMap((id) =>
          entityFacts(id, [
            "standardPrice",
            "earlyBirdDiscount",
            "groupDiscount",
            "groupMinimum",
            "feeIncludes",
            "earlyBirdDeadline",
          ]),
        ),
      },
      {
        id: `teacher-${level.toLowerCase()}-prerequisite`,
        domain: "teacher" as const,
        title: `${level}教师培训的前置条件`,
        content:
          sample.prerequisite === null
            ? `${level}面向零基础教师，资料没有设置先修课程要求。`
            : `参加${level}前需要${sample.prerequisite}，未满足时不应直接推荐该等级。`,
        topics: ["prerequisite", "boundary", level.toLowerCase()],
        entityIds,
        source: source("B", "第一、六章"),
        factIds: entityIds.map((id) => `${id}.prerequisite`),
      },
      {
        id: `teacher-${level.toLowerCase()}-curriculum`,
        domain: "teacher" as const,
        title: `${level}教师培训的课程内容与产出`,
        content:
          `${level}课程覆盖${sample.curriculumModules.join("、")}。完成后预期产出为${sample.outcome}。`,
        topics: ["curriculum", "outcome", level.toLowerCase()],
        entityIds,
        source: source("B", "第三章"),
        factIds: entityIds.flatMap((id) =>
          entityFacts(id, ["curriculumModules", "outcome"]),
        ),
      },
    ];
  },
);

const ALL_TEACHER_IDS = TEACHER_PRODUCTS.map(({ id }) => id);

const TEACHER_SHARED_CHUNKS: KnowledgeChunk[] = [
  {
    id: "teacher-product-overview",
    domain: "teacher",
    title: "教师培训等级与班型概览",
    content:
      "教师培训分为L1、L2和L3三个等级，每个等级都有暑期集训班与周末研修班。具体时间、城市、先修条件和费用应按所选等级与班型分别确认。",
    topics: ["overview", "catalog", "schedule", "prerequisite"],
    entityIds: ALL_TEACHER_IDS,
    source: source("B", "第一、二章"),
    factIds: TEACHER_PRODUCTS.flatMap((product) =>
      entityFacts(product.id, ["level", "format", "schedule"]),
    ),
  },
  {
    id: "teacher-device-and-replay",
    domain: "teacher",
    title: "教师培训的电脑与回放要求",
    content:
      "参加教师培训必须携带笔记本电脑，系统需为Windows 10及以上或macOS 12及以上，内存至少8GB。腾讯会议承载的线上部分提供30天回放，线下实操不提供回放。",
    topics: ["required_items", "equipment", "replay", "preparation"],
    entityIds: ALL_TEACHER_IDS,
    source: source("B", "第四章"),
    factIds: TEACHER_PRODUCTS.flatMap((product) =>
      entityFacts(product.id, ["deviceRequirements", "replayPolicy"]),
    ),
  },
  {
    id: "teacher-refund-unknown",
    domain: "teacher",
    title: "教师培训退款资料边界",
    content:
      "现有教师培训资料没有给出退款规则，因此不能自行补写取消条件或退费比例。",
    topics: ["refund", "unavailable", "boundary"],
    entityIds: ALL_TEACHER_IDS,
    source: source("B", "全文", "未提供退款规则"),
    factIds: TEACHER_PRODUCTS.map(({ id }) => `${id}.refundPolicyProvided`),
  },
  {
    id: "teacher-availability-unknown",
    domain: "teacher",
    title: "教师培训实时余位资料边界",
    content:
      "现有教师培训资料没有提供实时余位，不能据此承诺名额、锁位或当前报名状态。",
    topics: ["availability", "unavailable", "boundary"],
    entityIds: ALL_TEACHER_IDS,
    source: source("B", "第六章", "未提供实时余位"),
    factIds: TEACHER_PRODUCTS.map(({ id }) => `${id}.availabilityKnown`),
  },
];

function platformFieldSource(
  field: keyof PlatformService,
): KnowledgeChunkSource {
  const fieldSource = PLATFORM_SERVICE_FIELD_SOURCES[field];
  if (!fieldSource) throw new Error(`Platform source missing: ${String(field)}`);
  return source("C", fieldSource.chapter, fieldSource.section);
}

function platformChunks(service: PlatformService): KnowledgeChunk[] {
  const topic = service.id.replace("platform-", "");
  const chunks: KnowledgeChunk[] = [
    {
      id: `${service.id}-category`,
      domain: "platform",
      title: `${service.category}的服务类型`,
      content: `平台把这项服务归为${service.category}，咨询时应按这一服务域核对，不能套用其他课程或项目的规则。`,
      topics: ["overview", "catalog", "service_boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("category"),
      factIds: [`${service.id}.category`],
    },
    {
      id: `${service.id}-audience`,
      domain: "platform",
      title: `${service.category}的适用对象`,
      content: `${service.category}面向${service.audience}。`,
      topics: ["overview", "audience", "service_boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("audience"),
      factIds: [`${service.id}.audience`],
    },
    {
      id: `${service.id}-boundary`,
      domain: "platform",
      title: `${service.category}的资料边界`,
      content: `${service.boundary}。`,
      topics: ["boundary", "service_boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("boundary"),
      factIds: [`${service.id}.boundary`],
    },
  ];
  if (service.pricingRule) {
    chunks.push({
      id: `${service.id}-pricing`,
      domain: "platform",
      title: `${service.category}的计价规则`,
      content: `${service.category}按“${service.pricingRule}”执行，不能改用个人课程价格。`,
      topics: ["price", "pricing", "service_boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("pricingRule"),
      factIds: [`${service.id}.pricingRule`],
    });
  }
  for (const [field, sentence] of [
    ["minimumPeople", service.minimumPeople === undefined ? undefined : `这项服务要求至少${service.minimumPeople}人。`],
    ["minimumPricePerPerson", service.minimumPricePerPerson === undefined ? undefined : `人均价格下限为${service.minimumPricePerPerson}元。`],
    ["maximumPricePerPerson", service.maximumPricePerPerson === undefined ? undefined : `人均价格上限为${service.maximumPricePerPerson}元。`],
    ["minimumTotalPrice", service.minimumTotalPrice === undefined ? undefined : `项目总价从${service.minimumTotalPrice}元起。`],
    ["minimumPrice", service.minimumPrice === undefined ? undefined : `项目价格下限为${service.minimumPrice}元。`],
    ["maximumPrice", service.maximumPrice === undefined ? undefined : `项目价格上限为${service.maximumPrice}元。`],
  ] as const) {
    if (!sentence) continue;
    const fieldLabel: Record<string, string> = {
      minimumPeople: "最低人数条件",
      minimumPricePerPerson: "人均价格下限",
      maximumPricePerPerson: "人均价格上限",
      minimumTotalPrice: "项目总价下限",
      minimumPrice: "项目价格下限",
      maximumPrice: "项目价格上限",
    };
    chunks.push({
      id: `${service.id}-${kebabField(field)}`,
      domain: "platform",
      title: `${service.category}的${fieldLabel[field]}`,
      content: sentence,
      topics: ["price", "pricing", "service_boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource(field),
      factIds: [`${service.id}.${field}`],
    });
  }
  if (service.priceProvided === false) {
    chunks.push({
      id: `${service.id}-price-unavailable`,
      domain: "platform",
      title: `${service.category}的价格资料边界`,
      content: `现有资料没有提供${service.category}的具体售价，不能借用教师课程或其他服务价格举例。`,
      topics: ["price", "unavailable", "boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("priceProvided"),
      factIds: [`${service.id}.priceProvided`],
    });
  }
  if (service.grantsOrderPermission !== undefined) {
    chunks.push({
      id: `${service.id}-order-permission`,
      domain: "platform",
      title: `${service.category}与订单权限`,
      content: service.grantsOrderPermission
        ? `${service.category}会授予订单权限。`
        : `${service.category}不会授予订单权限。`,
      topics: ["registration", "permission", "boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("grantsOrderPermission"),
      factIds: [`${service.id}.grantsOrderPermission`],
    });
  }
  if (service.grantsDirectOrderPermission !== undefined) {
    chunks.push({
      id: `${service.id}-direct-order-permission`,
      domain: "platform",
      title: `${service.category}与直接订单权限`,
      content: service.grantsDirectOrderPermission
        ? `${service.category}会直接授予订单权限。`
        : `${service.category}不会直接授予订单权限，仍需满足资料规定的后续条件。`,
      topics: ["registration", "permission", "boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("grantsDirectOrderPermission"),
      factIds: [`${service.id}.grantsDirectOrderPermission`],
    });
  }
  if (service.id === "platform-contest") {
    chunks.push({
      id: `${service.id}-qualification-sequence`,
      domain: "platform",
      title: "大赛测试与订单权限的先后关系",
      content: "参加大赛只获得对应等级的测试资格，完成并通过测试后才会开通订单权限。",
      topics: ["registration", "permission", "boundary", topic],
      entityIds: [service.id],
      source: platformFieldSource("boundary"),
      factIds: [`${service.id}.boundary`, `${service.id}.grantsDirectOrderPermission`],
    });
  }
  return chunks;
}

export const KNOWLEDGE_CHUNKS: KnowledgeChunk[] = [
  ...CAMPS.map(campLogisticsChunk),
  ...CAMPS.map(campPriceChunk),
  ...STUDENT_SHARED_CHUNKS,
  ...TEACHER_PRODUCTS.map(teacherScheduleChunk),
  ...TEACHER_LEVEL_CHUNKS,
  ...TEACHER_SHARED_CHUNKS,
  ...PLATFORM_SERVICES.flatMap(platformChunks),
];

export function hasCompleteChunkSource(chunk: KnowledgeChunk): boolean {
  return Boolean(
    chunk.source.material &&
      chunk.source.documentTitle.trim() &&
      chunk.source.chapter.trim(),
  );
}

export const RUNTIME_KNOWLEDGE_CHUNKS = KNOWLEDGE_CHUNKS.filter(
  hasCompleteChunkSource,
);

export function getKnowledgeChunk(id: string): KnowledgeChunk | undefined {
  return RUNTIME_KNOWLEDGE_CHUNKS.find((chunk) => chunk.id === id);
}
