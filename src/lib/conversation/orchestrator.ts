import type {
  ChatNotice,
  ChatResponse,
  ComposerOutput,
  ComposerPlan,
  ConversationIntent,
  ConversationState,
  FactTopic,
  TurnDiagnostics,
} from "@/lib/domain/conversation";
import type { BusinessDate } from "@/lib/time/shanghai";
import {
  collectSources,
  formatSourceFootnotes,
} from "@/lib/citations";
import {
  appendHistory,
  collectedConstraintKeys,
  createInitialConversationState,
  sanitizeConversationState,
  transitionConversationDomain,
} from "./session";
import { buildCatalogPlan, buildComposerPlan } from "./plan";
import { buildChatPresentation } from "./presentation";
import { resolveDeterministicTurnRouting } from "./routing";
import {
  regionDisplayNameFor,
  studentOfflineReason,
} from "./studentRegion";
import type { ClassifierCandidate } from "@/lib/llm/classifier";
import { applyClassifierCandidate } from "@/lib/llm/classifier";
import { recommendationReasonRequirements } from "@/lib/llm/composer";
import type { ComposerOutput as LlmComposerOutput } from "@/lib/domain/conversation";
import { isRetryableModelError } from "@/lib/llm/retry";
import {
  assertComposerDidNotWriteSources,
  assertComposerMentionedOnlyPlannedPeriods,
  assertDecisionTraceConstraints,
  assertFollowUpUsesClosedDimensions,
  assertHighRiskValuesGrounded,
  assertPlanMatchesConfirmedState,
  inferFactIdsForMentionedHighRiskValues,
  GroundingError,
  validateUsedFactIds,
} from "@/lib/validation/grounding";
import {
  InputValidationError,
  validateUserMessage,
} from "@/lib/validation/input";

export type ConversationDependencies = {
  currentDate: BusinessDate;
  classifier: {
    classify(message: string, state: ConversationState): Promise<ClassifierCandidate>;
  };
  composer: {
    composeOnce(
      plan: ComposerPlan,
      history: ConversationState["shortHistory"],
    ): Promise<ComposerOutput>;
  };
  diagnostics?: TurnDiagnostics;
};

export type ConversationRequest = {
  message?: unknown;
  state?: unknown;
  action?:
    | "message"
    | "reset"
    | "menu"
    | "catalog"
    | "select_domain"
    | "select_entity"
    | "inject_next_failure";
  domain?: "student" | "teacher" | "platform";
  entityId?: unknown;
  testMode?: boolean;
};

function scenarioBusinessDate(
  message: string,
  fallback: BusinessDate,
): BusinessDate {
  const match = message.match(
    /(?:^|[，,。；;\s])(20\d{2})年(\d{1,2})月(\d{1,2})日/u,
  );
  if (!match) return fallback;
  const candidate =
    `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` as BusinessDate;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : fallback;
}

const EMPTY_PRESENTATION: ChatResponse["presentation"] = {
  recommendations: [],
};

function operationalResponse(input: {
  status: ChatResponse["status"];
  message: string;
  state: ConversationState;
}): ChatResponse {
  return {
    status: input.status,
    message: input.message,
    state: input.state,
    sources: [],
    entityIds: [],
    actions: [],
    presentation: EMPTY_PRESENTATION,
    notices: [],
  };
}

function errorResponse(input: {
  state: ConversationState;
  code: NonNullable<ChatResponse["error"]>["code"];
  retryable: boolean;
  message: string;
}): ChatResponse {
  return {
    status: "error",
    message: input.message,
    state: input.state,
    sources: [],
    entityIds: [],
    actions: input.retryable ? ["重试"] : [],
    presentation: EMPTY_PRESENTATION,
    notices: [],
    error: { code: input.code, retryable: input.retryable },
  };
}

function hasCurrentBusinessContext(state: ConversationState): boolean {
  return Boolean(
    state.selectedEntityId ||
    state.lastRecommendationIds.length ||
    state.institutionNeed,
  );
}

function scopeClarificationResponse(state: ConversationState): ChatResponse {
  return {
    status: "unrelated",
    message:
      "这条信息似乎与课程或机构服务咨询无关。我可以继续协助查询学生课程、教师培训、费用、报名条件或机构采购。",
    state: structuredClone(state),
    sources: [],
    entityIds: [],
    actions: hasCurrentBusinessContext(state)
      ? ["继续当前咨询", "返回菜单"]
      : ["咨询学生课程", "咨询教师培训", "咨询机构服务", "返回菜单"],
    presentation: EMPTY_PRESENTATION,
    notices: [],
  };
}

function unsupportedExternalClaimsResponse(
  state: ConversationState,
): ChatResponse {
  return {
    status: "unrelated",
    message:
      "现有资料未提供合作学校名单、名校案例、收入数据或收入保证；我不能据此编造案例、背书或收益承诺。您可以继续咨询资料内的学生课程、教师培训、机构采购或平台服务。",
    state,
    sources: [],
    entityIds: [],
    actions: ["继续咨询机构服务", "返回菜单"],
    presentation: EMPTY_PRESENTATION,
    notices: [],
    boundaryCode: "unsupported_external_claims",
  };
}

function effectiveIntent(input: {
  deterministicIntent?: ConversationIntent;
  appliedIntent: ConversationIntent;
  factTopics: FactTopic[];
  acceptedConstraintKeys: string[];
  originalState: ConversationState;
  appliedState: ConversationState;
  message: string;
}): ConversationIntent {
  if (input.deterministicIntent) return input.deterministicIntent;
  const intent = input.appliedIntent;
  if (
    intent === "unrelated" ||
    intent === "unclear" ||
    intent === "unknown"
  ) {
    return input.originalState.domain === "unknown"
      ? "unknown"
      : "new_consultation";
  }
  if (intent === "contextual_followup" || intent === "fact_question") {
    return hasCurrentBusinessContext(input.originalState) &&
      input.factTopics.length > 0
      ? "contextual_followup"
      : "unclear";
  }
  const domainChanged =
    input.appliedState.domain !== input.originalState.domain &&
    input.appliedState.domain !== "unknown";
  if (intent === "identity_selection") {
    return domainChanged ? intent : "unclear";
  }
  if (intent === "institution_service") {
    return input.acceptedConstraintKeys.includes("institutionNeed") ||
      domainChanged
      ? intent
      : "unclear";
  }
  if (intent === "new_consultation" || intent === "recommendation") {
    const explicitBusinessRequest =
      /(?:推荐|咨询|了解|想报|报名|参加).{0,12}(?:课程|班型|学生班|培训|服务|夏令营)/u.test(
        input.message,
      );
    return input.acceptedConstraintKeys.length > 0 ||
      domainChanged ||
      explicitBusinessRequest
      ? "new_consultation"
      : "unclear";
  }
  if (intent === "reset" || intent === "menu") return intent;
  return input.originalState.domain === "unknown" ? "unknown" : "unclear";
}

