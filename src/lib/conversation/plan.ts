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
  requiredPrefix?: string;
  crossDomainFrom?: "student" | "teacher" | "platform";
}): ComposerPlan {
  return finalizePlan({
    status: input.status,
    domain: input.state.domain,
    facts: input.facts ?? [],
    calculations: input.calculations ?? [],
    decisionTrace: input.decisionTrace ?? [],
    nextQuestionKeys: input.nextQuestionKeys ?? [],
    nextQuestionOptions: input.nextQuestionOptions ?? [],
    actions: input.actions ?? [],
    entityIds: input.entityIds ?? [],
    requiredPrefix: input.requiredPrefix,
    crossDomainNotice: crossDomainNotice(
      input.crossDomainFrom,
      input.state.domain,
    ),
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
      requiredPrefix:
        result.boundaryCode === "student_guangzhou_offline_not_provided"
          ? "素材A没有广州学生线下班。"
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
    crossDomainFrom,
  });
}

function factQuestionPlan(input: {
  state: ConversationState;
  factTopics: FactTopic[];
  currentDate: BusinessDate;
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
    if ([...valuesByLabel.values()].some((values) => values.size > 1)) {
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
  const selectedId = candidateIds[0];
  let facts = candidateFacts[0] ?? [];
  const calculations: GroundedCalculation[] = [];
  const entity = getKnowledgeEntityById(selectedId);
  if (entity?.id.startsWith("camp-") && input.factTopics.some((topic) => topic === "price" || topic === "schedule" || topic === "registration")) {
    const camp = entity as Camp;
    const fee = calculateCampFee({ camp, currentDate: input.currentDate });
    facts = groundedFactsFromIds([
      ...facts.map(({ id }) => id),
      ...fee.factIds,
    ]);
    calculations.push({
      label: `${camp.id}当前报名与费用状态`,
      value: {
        currentDate: input.currentDate,
        registrationStatus: fee.registrationStatus,
        earlyBirdStatus: fee.earlyBirdStatus,
        total: fee.total,
        discountKind: fee.discountKind,
      },
      relatedFactIds: fee.factIds,
    });
  } else if (entity?.id.startsWith("teacher-") && input.factTopics.some((topic) => topic === "price" || topic === "schedule" || topic === "registration")) {
    const product = entity as TeacherProduct;
    const fee = calculateTeacherFee({ product, currentDate: input.currentDate });
    facts = groundedFactsFromIds([
      ...facts.map(({ id }) => id),
      ...fee.factIds,
    ]);
    calculations.push({
      label: `${product.id}当前报名与费用状态`,
      value: {
        currentDate: input.currentDate,
        registrationStatus: fee.registrationStatus,
        earlyBirdStatus: fee.earlyBirdStatus,
        total: fee.total,
        discountKind: fee.discountKind,
      },
      relatedFactIds: fee.factIds,
    });
  }
  return basePlan({
    state: input.state,
    status: "fact_answer",
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
    return basePlan({
      state: input.state,
      status: "unrelated",
      actions: ["咨询学生课程", "咨询教师培训", "咨询机构服务"],
      crossDomainFrom: input.crossDomainFrom,
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
  if (input.intent === "fact_question") {
    const plan = factQuestionPlan(input);
    if (plan) return plan;
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
        "会员权益",
        "企业培训",
        "学校采购",
        "项目交付",
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
    actions: ["联系模拟人工顾问", "返回菜单"],
    entityIds: [route.service.id],
    crossDomainFrom: input.crossDomainFrom,
  });
}
