import type {
  ComposerPlan,
  ConversationIntent,
  ConversationState,
  FactTopic,
  GroundedCalculation,
  GroundedFact,
} from "@/lib/domain/conversation";
import type { BusinessDate } from "@/lib/time/shanghai";
import type { Camp, TeacherProduct } from "@/lib/domain/knowledge";
import { CAMPS, PLATFORM_SERVICES, TEACHER_PRODUCTS } from "@/lib/knowledge";
import { routeInstitutionNeed } from "@/lib/rules/institutionRouting";
import {
  calculateCampFee,
  calculateTeacherFee,
  recommendStudentCamps,
  recommendTeacherProducts,
} from "@/lib/rules";
import { resolveComposerRoute } from "@/lib/llm/composer";
import {
  factsForTopics,
  getKnowledgeEntityById,
  groundedFactsFromIds,
} from "./facts";
import { studentOfflineBoundaryStatement } from "./studentRegion";

function confirmedConstraints(
  state: ConversationState,
): Record<string, unknown> {
  if (state.domain === "student") {
    return Object.fromEntries(
      Object.entries(state.studentConstraints)
        .filter(
          ([key, value]) =>
            key !== "stalledTurns" &&
            key !== "refusesMoreQuestions" &&
            value !== undefined,
        )
        .map(([key, value]) => [key, structuredClone(value)]),
    );
  }
  if (state.domain === "teacher") {
    return Object.fromEntries(
      Object.entries(state.teacherConstraints)
        .filter(
          ([key, value]) =>
            key !== "stalledTurns" &&
            key !== "refusesMoreQuestions" &&
            value !== undefined,
        )
        .map(([key, value]) => [key, structuredClone(value)]),
    );
  }
  return state.domain === "platform" && state.institutionNeed
    ? { institutionNeed: state.institutionNeed }
    : {};
}

function finalizePlan(
  input: Omit<ComposerPlan, "route">,
): ComposerPlan {
  return {
    ...input,
    route: resolveComposerRoute(input),
  };
}

function crossDomainNotice(
  from: "student" | "teacher" | "platform" | undefined,
  to: ConversationState["domain"],
): string | undefined {
  if (!from || to === "unknown" || from === to) return undefined;
  const labels = {
    student: "学生课程资料",
    teacher: "教师培训资料",
    platform: "机构与平台资料",
  } as const;
  return `已从${labels[from]}切换到${labels[to]}，不同资料域的价格不会混用。`;
}

function basePlan(input: {
  state: ConversationState;
  status: ComposerPlan["status"];
  facts?: GroundedFact[];
  calculations?: GroundedCalculation[];
  decisionTrace?: ComposerPlan["decisionTrace"];
  nextQuestionKeys?: string[];
  nextQuestionOptions?: string[];
  actions?: string[];
  entityIds?: string[];
  boundaryCode?: string;
  requiredPrefix?: string;
  crossDomainFrom?: "student" | "teacher" | "platform";
  omitBusinessContext?: boolean;
}): ComposerPlan {
  return finalizePlan({
    status: input.status,
    domain: input.state.domain,
    confirmedConstraints: input.omitBusinessContext
      ? {}
      : confirmedConstraints(input.state),
    facts: input.facts ?? [],
    calculations: input.calculations ?? [],
    decisionTrace: input.decisionTrace ?? [],
    nextQuestionKeys: input.nextQuestionKeys ?? [],
    nextQuestionOptions: input.nextQuestionOptions ?? [],
    actions: input.actions ?? [],
    entityIds: input.entityIds ?? [],
    boundaryCode: input.boundaryCode,
    requiredPrefix: input.requiredPrefix,
    crossDomainNotice: input.omitBusinessContext
      ? undefined
      : crossDomainNotice(input.crossDomainFrom, input.state.domain),
  });
}

const CAMP_DISPLAY_FIELDS = [
  "locationName",
  "addressOrPlatform",
  "startDate",
  "endDate",
  "registrationDeadline",
  "earlyBirdDeadline",
  "standardPrice",
  "earlyBirdPrice",
  "feeIncludes",
] as const;