function deterministicCandidate(input: {
  routingState: ConversationState;
  deterministicIntent?: ConversationIntent;
}): ClassifierCandidate {
  return {
    intent:
      input.deterministicIntent ??
      (input.routingState.domain === "unknown"
        ? "unknown"
        : "new_consultation"),
    studentConstraints: {},
    teacherConstraints: {},
    studentReference: {},
    teacherReference: {},
    factTopics: [],
    evidence: {},
  };
}

function incrementStalledTurns(
  state: ConversationState,
  madeProgress: boolean,
): void {
  if (state.domain === "student") {
    state.studentConstraints.stalledTurns = madeProgress
      ? 0
      : Math.min((state.studentConstraints.stalledTurns ?? 0) + 1, 3);
  }
  if (state.domain === "teacher") {
    state.teacherConstraints.stalledTurns = madeProgress
      ? 0
      : Math.min((state.teacherConstraints.stalledTurns ?? 0) + 1, 3);
  }
}

function prepareStateForPlan(
  state: ConversationState,
  plan: ComposerPlan,
): ConversationState {
  const next = structuredClone(state);
  next.pendingQuestionKeys = [...plan.nextQuestionKeys];
  next.pendingQuestionOptions = [...plan.nextQuestionOptions];
  if (plan.status === "recommended" || plan.status === "catalog") {
    next.lastRecommendationIds = [...plan.entityIds];
    next.selectedEntityId =
      plan.entityIds.length === 1 ? plan.entityIds[0] : undefined;
  } else if (plan.entityIds.length === 1 && !next.selectedEntityId) {
    next.selectedEntityId = plan.entityIds[0];
  }
  return next;
}

function recordPlanDiagnostics(
  dependencies: ConversationDependencies,
  state: ConversationState,
  plan: ComposerPlan,
): void {
  const diagnostics = dependencies.diagnostics;
  if (!diagnostics) return;
  diagnostics.confirmedDomain = state.domain;
  diagnostics.confirmedConstraints = structuredClone(plan.confirmedConstraints);
  diagnostics.pendingQuestionKeys = [...plan.nextQuestionKeys];
  diagnostics.entityIds = [...plan.entityIds];
  diagnostics.decisionTrace = structuredClone(plan.decisionTrace);
}

function addDiagnosticDuration(
  dependencies: ConversationDependencies,
  field:
    | "contextParsingMs"
    | "constraintExtractionMs"
    | "classifierMs"
    | "ruleExecutionMs"
    | "composerMs"
    | "groundingMs",
  startedAt: number,
): void {
  const diagnostics = dependencies.diagnostics;
  if (!diagnostics) return;
  diagnostics[field] += performance.now() - startedAt;
}

function measureRuleExecution<T>(
  dependencies: ConversationDependencies,
  operation: () => T,
): T {
  const startedAt = performance.now();
  try {
    return operation();
  } finally {
    addDiagnosticDuration(dependencies, "ruleExecutionMs", startedAt);
  }
}

function buildVerifiedComposerPlan(
  input: Parameters<typeof buildComposerPlan>[0],
): ComposerPlan {
  let plan = buildComposerPlan(input);
  try {
    assertPlanMatchesConfirmedState(input.state, plan);
  } catch (error) {
    if (
      !(error instanceof GroundingError) ||
      (error.reasonCode !== "recommendation_invariant" &&
        error.reasonCode !== "invalid_decision_trace")
    ) {
      throw error;
    }
    plan = buildComposerPlan(input);
    assertPlanMatchesConfirmedState(input.state, plan);
  }
  return plan;
}

function assertTraceFactsUsed(plan: ComposerPlan, usedFactIds: string[]): void {
  const used = new Set(usedFactIds);
  for (const trace of plan.decisionTrace) {
    if (trace.factIds.length && !trace.factIds.some((id) => used.has(id))) {
      throw new GroundingError(
        "missing_required_fact",
        `Composer omitted facts for decision trace: ${trace.code}`,
      );
    }
  }
}

function expectedRecommendationReasonKeys(
  plan: ComposerPlan,
  entityId: string,
): string[] {
  return [
    ...new Set(
      plan.decisionTrace
        .filter((trace) =>
          trace.factIds.some((factId) => factId.startsWith(`${entityId}.`)),
        )
        .flatMap((trace) => trace.constraintKeys),
    ),
  ];
}

function assertRecommendationReasons(
  plan: ComposerPlan,
  output: LlmComposerOutput,
): void {
  if (plan.status !== "recommended") {
    if (output.recommendationReasons.length) {
      throw new GroundingError(
        "recommendation_reason_mismatch",
        "Composer introduced recommendation reasons outside recommendation route",
      );
    }
    return;
  }

  const groups = new Map(
    output.recommendationReasons.map((group) => [group.entityId, group]),
  );
  if (
    groups.size !== output.recommendationReasons.length ||
    groups.size !== plan.entityIds.length
  ) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Composer recommendation reason groups are incomplete",
    );
  }

  for (const entityId of plan.entityIds) {
    const group = groups.get(entityId);
    const expected = expectedRecommendationReasonKeys(plan, entityId);
    const actual = group?.reasons.map(({ constraintKey }) => constraintKey) ?? [];
    if (
      actual.length !== new Set(actual).size ||
      actual.length !== expected.length ||
      expected.some((key) => !actual.includes(key))
    ) {
      throw new GroundingError(
        "recommendation_reason_mismatch",
        `Composer recommendation reasons do not match constraints: ${entityId}`,
      );
    }
  }
}

const OTHER_REGION_NAMES = [
  "天津",
  "重庆",
  "深圳",
  "成都",
  "杭州",
  "武汉",
  "南京",
  "苏州",
  "西安",
  "郑州",
  "青岛",
  "长沙",
  "厦门",
  "福州",
  "合肥",
  "济南",
  "沈阳",
  "大连",
  "哈尔滨",
  "长春",
  "昆明",
  "南宁",
  "海口",
  "石家庄",
  "太原",
  "南昌",
  "贵阳",
  "乌鲁木齐",
  "呼和浩特",
  "兰州",
  "西宁",
  "银川",
  "拉萨",
] as const;

function offlineFallbackRegion(plan: ComposerPlan): {
  region: "guangzhou" | "other";
  regionDisplayName?: string;
} | undefined {
  const region = plan.confirmedConstraints.region;
  if (region !== "guangzhou" && region !== "other") return undefined;
  const regionDisplayName =
    typeof plan.confirmedConstraints.regionDisplayName === "string"
      ? regionDisplayNameFor({
          region,
          regionDisplayName: plan.confirmedConstraints.regionDisplayName,
        })
      : regionDisplayNameFor({ region });
  return {
    region,
    ...(regionDisplayName ? { regionDisplayName } : {}),
  };
}

function hasOfflineFallbackTrace(traceCodes: Set<string>): boolean {
  return (
    (traceCodes.has("guangzhou_student_offline_not_provided") ||
      traceCodes.has("other_region_student_offline_not_provided")) &&
    traceCodes.has("beijing_shanghai_travel_unavailable") &&
    traceCodes.has("online_fallback_for_unmet_offline_preference")
  );
}

function assertOfflineBoundaryRegionResponse(
  plan: ComposerPlan,
  output: LlmComposerOutput,
): void {
  const traceCodes = new Set(plan.decisionTrace.map(({ code }) => code));
  const hasGuangzhouBoundary =
    traceCodes.has("student_guangzhou_offline_not_provided") ||
    traceCodes.has("guangzhou_student_offline_not_provided");
  const hasOtherRegionBoundary =
    traceCodes.has("student_other_region_offline_not_provided") ||
    traceCodes.has("other_region_student_offline_not_provided");
  if (!hasGuangzhouBoundary && !hasOtherRegionBoundary) return;

  const region = offlineFallbackRegion(plan);
  if (
    !region ||
    (hasGuangzhouBoundary && region.region !== "guangzhou") ||
    (hasOtherRegionBoundary && region.region !== "other")
  ) {
    throw new GroundingError(
      "invalid_decision_trace",
      "Offline boundary trace does not match the confirmed region",
      "region_location_mismatch",
    );
  }

  const allText = [
    output.message,
    ...output.recommendationReasons.flatMap(({ reasons }) =>
      reasons.map(({ reason }) => reason),
    ),
  ].join("\n");
  if (region.region === "other" && /广州/u.test(allText)) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Other-region boundary introduced Guangzhou",
      "region_location_mismatch",
    );
  }
  const inventedRegion = OTHER_REGION_NAMES.find(
    (name) => name !== region.regionDisplayName && allText.includes(name),
  );
  if (inventedRegion) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      `Offline boundary introduced an unconfirmed city: ${inventedRegion}`,
      "region_location_mismatch",
    );
  }
}

function assertOfflineFallbackResponse(
  plan: ComposerPlan,
  output: LlmComposerOutput,
): void {
  const traceCodes = new Set(plan.decisionTrace.map(({ code }) => code));
  if (!hasOfflineFallbackTrace(traceCodes)) return;
  const region = offlineFallbackRegion(plan);
  if (!region) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Offline fallback omitted its confirmed region",
      "other_region_offline_missing",
    );
  }

  const reasons = output.recommendationReasons.flatMap(({ reasons: items }) =>
    items,
  );
  const regionReason = reasons.find(
    ({ constraintKey }) => constraintKey === "region",
  )?.reason ?? "";
  const travelReason = reasons.find(
    ({ constraintKey }) => constraintKey === "canTravel",
  )?.reason ?? "";
  const modeReason = reasons.find(
    ({ constraintKey }) => constraintKey === "modePreference",
  )?.reason ?? "";
  const allText = [
    output.message,
    ...reasons.map(({ reason }) => reason),
  ].join("\n");
  const hasLocalLimit =
    /(?:没有|未提供|暂无).{0,16}(?:学生)?线下/u.test(regionReason);
  const usesConfirmedRegion =
    region.region === "guangzhou"
      ? /广州/u.test(regionReason)
      : region.regionDisplayName
        ? regionReason.includes(region.regionDisplayName) ||
          /(?:您所在地区|所在地区|当地)/u.test(regionReason)
        : /(?:您所在地区|所在地区|当地)/u.test(regionReason);
  if (!hasLocalLimit || !usesConfirmedRegion) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Offline fallback omitted the confirmed local offline limitation",
      region.region === "guangzhou"
        ? "guangzhou_offline_missing"
        : "other_region_offline_missing",
    );
  }
  if (region.region === "other" && /广州/u.test(allText)) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Other-region fallback introduced Guangzhou",
      "region_location_mismatch",
    );
  }
  if (region.region === "other") {
    const inventedRegion = OTHER_REGION_NAMES.find(
      (name) => name !== region.regionDisplayName && allText.includes(name),
    );
    if (inventedRegion) {
      throw new GroundingError(
        "recommendation_reason_mismatch",
        `Other-region fallback introduced an unconfirmed city: ${inventedRegion}`,
        "region_location_mismatch",
      );
    }
  }
  if (
    !/北京/u.test(travelReason) ||
    !/上海/u.test(travelReason) ||
    !/(?:不便|无法|不能|不方便|不前往)/u.test(travelReason)
  ) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Offline fallback omitted the Beijing and Shanghai travel limitation",
      "beijing_shanghai_travel_missing",
    );
  }
  if (
    !/线下/u.test(modeReason) ||
    !/线上/u.test(modeReason) ||
    !/(?:备选|替代|可行|兜底)/u.test(modeReason)
  ) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Offline fallback omitted the online downgrade explanation",
      "online_fallback_missing",
    );
  }
  if (
    /(?:完全|全部).{0,6}(?:符合|匹配)|(?:符合|匹配).{0,4}(?:线下偏好|所有约束)/u.test(
      allText,
    )
  ) {
    throw new GroundingError(
      "recommendation_reason_mismatch",
      "Offline fallback claimed that an unmet constraint fully matched",
      "false_full_match",
    );
  }

  if (!/(?:30\s*天.{0,6}回放|回放.{0,6}30\s*天)/u.test(allText)) {
    throw new GroundingError(
      "missing_required_fact",
      "Online fallback omitted the 30-day replay fact",
      "replay_30_missing",
    );
  }
  for (const entityId of plan.entityIds) {
    if (!output.usedFactIds.includes(`${entityId}.replayDays`)) {
      throw new GroundingError(
        "missing_required_fact",
        `Online fallback omitted replay fact ID: ${entityId}`,
        "replay_fact_id_missing",
      );
    }
  }
}