const TEACHER_DISPLAY_FIELDS = [
  "level",
  "format",
  "cities",
  "locationsOrPlatforms",
  "schedule",
  "registrationDeadline",
  "earlyBirdDeadline",
  "standardPrice",
  "earlyBirdDiscount",
  "feeIncludes",
  "prerequisite",
] as const;

function campRecommendationPlan(
  state: ConversationState,
  currentDate: BusinessDate,
  crossDomainFrom?: "student" | "teacher" | "platform",
): ComposerPlan {
  const result = recommendStudentCamps(state.studentConstraints);
  if (result.status === "recommended") {
    const traces = result.recommendations.flatMap(({ decisionTrace }) => decisionTrace);
    const factIds = result.recommendations.flatMap(({ item, factIds: reasonFacts }) => [
      ...reasonFacts,
      ...CAMP_DISPLAY_FIELDS.map((field) => `${item.id}.${field}`),
    ]);
    const fees = result.recommendations.map(({ item }) =>
      calculateCampFee({ camp: item, currentDate }),
    );
    const calculations = fees.map((fee, index) => ({
      label: `${result.recommendations[index].item.id}当前单人课程费`,
      value: {
        currentDate: fee.currentDate,
        total: fee.total,
        discountKind: fee.discountKind,
        registrationStatus: fee.registrationStatus,
        earlyBirdStatus: fee.earlyBirdStatus,
      },
      relatedFactIds: fee.factIds,
    }));
    return basePlan({
      state,
      status: "recommended",
      facts: groundedFactsFromIds([
        ...factIds,
        ...fees.flatMap(({ factIds: ids }) => ids),
      ]),
      calculations,
      decisionTrace: traces,
      actions: ["继续询问当前班型", "查看其他营期", "返回菜单"],
      entityIds: result.recommendations.map(({ item }) => item.id),
      crossDomainFrom,
    });
  }
  if (result.status === "needs_more_information") {
    return basePlan({
      state,
      status: "needs_more_information",
      nextQuestionKeys: result.missingConstraintKeys,
      actions: ["返回菜单"],
      crossDomainFrom,
    });
  }
  if (result.status === "insufficient_information") {
    return basePlan({
      state,
      status: "insufficient_information",
      actions: ["重新选择身份", "返回菜单"],
      crossDomainFrom,
    });
  }
  if (result.status === "boundary_follow_up") {
    return basePlan({
      state,
      status: "boundary_follow_up",
      facts: groundedFactsFromIds(result.factIds),
      decisionTrace: result.decisionTrace,
      nextQuestionKeys: result.nextQuestionKeys,
      nextQuestionOptions: result.nextQuestionOptions,
      actions: ["返回菜单"],
      boundaryCode: result.boundaryCode,
      requiredPrefix:
        result.boundaryCode === "student_guangzhou_offline_not_provided" ||
        result.boundaryCode === "student_other_region_offline_not_provided"
          ? studentOfflineBoundaryStatement(state.studentConstraints)
          : undefined,
      crossDomainFrom,
    });
  }
  if (result.status === "no_match") {
    return basePlan({
      state,
      status: "no_match",
      facts: groundedFactsFromIds(result.factIds),
      decisionTrace: result.decisionTrace,
      actions: ["调整日期条件", "返回菜单"],
      boundaryCode: result.boundaryCode,
      crossDomainFrom,
    });
  }
  throw new Error("Student recommendation returned an unsupported status");
}