function normalizeSecondAttemptOfflineFallback(
  plan: ComposerPlan,
  output: LlmComposerOutput,
): LlmComposerOutput {
  const traceCodes = new Set(plan.decisionTrace.map(({ code }) => code));
  if (!hasOfflineFallbackTrace(traceCodes)) return output;
  const region = offlineFallbackRegion(plan);
  if (!region) return output;
  const correctText = (text: string) =>
    text
      .replace(
        /(?:完全|全部).{0,6}(?:符合|匹配)(?:.{0,8}(?:所有约束|全部约束|您的?约束|需求|要求))?/gu,
        "仍有线下偏好未满足",
      )
      .replace(
        /(?:符合|匹配).{0,4}(?:线下偏好|所有约束)/gu,
        "线下偏好仍未满足",
      );
  const period = Array.isArray(plan.confirmedConstraints.availablePeriods)
    ? plan.confirmedConstraints.availablePeriods[0]
    : undefined;
  const existingGroups = new Map(
    output.recommendationReasons.map((group) => [group.entityId, group]),
  );
  const recommendationReasons = recommendationReasonRequirements(plan).map(
    (requirement) => {
      const existingReasons = new Map(
        (existingGroups.get(requirement.entityId)?.reasons ?? []).map(
          (reason) => [reason.constraintKey, reason.reason],
        ),
      );
      return {
        entityId: requirement.entityId,
        reasons: requirement.constraintKeys.map((constraintKey) => {
          const fixedReasons: Record<string, string> = {
            region: studentOfflineReason(region),
            canTravel: "北京、上海均不便前往。",
            modePreference:
              "保留线下偏好；第一期线上直播是当前可行备选，并提供30天回放。",
            availablePeriods:
              period === undefined
                ? "推荐实体属于已确认的可参加营期。"
                : `已确认可参加第${period}期，推荐实体也属于第${period}期。`,
          };
          return {
            constraintKey,
            reason:
              fixedReasons[constraintKey] ??
              correctText(existingReasons.get(constraintKey) ?? ""),
          };
        }),
      };
    },
  );
  const replayFactIds = plan.entityIds
    .map((entityId) => `${entityId}.replayDays`)
    .filter((factId) => plan.facts.some(({ id }) => id === factId));
  return {
    ...output,
    message: correctText(output.message),
    usedFactIds: [...new Set([...output.usedFactIds, ...replayFactIds])],
    recommendationReasons,
  };
}

function assertSchoolProcurementMinimums(
  plan: ComposerPlan,
  output: LlmComposerOutput,
  usedFactIds: string[],
): void {
  if (
    plan.status !== "institution_info" ||
    !plan.entityIds.includes("platform-school-procurement")
  ) {
    return;
  }
  const hasPeopleMinimum = /20\s*人\s*起/u.test(output.message);
  const hasPriceMinimum =
    /(?:[5五]\s*万元|50\s*[,，]?\s*000\s*元)\s*起/u.test(output.message);
  const requiredFactIds = [
    "platform-school-procurement.minimumPeople",
    "platform-school-procurement.minimumTotalPrice",
  ];
  if (
    !hasPeopleMinimum ||
    !hasPriceMinimum ||
    requiredFactIds.some((factId) => !usedFactIds.includes(factId))
  ) {
    throw new GroundingError(
      "missing_required_fact",
      "School procurement answer omitted a required minimum",
    );
  }
}

function answerContainsBusinessDate(message: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (message.includes(value)) return true;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return false;
  const [, year, month, day] = match;
  return (
    message.includes(`${year}年${Number(month)}月${Number(day)}日`) ||
    message.includes(`${Number(month)}月${Number(day)}日`)
  );
}

function weekdayForBusinessDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return undefined;
  }
  return [
    "星期日",
    "星期一",
    "星期二",
    "星期三",
    "星期四",
    "星期五",
    "星期六",
  ][new Date(`${value}T00:00:00Z`).getUTCDay()];
}

function assertDirectFactAnswerCompleteness(input: {
  plan: ComposerPlan;
  output: LlmComposerOutput;
  userMessage: string;
  usedFactIds: string[];
}): void {
  if (input.plan.status !== "fact_answer") return;
  const used = new Set(input.usedFactIds);
  const factsBySuffix = (suffix: string) =>
    input.plan.facts.filter(({ id }) => id.endsWith(suffix));
  const usesSuffix = (suffix: string) =>
    [...used].some((id) => id.endsWith(suffix));

  if (
    input.plan.entityIds.some((id) => id.startsWith("camp-")) &&
    /什么时候上课/u.test(input.userMessage)
  ) {
    const startDate = factsBySuffix(".startDate")[0]?.value;
    const endDate = factsBySuffix(".endDate")[0]?.value;
    const registrationDeadline =
      factsBySuffix(".registrationDeadline")[0]?.value;
    const startWeekday = weekdayForBusinessDate(startDate);
    const endWeekday = weekdayForBusinessDate(endDate);
    if (
      !answerContainsBusinessDate(input.output.message, startDate) ||
      !answerContainsBusinessDate(input.output.message, endDate) ||
      !answerContainsBusinessDate(input.output.message, registrationDeadline) ||
      !startWeekday ||
      !endWeekday ||
      !input.output.message.includes(startWeekday) ||
      !input.output.message.includes(endWeekday) ||
      !/24[:：]00/u.test(input.output.message) ||
      !usesSuffix(".startDate") ||
      !usesSuffix(".endDate") ||
      !usesSuffix(".registrationDeadline")
    ) {
      throw new GroundingError(
        "missing_required_fact",
        "Camp schedule answer omitted a date, weekday, or registration cutoff",
        "camp_schedule_incomplete",
      );
    }
  }

  if (
    input.plan.entityIds.some((id) => id.startsWith("camp-")) &&
    /(?:还能|可以|是否|是不是).{0,6}报名/u.test(input.userMessage)
  ) {
    const registrationDeadline =
      factsBySuffix(".registrationDeadline")[0]?.value;
    if (
      !answerContainsBusinessDate(input.output.message, registrationDeadline) ||
      !/24[:：]00/u.test(input.output.message) ||
      !usesSuffix(".registrationDeadline")
    ) {
      throw new GroundingError(
        "missing_required_fact",
        "Registration answer omitted the 24:00 cutoff",
        "registration_cutoff_incomplete",
      );
    }
  }

  if (
    /(?:在哪里|在哪儿|哪里)/u.test(input.userMessage) &&
    factsBySuffix(".addressOrPlatform").some(
      ({ value }) => typeof value === "string" && value.includes("模拟地址"),
    ) &&
    (!input.output.message.includes("模拟地址") ||
      !usesSuffix(".addressOrPlatform"))
  ) {
    throw new GroundingError(
      "missing_required_fact",
      "Location answer omitted the simulated-address boundary",
      "simulated_address_missing",
    );
  }

  if (
    input.plan.entityIds.some((id) => id.startsWith("teacher-")) &&
    /怎么安排/u.test(input.userMessage)
  ) {
    const scheduleText = factsBySuffix(".schedule")
      .map(({ value }) => String(value))
      .join("；");
    const requiredDates = [...new Set(scheduleText.match(/\d+月\d+日/gu) ?? [])];
    const requiredHours = scheduleText.match(/共\d+课时/u)?.[0];
    if (
      requiredDates.some((date) => !input.output.message.includes(date)) ||
      (requiredHours && !input.output.message.includes(requiredHours)) ||
      !input.output.message.includes("线下") ||
      !usesSuffix(".schedule") ||
      !usesSuffix(".format") ||
      !usesSuffix(".locationsOrPlatforms")
    ) {
      throw new GroundingError(
        "missing_required_fact",
        "Teacher schedule answer omitted its date, hours, or delivery format",
        "teacher_schedule_incomplete",
      );
    }
  }

  if (
    input.plan.entityIds.some((id) => id.startsWith("teacher-")) &&
    /多少钱|费用|价格/u.test(input.userMessage)
  ) {
    const messageWithoutSeparators = input.output.message.replace(/,/gu, "");
    const earlyBirdDiscounts = [
      ...new Set(
        factsBySuffix(".earlyBirdDiscount")
          .map(({ value }) => value)
          .filter((value): value is number => typeof value === "number"),
      ),
    ];
    const groupDiscounts = [
      ...new Set(
        factsBySuffix(".groupDiscount")
          .map(({ value }) => value)
          .filter((value): value is number => typeof value === "number"),
      ),
    ];
    if (
      earlyBirdDiscounts.some(
        (amount) => !messageWithoutSeparators.includes(String(amount)),
      ) ||
      groupDiscounts.some(
        (amount) => !messageWithoutSeparators.includes(String(amount)),
      ) ||
      (earlyBirdDiscounts.length > 0 && !usesSuffix(".earlyBirdDiscount")) ||
      (groupDiscounts.length > 0 && !usesSuffix(".groupDiscount"))
    ) {
      throw new GroundingError(
        "missing_required_fact",
        "Teacher price answer omitted a stated discount condition",
        "teacher_price_incomplete",
      );
    }
  }

  if (
    input.plan.entityIds.some((id) => id.startsWith("teacher-")) &&
    /早鸟.{0,8}(?:减|优惠)|减\s*\d+\s*元/u.test(input.userMessage)
  ) {
    const messageWithoutSeparators = input.output.message.replace(/,/gu, "");
    const standardPrices = [
      ...new Set(
        factsBySuffix(".standardPrice")
          .map(({ value }) => value)
          .filter((value): value is number => typeof value === "number"),
      ),
    ];
    if (
      standardPrices.some(
        (amount) => !messageWithoutSeparators.includes(String(amount)),
      ) ||
      (standardPrices.length > 0 && !usesSuffix(".standardPrice"))
    ) {
      throw new GroundingError(
        "missing_required_fact",
        "Teacher early-bird answer omitted the resulting standard price",
        "teacher_early_bird_price_incomplete",
      );
    }
  }
}