function teacherRecommendationPlan(
  state: ConversationState,
  currentDate: BusinessDate,
  crossDomainFrom?: "student" | "teacher" | "platform",
): ComposerPlan {
  const result = recommendTeacherProducts(state.teacherConstraints);
  if (result.status === "boundary_follow_up") {
    const city = state.teacherConstraints.city ?? "您所在城市";
    const requiredPrefix =
      result.boundaryCode === "teacher_no_fully_online_product"
        ? `已记录您在${city}，且不便前往北京、上海或广州。当前资料范围内没有完全线上的教师班型；L1周末研修班上午为腾讯会议线上课程，下午仍需到指定城市参加线下工作坊。`
        : `已记录您在${city}。当前教师课程的线下开课城市为北京、上海和广州；L1周末研修班上午为腾讯会议线上课程，下午仍需到指定城市参加线下工作坊。`;
    return basePlan({
      state,
      status: "boundary_follow_up",
      facts: groundedFactsFromIds(result.factIds),
      decisionTrace: result.decisionTrace,
      nextQuestionKeys: result.nextQuestionKeys,
      nextQuestionOptions: result.nextQuestionOptions,
      actions: ["返回菜单"],
      boundaryCode: result.boundaryCode,
      requiredPrefix,
      crossDomainFrom,
    });
  }
  if (result.status === "recommended") {
    const traces = result.recommendations.flatMap(({ decisionTrace }) => decisionTrace);
    const factIds = result.recommendations.flatMap(({ item, factIds: reasonFacts }) => [
      ...reasonFacts,
      ...TEACHER_DISPLAY_FIELDS.map((field) => `${item.id}.${field}`),
    ]);
    const fees = result.recommendations.map(({ item }) =>
      calculateTeacherFee({ product: item, currentDate }),
    );
    return basePlan({
      state,
      status: "recommended",
      facts: groundedFactsFromIds([
        ...factIds,
        ...fees.flatMap(({ factIds: ids }) => ids),
      ]),
      calculations: fees.map((fee, index) => ({
        label: `${result.recommendations[index].item.id}当前单人课程费`,
        value: {
          currentDate: fee.currentDate,
          total: fee.total,
          discountKind: fee.discountKind,
          registrationStatus: fee.registrationStatus,
          earlyBirdStatus: fee.earlyBirdStatus,
        },
        relatedFactIds: fee.factIds,
      })),
      decisionTrace: traces,
      actions: ["继续询问当前班型", "查看其他班型", "返回菜单"],
      entityIds: result.recommendations.map(({ item }) => item.id),
      crossDomainFrom,
    });
  }
  if (result.status === "needs_more_information") {
    return basePlan({
      state,
      status: "needs_more_information",
      nextQuestionKeys: result.missingConstraintKeys,
      actions: ["返回菜单"],
      crossDomainFrom,
    });
  }
  if (result.status === "insufficient_information") {
    return basePlan({
      state,
      status: "insufficient_information",
      actions: ["重新选择身份", "返回菜单"],
      crossDomainFrom,
    });
  }
  if (result.status === "prerequisite_blocked") {
    return basePlan({
      state,
      status: "prerequisite_blocked",
      facts: groundedFactsFromIds(result.factIds),
      actions: [...result.nextActions, "返回菜单"],
      entityIds: [result.product.id],
      crossDomainFrom,
    });
  }
  return basePlan({
    state,
    status: "no_match",
    facts: groundedFactsFromIds(result.factIds),
    decisionTrace: result.decisionTrace,
    actions: ["调整日期条件", "返回菜单"],
    boundaryCode: result.boundaryCode,
    crossDomainFrom,
  });
}