function validateComposerOutput(input: {
  output: LlmComposerOutput;
  plan: ComposerPlan;
  userMessage: string;
}): { output: LlmComposerOutput; usedFactIds: string[] } {
  assertComposerDidNotWriteSources(input.output.message);
  for (const group of input.output.recommendationReasons) {
    for (const item of group.reasons) {
      assertComposerDidNotWriteSources(item.reason);
    }
  }
  assertRecommendationReasons(input.plan, input.output);
  assertOfflineBoundaryRegionResponse(input.plan, input.output);
  assertOfflineFallbackResponse(input.plan, input.output);
  assertComposerMentionedOnlyPlannedPeriods(
    [
      input.output.message,
      ...input.output.recommendationReasons.flatMap((group) =>
        group.reasons.map(({ reason }) => reason),
      ),
    ].join("\n"),
    input.plan.entityIds,
  );
  const modelUsedFactIds = validateUsedFactIds(
    input.output.usedFactIds,
    input.plan.facts,
  );
  const programmaticFactIds =
    input.plan.requiredPrefix !== undefined || input.plan.status === "catalog"
      ? input.plan.decisionTrace.flatMap(({ factIds }) => factIds)
      : [];
  const inferredHighRiskFactIds = inferFactIdsForMentionedHighRiskValues(
    [
      input.output.message,
      ...input.output.recommendationReasons.flatMap((group) =>
        group.reasons.map(({ reason }) => reason),
      ),
    ].join("\n"),
    input.plan.facts,
  );
  const usedFactIds = validateUsedFactIds(
    [
      ...modelUsedFactIds,
      ...programmaticFactIds,
      ...inferredHighRiskFactIds,
    ],
    input.plan.facts,
  );
  if (input.plan.facts.length && usedFactIds.length === 0) {
    throw new GroundingError(
      "missing_required_fact",
      "Composer omitted all source-backed facts",
    );
  }
  assertTraceFactsUsed(input.plan, usedFactIds);
  assertDirectFactAnswerCompleteness({
    plan: input.plan,
    output: input.output,
    userMessage: input.userMessage,
    usedFactIds,
  });
  assertHighRiskValuesGrounded({
    message: [
      input.output.message,
      ...input.output.recommendationReasons.flatMap((group) =>
        group.reasons.map(({ reason }) => reason),
      ),
    ].join("\n"),
    userMessage: input.userMessage,
    facts: input.plan.facts.filter(({ id }) => usedFactIds.includes(id)),
    calculations: input.plan.calculations,
  });
  assertSchoolProcurementMinimums(input.plan, input.output, usedFactIds);
  if (
    input.plan.nextQuestionKeys.length &&
    !/[?？]/u.test(input.output.message)
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer omitted the required follow-up question",
    );
  }
  assertFollowUpUsesClosedDimensions(
    input.output.message,
    input.plan.nextQuestionKeys,
  );
  const allowedActions = new Set(input.plan.actions);
  if (input.output.actions.some((action) => !allowedActions.has(action))) {
    throw new GroundingError(
      "unsupported_action",
      "Composer introduced an unsupported action",
    );
  }
  return { output: input.output, usedFactIds };
}