function factQuestionPlan(input: {
  state: ConversationState;
  factTopics: FactTopic[];
  currentDate: BusinessDate;
  allowMultipleEntities: boolean;
  crossDomainFrom?: "student" | "teacher" | "platform";
}): ComposerPlan | undefined {
  const candidateIds = input.state.selectedEntityId
    ? [input.state.selectedEntityId]
    : input.state.lastRecommendationIds;
  if (!candidateIds.length) {
    return basePlan({
      state: input.state,
      status: "needs_more_information",
      nextQuestionKeys: ["selectedCourse"],
      actions: ["查看课程推荐", "返回菜单"],
      crossDomainFrom: input.crossDomainFrom,
    });
  }
  if (!input.factTopics.length) {
    return basePlan({
      state: input.state,
      status: "needs_more_information",
      nextQuestionKeys: ["factTopic"],
      actions: ["询问时间", "询问费用", "询问准备事项"],
      entityIds: candidateIds,
      crossDomainFrom: input.crossDomainFrom,
    });
  }
  const candidateFacts = candidateIds.map((id) => factsForTopics(id, input.factTopics));
  if (candidateIds.length > 1) {
    const valuesByLabel = new Map<string, Set<string>>();
    for (const fact of candidateFacts.flat()) {
      const values = valuesByLabel.get(fact.label) ?? new Set<string>();
      values.add(JSON.stringify(fact.value));
      valuesByLabel.set(fact.label, values);
    }
    if (
      !input.allowMultipleEntities &&
      [...valuesByLabel.values()].some((values) => values.size > 1)
    ) {
      return basePlan({
        state: input.state,
        status: "needs_more_information",
        nextQuestionKeys: ["selectedCourse"],
        actions: ["选择具体班型", "返回菜单"],
        entityIds: candidateIds,
        crossDomainFrom: input.crossDomainFrom,
      });
    }
  }
  let facts = input.allowMultipleEntities
    ? candidateFacts.flat()
    : candidateFacts[0] ?? [];
  const calculations: GroundedCalculation[] = [];
  if (input.factTopics.includes("schedule")) {
    for (const entityId of candidateIds) {
      const entity = getKnowledgeEntityById(entityId);
      if (entity?.id.startsWith("camp-")) {
        const camp = entity as Camp;
        const weekday = (date: string) =>
          ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][
            new Date(`${date}T00:00:00Z`).getUTCDay()
          ];
        calculations.push({
          label: `${camp.id}课程日期、星期与报名截止时间`,
          value: {
            startDate: camp.startDate,
            startWeekday: weekday(camp.startDate),
            endDate: camp.endDate,
            endWeekday: weekday(camp.endDate),
            registrationCutoff: `${camp.registrationDeadline} 24:00`,
          },
          relatedFactIds: [
            `${camp.id}.startDate`,
            `${camp.id}.endDate`,
            `${camp.id}.registrationDeadline`,
          ],
        });
      } else if (entity?.id.startsWith("teacher-")) {
        const product = entity as TeacherProduct;
        calculations.push({
          label: `${product.id}课程日期、课时与授课形式`,
          value: {
            schedule: product.schedule,
            format:
              product.format === "intensive"
                ? "连续集训"
                : "周末研修",
            locationsOrPlatforms: product.locationsOrPlatforms,
          },
          relatedFactIds: [
            `${product.id}.schedule`,
            `${product.id}.format`,
            `${product.id}.locationsOrPlatforms`,
          ],
        });
      }
    }
  }
  if (
    input.factTopics.some(
      (topic) => topic === "price" || topic === "registration",
    )
  ) {
    for (const entityId of candidateIds) {
      const entity = getKnowledgeEntityById(entityId);
      if (entity?.id.startsWith("camp-")) {
        const camp = entity as Camp;
        const groupSize = input.state.studentConstraints.groupSize;
        const fee = calculateCampFee({
          camp,
          currentDate: input.currentDate,
          group: groupSize
            ? {
                size: groupSize,
                samePeriodAndCamp:
                  input.state.studentConstraints.groupSamePeriodAndCamp === true,
              }
            : undefined,
          includeLodging:
            input.state.studentConstraints.includeLodging === true,
        });
        facts = groundedFactsFromIds([
          ...facts.map(({ id }) => id),
          ...fee.factIds,
        ]);
        calculations.push({
          label: `${camp.id}当前报名与费用状态`,
          value: {
            currentDate: input.currentDate,
            registrationStatus: fee.registrationStatus,
            registrationCutoff: `${camp.registrationDeadline} 24:00`,
            earlyBirdStatus: fee.earlyBirdStatus,
            basePrice: fee.basePrice,
            earlyBirdDiscount: fee.earlyBirdDiscount,
            groupDiscount: fee.groupDiscount,
            appliedDiscount: fee.appliedDiscount,
            total: fee.total,
            discountKind: fee.discountKind,
          },
          relatedFactIds: fee.factIds,
        });
      } else if (entity?.id.startsWith("teacher-")) {
        const product = entity as TeacherProduct;
        const fee = calculateTeacherFee({
          product,
          currentDate: input.currentDate,
        });
        facts = groundedFactsFromIds([
          ...facts.map(({ id }) => id),
          ...fee.factIds,
        ]);
        calculations.push({
          label: `${product.id}当前报名与费用状态`,
          value: {
            currentDate: input.currentDate,
            registrationStatus: fee.registrationStatus,
            registrationCutoff: `${product.registrationDeadline} 24:00`,
            earlyBirdStatus: fee.earlyBirdStatus,
            basePrice: fee.basePrice,
            earlyBirdDiscount: fee.earlyBirdDiscount,
            groupDiscount: fee.groupDiscount,
            appliedDiscount: fee.appliedDiscount,
            total: fee.total,
            discountKind: fee.discountKind,
          },
          relatedFactIds: fee.factIds,
        });
      }
    }
  }
  return basePlan({
    state: input.state,
    status: input.allowMultipleEntities ? "fact_answer" : "contextual_followup",
    facts,
    calculations,
    actions: ["继续询问当前班型", "返回菜单"],
    entityIds: candidateIds,
    crossDomainFrom: input.crossDomainFrom,
  });
}

export function buildComposerPlan(input: {
  state: ConversationState;
  intent: ConversationIntent;
  factTopics: FactTopic[];
  currentDate: BusinessDate;
  crossDomainFrom?: "student" | "teacher" | "platform";
}): ComposerPlan {
  if (input.intent === "unrelated") {
    const hasCurrentContext = Boolean(
      input.state.selectedEntityId ||
      input.state.lastRecommendationIds.length ||
      input.state.institutionNeed,
    );
    return basePlan({
      state: input.state,
      status: "unrelated",
      actions: hasCurrentContext
        ? ["继续当前咨询", "返回菜单"]
        : ["咨询学生课程", "咨询教师培训", "咨询机构服务", "返回菜单"],
      crossDomainFrom: input.crossDomainFrom,
      omitBusinessContext: true,
    });
  }
  if (input.state.domain === "unknown") {
    return basePlan({
      state: input.state,
      status: "needs_identity",
      nextQuestionKeys: ["identity"],
      nextQuestionOptions: ["学生或家长", "教师", "机构或企业人员"],
    });
  }
  if (
    input.intent === "fact_question" ||
    input.intent === "contextual_followup"
  ) {
    const plan = factQuestionPlan({
      ...input,
      allowMultipleEntities: input.intent === "fact_question",
    });
    if (plan) return plan;
  }
  const businessIntent =
    input.intent === "unclear" || input.intent === "unknown"
      ? "new_consultation"
      : input.intent;
  if (
    businessIntent !== "identity_selection" &&
    businessIntent !== "new_consultation" &&
    businessIntent !== "recommendation" &&
    businessIntent !== "institution_service"
  ) {
    return basePlan({
      state: input.state,
      status: "unrelated",
      actions: ["继续当前咨询", "返回菜单"],
      omitBusinessContext: true,
    });
  }
  if (input.state.domain === "student") {
    return campRecommendationPlan(
      input.state,
      input.currentDate,
      input.crossDomainFrom,
    );
  }
  if (input.state.domain === "teacher") {
    return teacherRecommendationPlan(
      input.state,
      input.currentDate,
      input.crossDomainFrom,
    );
  }
  if (!input.state.institutionNeed) {
    return basePlan({
      state: input.state,
      status: "needs_more_information",
      nextQuestionKeys: ["institutionNeed"],
      nextQuestionOptions: [
        "会员权益：了解平台会员和能力权益",
        "企业培训：面向企业团队的AI工具培训",
        "学校采购：学校统一采购教师培训",
        "项目交付：Agent、AI Web或知识库项目服务",
      ],
      actions: ["返回菜单"],
      crossDomainFrom: input.crossDomainFrom,
    });
  }
  const route = routeInstitutionNeed(input.state.institutionNeed);
  return basePlan({
    state: input.state,
    status: "institution_info",
    facts: groundedFactsFromIds(route.factIds),
    decisionTrace: route.decisionTrace,
    actions: ["查看模拟咨询流程", "整理采购需求清单", "返回菜单"],
    entityIds: [route.service.id],
    crossDomainFrom: input.crossDomainFrom,
  });
}