function retryFeedbackFor(error: unknown): string | undefined {
  if (!(error instanceof GroundingError)) return undefined;
  const detailFeedback: Record<string, string> = {
    guangzhou_offline_missing:
      "region理由必须明确说明广州没有、暂无或未提供学生线下班。",
    other_region_offline_missing:
      "region理由必须依据confirmedConstraints.regionDisplayName说明当地未提供学生线下班；没有名称时只能使用“您所在地区”。",
    region_location_mismatch:
      "删除所有未经confirmedConstraints确认的城市名；region=other时只能使用regionDisplayName或“您所在地区”，不得写广州。",
    beijing_shanghai_travel_missing:
      "canTravel理由必须同时写明北京和上海均不便前往。",
    online_fallback_missing:
      "modePreference理由必须保留线下偏好，并明确线上直播只是当前可行备选、替代或兜底。",
    false_full_match:
      "删除任何完全符合或全部匹配的说法，因为线下偏好未被满足。",
    replay_30_missing:
      "回答或理由必须明确写出所推荐线上班提供30天回放。",
    replay_fact_id_missing:
      "usedFactIds必须包含所推荐线上班的replayDays事实ID。",
    camp_schedule_incomplete:
      "学生营期回答必须同时写明开课和结束日期、对应星期、报名截止日24:00，并在usedFactIds中使用startDate、endDate、registrationDeadline。",
    simulated_address_missing:
      "地点回答必须完整保留地址事实中的“模拟地址”标记，并在usedFactIds中使用addressOrPlatform。",
    teacher_schedule_incomplete:
      "教师集训安排必须写明日期、总课时和线下授课形式，并在usedFactIds中使用schedule、format、locationsOrPlatforms。",
    registration_cutoff_incomplete:
      "报名状态回答必须写明报名截止日24:00，并在usedFactIds中使用registrationDeadline。",
    teacher_price_incomplete:
      "教师价格回答必须明确写出早鸟优惠金额和团报优惠金额，并在usedFactIds中使用earlyBirdDiscount、groupDiscount。",
    teacher_early_bird_price_incomplete:
      "教师早鸟状态回答必须明确写出当前标准价格，并在usedFactIds中使用standardPrice。",
  };
  if (error.detailCode && detailFeedback[error.detailCode]) {
    return detailFeedback[error.detailCode];
  }
  const feedback: Partial<Record<GroundingError["reasonCode"], string>> = {
    invalid_decision_trace:
      "只按已确认约束和decisionTrace生成，不得改变或新增约束。",
    invalid_fact_id:
      "usedFactIds只能使用本次facts中提供的合法ID。",
    missing_required_fact:
      "补齐decisionTrace要求的事实，并在usedFactIds中列出实际使用的对应ID。",
    ungrounded_amount:
      "删除或改正facts与calculations之外的金额，只使用已提供金额。",
    ungrounded_date:
      "删除或改正facts之外的日期，只使用已提供日期。",
    source_metadata_forbidden:
      "删除资料名称、素材编号、文档标题、章节号和来源说明；来源由程序另行追加。",
    human_impersonation:
      "保持AI课程顾问身份，不得扮演人工顾问、模拟人工或客服。",
    external_commitment:
      "删除真实联系、提交、锁位、报名或下单承诺，并明确本演示的服务边界。",
    period_mismatch:
      "只描述已确认营期和最终实体对应的营期，不得出现其他期次。",
    recommendation_invariant:
      "严格使用最终确认状态和最终实体，不得改变推荐对象或结构化约束。",
    recommendation_reason_mismatch:
      "逐项按recommendationReasonRequirements重写理由，不得声称未满足约束完全符合。",
    unsupported_follow_up:
      "只询问nextQuestionKeys列出的封闭维度，不得新增区县、学校、周末、考级或班型。",
    unsupported_action:
      "actions只能从本次载荷允许的actions中选择。",
  };
  return feedback[error.reasonCode];
}

async function completeComposerPlan(input: {
  workingState: ConversationState;
  plan: ComposerPlan;
  userMessage: string;
  dependencies: ConversationDependencies;
}): Promise<ChatResponse> {
  const initialGroundingStartedAt = performance.now();
  try {
    assertPlanMatchesConfirmedState(input.workingState, input.plan);
    assertDecisionTraceConstraints(
      input.plan.decisionTrace,
      collectedConstraintKeys(input.workingState),
    );
  } finally {
    addDiagnosticDuration(
      input.dependencies,
      "groundingMs",
      initialGroundingStartedAt,
    );
  }
  let generated:
    | { output: LlmComposerOutput; usedFactIds: string[] }
    | undefined;
  let lastError: unknown;
  let retryFeedback: string | undefined;
  for (const attempt of [1, 2] as const) {
    if (input.dependencies.diagnostics) {
      input.dependencies.diagnostics.composerAttempts += 1;
      if (attempt === 2) {
        input.dependencies.diagnostics.composerRetries += 1;
      }
    }
    try {
      const composerStartedAt = performance.now();
      let rawOutput: LlmComposerOutput;
      try {
        rawOutput = await input.dependencies.composer.composeOnce(
          retryFeedback
            ? { ...input.plan, retryFeedback }
            : input.plan,
          input.workingState.shortHistory,
        );
      } finally {
        addDiagnosticDuration(
          input.dependencies,
          "composerMs",
          composerStartedAt,
        );
      }
      const output =
        attempt === 2
          ? normalizeSecondAttemptOfflineFallback(input.plan, rawOutput)
          : rawOutput;
      const groundingStartedAt = performance.now();
      try {
        generated = validateComposerOutput({
          output,
          plan: input.plan,
          userMessage: input.userMessage,
        });
      } finally {
        addDiagnosticDuration(
          input.dependencies,
          "groundingMs",
          groundingStartedAt,
        );
      }
      break;
    } catch (error) {
      lastError = error;
      if (error instanceof GroundingError && input.dependencies.diagnostics) {
        input.dependencies.diagnostics.groundingFailures.push({
          attempt,
          reasonCode: error.reasonCode,
          ...(error.detailCode ? { detailCode: error.detailCode } : {}),
        });
      }
      if (attempt === 2 || !isRetryableModelError(error)) {
        throw error;
      }
      retryFeedback = retryFeedbackFor(error);
    }
  }
  if (!generated) throw lastError;

  const sources = collectSources(generated.usedFactIds);
  const prefixes = [input.plan.requiredPrefix].filter(
    (item): item is string => Boolean(item),
  );
  const body = [...prefixes, generated.output.message].join("\n");
  const finalMessage = `${body}${formatSourceFootnotes(generated.usedFactIds)}`;
  let state = prepareStateForPlan(input.workingState, input.plan);
  state = appendHistory(state, { role: "assistant", content: body });

  return {
    status: input.plan.status,
    message: finalMessage,
    state,
    sources,
    entityIds: input.plan.entityIds,
    actions: generated.output.actions,
    presentation: buildChatPresentation({
      plan: input.plan,
      state,
      output: generated.output,
      sources,
    }),
    notices: [],
    boundaryCode: input.plan.boundaryCode,
  };
}

function identitySwitchNotice(
  fromDomain: Exclude<ConversationState["domain"], "unknown">,
  toDomain: Exclude<ConversationState["domain"], "unknown">,
): ChatNotice {
  const labels = {
    student: "学生/家长",
    teacher: "教师",
    platform: "机构/学校",
  } as const;
  return {
    code: "identity_switched",
    message: `已切换为${labels[toDomain]}咨询。`,
    fromDomain,
    toDomain,
  };
}