export function buildMaterialBoundaryPlan(input: {
  state: ConversationState;
  boundaryCode:
    | "material_contact_not_provided"
    | "material_extra_discount_not_provided"
    | "material_comparison_not_provided";
}): ComposerPlan {
  const entityIds = input.state.selectedEntityId
    ? [input.state.selectedEntityId]
    : input.state.lastRecommendationIds;
  return basePlan({
    state: input.state,
    status: "fact_answer",
    actions: ["继续当前咨询", "返回菜单"],
    entityIds,
    boundaryCode: input.boundaryCode,
  });
}

export function buildCatalogPlan(input: {
  state: ConversationState;
}): ComposerPlan {
  if (input.state.domain === "unknown") {
    return basePlan({
      state: input.state,
      status: "needs_identity",
      nextQuestionKeys: ["identity"],
      nextQuestionOptions: ["学生或家长", "教师", "机构或企业人员"],
    });
  }

  if (input.state.domain === "student") {
    const entityIds = CAMPS.map(({ id }) => id);
    const factIdsByEntity = entityIds.map((id) => [
      `${id}.period`,
      `${id}.deliveryMode`,
      `${id}.locationName`,
      `${id}.addressOrPlatform`,
      `${id}.startDate`,
      `${id}.endDate`,
      `${id}.standardPrice`,
      `${id}.earlyBirdPrice`,
    ]);
    return basePlan({
      state: input.state,
      status: "catalog",
      facts: groundedFactsFromIds(factIdsByEntity.flat()),
      decisionTrace: entityIds.map((id, index) => ({
        code: `catalog_${id}`,
        constraintKeys: [],
        factIds: factIdsByEntity[index],
      })),
      actions: ["返回菜单"],
      entityIds,
    });
  }

  if (input.state.domain === "teacher") {
    const entityIds = TEACHER_PRODUCTS.map(({ id }) => id);
    const factIdsByEntity = entityIds.map((id) => [
      `${id}.level`,
      `${id}.format`,
      `${id}.schedule`,
      `${id}.locationsOrPlatforms`,
      `${id}.standardPrice`,
      `${id}.prerequisite`,
    ]);
    return basePlan({
      state: input.state,
      status: "catalog",
      facts: groundedFactsFromIds(factIdsByEntity.flat()),
      decisionTrace: entityIds.map((id, index) => ({
        code: `catalog_${id}`,
        constraintKeys: [],
        factIds: factIdsByEntity[index],
      })),
      actions: ["返回菜单"],
      entityIds,
    });
  }

  const entityIds = PLATFORM_SERVICES.map(({ id }) => id);
  const factIdsByEntity = PLATFORM_SERVICES.map((service) => [
    `${service.id}.category`,
    `${service.id}.audience`,
    ...(service.pricingRule ? [`${service.id}.pricingRule`] : []),
    `${service.id}.boundary`,
  ]);
  return basePlan({
    state: input.state,
    status: "catalog",
    facts: groundedFactsFromIds(factIdsByEntity.flat()),
    decisionTrace: entityIds.map((id, index) => ({
      code: `catalog_${id}`,
      constraintKeys: [],
      factIds: factIdsByEntity[index],
    })),
    actions: ["返回菜单"],
    entityIds,
  });
}