function safeModelFailure(
  originalState: ConversationState,
  error: unknown,
): ChatResponse {
  if (error instanceof GroundingError) {
    return errorResponse({
      state: originalState,
      code: "grounding_rejected",
      retryable: true,
      message: "当前资料核对未通过，请重试。原有对话已保留。",
    });
  }
  const retryable = isRetryableModelError(error);
  return errorResponse({
    state: originalState,
    code: "model_unavailable",
    retryable,
    message: retryable
      ? "模型服务暂时不可用，请稍后重试。原有对话已保留。"
      : "模型服务尚未完成配置。原有对话已保留。",
  });
}

export async function runConversationTurn(
  request: ConversationRequest,
  dependencies: ConversationDependencies,
): Promise<ChatResponse> {
  const contextParsingStartedAt = performance.now();
  const originalState = sanitizeConversationState(request.state);
  const action = request.action ?? "message";

  if (action === "reset" || action === "menu") {
    const state = createInitialConversationState();
    return operationalResponse({
      status: action,
      message:
        action === "reset"
          ? "已清空本次对话，请重新选择身份。"
          : "已返回主菜单，请选择学生或家长、教师、机构或企业人员。",
      state,
    });
  }

  if (action === "select_domain") {
    if (
      request.domain !== "student" &&
      request.domain !== "teacher" &&
      request.domain !== "platform"
    ) {
      return errorResponse({
        state: originalState,
        code: "invalid_input",
        retryable: false,
        message: "请选择有效身份。",
      });
    }
    if (originalState.domain === request.domain) {
      return operationalResponse({
        status: "identity_selected",
        message: "当前身份无需重复选择，可以继续咨询现有班型或服务。",
        state: originalState,
      });
    }
    const state = transitionConversationDomain(originalState, request.domain);
    const plan = buildVerifiedComposerPlan({
      state,
      intent:
        request.domain === "platform"
          ? "institution_service"
          : "recommendation",
      factTopics: [],
      currentDate: dependencies.currentDate,
    });
    recordPlanDiagnostics(dependencies, state, plan);
    if (
      plan.status === "recommended" ||
      plan.status === "boundary_follow_up" ||
      plan.status === "institution_info"
    ) {
      const lastUserMessage = [...state.shortHistory]
        .reverse()
        .find(({ role }) => role === "user")?.content ?? "";
      try {
        return await completeComposerPlan({
          workingState: state,
          plan,
          userMessage: lastUserMessage,
          dependencies,
        });
      } catch (error) {
        return safeModelFailure(originalState, error);
      }
    }
    return operationalResponse({
      status: "identity_selected",
      message:
        request.domain === "student"
          ? "当前身份已设置为学生或家长，请描述所在城市、可参加时间和授课形式偏好。"
          : request.domain === "teacher"
            ? "当前身份已设置为教师，请描述当前基础、培训目标和时间安排。"
            : "当前身份已设置为机构或学校，请选择企业培训、学校采购、项目交付或会员权益。",
      state,
    });
  }

  if (action === "select_entity") {
    if (
      typeof request.entityId !== "string" ||
      !originalState.lastRecommendationIds.includes(request.entityId)
    ) {
      return errorResponse({
        state: originalState,
        code: "invalid_input",
        retryable: false,
        message: "该班型不在本次推荐结果中，请重新选择。",
      });
    }
    const state = structuredClone(originalState);
    state.selectedEntityId = request.entityId;
    state.pendingQuestionKeys = [];
    state.pendingQuestionOptions = [];
    return operationalResponse({
      status: "selection",
      message: "已将该班型设为当前咨询对象，可以继续询问时间、费用、地点或准备事项。",
      state,
    });
  }

  if (action === "inject_next_failure") {
    if (request.testMode !== true) {
      return errorResponse({
        state: originalState,
        code: "invalid_input",
        retryable: false,
        message: "测试模式未启用。",
      });
    }
    const state = structuredClone(originalState);
    state.test.failNextModelCall = true;
    return operationalResponse({
      status: "test_failure_armed",
      message: "下一次模型请求将模拟失败。",
      state,
    });
  }

  let message: string;
  try {
    message = validateUserMessage(request.message);
  } catch (error) {
    addDiagnosticDuration(
      dependencies,
      "contextParsingMs",
      contextParsingStartedAt,
    );
    return errorResponse({
      state: originalState,
      code: "invalid_input",
      retryable: false,
      message:
        error instanceof InputValidationError
          ? error.message
          : "输入无法处理。",
    });
  }
  addDiagnosticDuration(
    dependencies,
    "contextParsingMs",
    contextParsingStartedAt,
  );

  if (originalState.test.failNextModelCall) {
    const state = structuredClone(originalState);
    state.test.failNextModelCall = false;
    return errorResponse({
      state,
      code: "simulated_model_failure",
      retryable: true,
      message: "已模拟本次模型失败；原有对话已保留，可以重试。",
    });
  }

  try {
    if (action === "catalog") {
      const workingState = appendHistory(originalState, {
        role: "user",
        content: message,
      });
      const plan = measureRuleExecution(dependencies, () =>
        buildCatalogPlan({ state: workingState }),
      );
      recordPlanDiagnostics(dependencies, workingState, plan);
      return await completeComposerPlan({
        workingState,
        plan,
        userMessage: message,
        dependencies,
      });
    }

    const constraintExtractionStartedAt = performance.now();
    const deterministic = resolveDeterministicTurnRouting({
      message,
      state: originalState,
    });
    addDiagnosticDuration(
      dependencies,
      "constraintExtractionMs",
      constraintExtractionStartedAt,
    );
    if (deterministic.boundaryCode === "unsupported_external_claims") {
      if (dependencies.diagnostics) {
        dependencies.diagnostics.effectiveIntent = "unrelated";
      }
      return unsupportedExternalClaimsResponse(originalState);
    }
    if (deterministic.intent === "unrelated") {
      const plan = measureRuleExecution(dependencies, () =>
        buildVerifiedComposerPlan({
          state: originalState,
          intent: "unrelated",
          factTopics: [],
          currentDate: dependencies.currentDate,
        }),
      );
      if (dependencies.diagnostics) {
        dependencies.diagnostics.effectiveIntent = "unrelated";
      }
      recordPlanDiagnostics(dependencies, originalState, plan);
      return scopeClarificationResponse(originalState);
    }
    const deterministicCrossDomainFrom =
      deterministic.domain &&
      originalState.domain !== "unknown" &&
      originalState.domain !== deterministic.domain
        ? originalState.domain
        : undefined;
    const routingState = deterministic.domain
      ? transitionConversationDomain(originalState, deterministic.domain)
      : originalState;
    if (
      deterministic.catalogRequested &&
      routingState.domain !== "unknown" &&
      collectedConstraintKeys(routingState).length === 0
    ) {
      const workingState = appendHistory(routingState, {
        role: "user",
        content: message,
      });
      const plan = measureRuleExecution(dependencies, () =>
        buildCatalogPlan({ state: workingState }),
      );
      if (dependencies.diagnostics) {
        dependencies.diagnostics.effectiveIntent = "new_consultation";
      }
      recordPlanDiagnostics(dependencies, workingState, plan);
      return await completeComposerPlan({
        workingState,
        plan,
        userMessage: message,
        dependencies,
      });
    }
    if (
      deterministic.domain === "platform" &&
      deterministic.institutionNeed === "school_procurement" &&
      deterministic.intent === "institution_service"
    ) {
      routingState.institutionNeed = deterministic.institutionNeed;
      if (dependencies.diagnostics) {
        dependencies.diagnostics.effectiveIntent = deterministic.intent;
      }
      const workingState = appendHistory(routingState, {
        role: "user",
        content: message,
      });
      const deterministicIntent = deterministic.intent;
      const plan = measureRuleExecution(dependencies, () =>
        buildVerifiedComposerPlan({
          state: workingState,
          intent: deterministicIntent,
          factTopics: deterministic.factTopics,
          currentDate: scenarioBusinessDate(message, dependencies.currentDate),
          crossDomainFrom: deterministicCrossDomainFrom,
        }),
      );
      recordPlanDiagnostics(dependencies, workingState, plan);
      const response = await completeComposerPlan({
        workingState,
        plan,
        userMessage: message,
        dependencies,
      });
      if (deterministicCrossDomainFrom) {
        response.notices.push(
          identitySwitchNotice(
            deterministicCrossDomainFrom,
            "platform",
          ),
        );
      }
      return response;
    }
    let candidate: ClassifierCandidate;
    const skipClassifier =
      routingState.domain !== "unknown" ||
      deterministic.intent !== undefined;
    if (skipClassifier) {
      candidate = deterministicCandidate({
        routingState,
        deterministicIntent: deterministic.intent,
      });
    } else {
      const classifierStartedAt = performance.now();
      try {
        candidate = await dependencies.classifier.classify(
          message,
          routingState,
        );
      } finally {
        addDiagnosticDuration(
          dependencies,
          "classifierMs",
          classifierStartedAt,
        );
      }
      if (dependencies.diagnostics) {
        dependencies.diagnostics.classifierCandidate = {
          domainCandidate: candidate.domainCandidate,
          intent: candidate.intent,
          studentConstraints: structuredClone(candidate.studentConstraints),
          institutionNeed: candidate.institutionNeed,
          factTopics: [...candidate.factTopics],
        };
      }
    }
    if (deterministic.domain || deterministic.factTopics.length > 0) {
      candidate.domainCandidate = undefined;
    }
    const applied = applyClassifierCandidate({
      message,
      state: routingState,
      candidate,
      authoritativeStudentConstraints: deterministic.studentConstraints,
    });
    const crossDomainFrom =
      deterministicCrossDomainFrom ?? applied.crossDomainFrom;
    if (deterministic.institutionNeed && applied.state.domain === "platform") {
      applied.state.institutionNeed = deterministic.institutionNeed;
    }
    Object.assign(
      applied.state.teacherConstraints,
      deterministic.teacherConstraints,
    );
    if (deterministic.referencedEntityIds?.length) {
      applied.state.lastRecommendationIds = [
        ...new Set(deterministic.referencedEntityIds),
      ];
      applied.state.selectedEntityId =
        applied.state.lastRecommendationIds.length === 1
          ? applied.state.lastRecommendationIds[0]
          : undefined;
    }
    if (dependencies.diagnostics) {
      dependencies.diagnostics.corrections.push(
        ...structuredClone(applied.corrections),
      );
    }
    const acceptedConstraintKeys = [
      ...new Set([
        ...applied.acceptedConstraintKeys,
        ...Object.keys(deterministic.studentConstraints),
        ...Object.keys(deterministic.teacherConstraints),
        ...(deterministic.institutionNeed ? ["institutionNeed"] : []),
      ]),
    ];
    // Classifier fact topics are candidates only. A contextual follow-up may
    // inherit the current entity only after the deterministic question-shape
    // validator confirms that this turn actually asks about a supported field.
    const factTopics = [...deterministic.factTopics];
    const intent = effectiveIntent({
      deterministicIntent: deterministic.intent,
      appliedIntent: applied.intent,
      factTopics,
      acceptedConstraintKeys,
      originalState,
      appliedState: applied.state,
      message,
    });
    if (dependencies.diagnostics) {
      dependencies.diagnostics.effectiveIntent = intent;
    }
    if (intent === "reset" || intent === "menu") {
      const state = createInitialConversationState();
      return operationalResponse({
        status: intent,
        message:
          intent === "reset"
            ? "已清空本次对话，请重新选择身份。"
            : "已返回主菜单，请选择学生或家长、教师、机构或企业人员。",
        state,
      });
    }
    if (intent === "unrelated") {
      const plan = measureRuleExecution(dependencies, () =>
        buildVerifiedComposerPlan({
          state: originalState,
          intent: intent === "unrelated" ? "unrelated" : "unclear",
          factTopics: [],
          currentDate: dependencies.currentDate,
        }),
      );
      recordPlanDiagnostics(dependencies, originalState, plan);
      return scopeClarificationResponse(originalState);
    }
    const unansweredPendingQuestion =
      originalState.pendingQuestionKeys.length > 0 &&
      acceptedConstraintKeys.length === 0 &&
      (intent === "new_consultation" ||
        intent === "recommendation" ||
        intent === "unknown");
    if (unansweredPendingQuestion) {
      incrementStalledTurns(applied.state, false);
    } else if (acceptedConstraintKeys.length > 0) {
      incrementStalledTurns(applied.state, true);
    }

    const workingState = appendHistory(applied.state, {
      role: "user",
      content: message,
    });
    const plan = measureRuleExecution(dependencies, () =>
      buildVerifiedComposerPlan({
        state: workingState,
        intent,
        factTopics,
        currentDate: scenarioBusinessDate(message, dependencies.currentDate),
        crossDomainFrom,
      }),
    );
    recordPlanDiagnostics(dependencies, workingState, plan);
    const response = await completeComposerPlan({
      workingState,
      plan,
      userMessage: message,
      dependencies,
    });
    if (crossDomainFrom && workingState.domain !== "unknown") {
      response.notices.push(
        identitySwitchNotice(crossDomainFrom, workingState.domain),
      );
    }
    return response;
  } catch (error) {
    return safeModelFailure(originalState, error);
  }
}
