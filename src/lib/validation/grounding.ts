import type {
  ComposerPlan,
  ConversationState,
  GroundedCalculation,
  GroundedFact,
  GroundingReasonCode,
} from "@/lib/domain/conversation";
import type { KnowledgeChunk } from "@/lib/domain/knowledge";
import type { DecisionTraceItem } from "@/lib/domain/rules";
import { collectSources } from "@/lib/citations";
import { CAMPS } from "@/lib/knowledge";
import { recommendStudentCamps } from "@/lib/rules/studentRecommendation";
import { extractMoneyAmounts } from "./money";

export class GroundingError extends Error {
  constructor(
    public readonly reasonCode: GroundingReasonCode,
    message: string,
    public readonly detailCode?: string,
  ) {
    super(message);
    this.name = "GroundingError";
  }
}

export function assertDecisionTraceConstraints(
  decisionTrace: DecisionTraceItem[],
  collectedKeys: Iterable<string>,
): void {
  const allowed = new Set(collectedKeys);
  const rejected = decisionTrace
    .flatMap(({ constraintKeys }) => constraintKeys)
    .filter((key) => !allowed.has(key));
  if (rejected.length) {
    throw new GroundingError(
      "invalid_decision_trace",
      `Decision trace contains uncollected constraints: ${[...new Set(rejected)].join(", ")}`,
    );
  }
}

export function validateUsedFactIds(
  usedFactIds: string[],
  allowedFacts: GroundedFact[],
): string[] {
  const allowed = new Set(allowedFacts.map(({ id }) => id));
  const unique = [...new Set(usedFactIds)];
  const rejected = unique.filter((id) => !allowed.has(id));
  if (rejected.length) {
    throw new GroundingError(
      "invalid_fact_id",
      `Composer used facts outside this response: ${rejected.join(", ")}`,
    );
  }
  collectSources(unique);
  return unique;
}

export function validateUsedChunkIds(
  usedChunkIds: string[],
  injectedChunks: KnowledgeChunk[],
  requireKnowledgeChunk: boolean,
): string[] {
  const available = new Set(injectedChunks.map(({ id }) => id));
  const unique = [...new Set(usedChunkIds)];
  const invalid = unique.find((id) => !available.has(id));
  if (invalid) {
    throw new GroundingError(
      "invalid_chunk_id",
      `Composer used a chunk outside this response: ${invalid}`,
    );
  }
  if (requireKnowledgeChunk && unique.length === 0) {
    throw new GroundingError(
      "missing_required_chunk",
      "Knowledge answer omitted all injected chunks",
    );
  }
  return unique;
}

function canonicalDate(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (iso) return `${iso[1]}-${Number(iso[2])}-${Number(iso[3])}`;
  const monthDay = value.match(/^(\d{1,2})月(\d{1,2})日$/u);
  if (monthDay) return `${Number(monthDay[1])}月${Number(monthDay[2])}日`;
  return value;
}

function extractDates(text: string): string[] {
  const dates = [
    ...(text.match(/\d{4}-\d{2}-\d{2}/gu) ?? []),
    ...(text.match(/\d{1,2}月\d{1,2}日/gu) ?? []),
  ].map(canonicalDate);
  for (const match of text.matchAll(/(\d{1,2})月(\d{1,2})\s*[—–~-]\s*(\d{1,2})日/gu)) {
    dates.push(
      canonicalDate(`${match[1]}月${match[2]}日`),
      canonicalDate(`${match[1]}月${match[3]}日`),
    );
  }
  return dates;
}

function collectAllowedRisks(
  value: unknown,
  context: string,
  amounts: Set<number>,
  dates: Set<string>,
): void {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    /(?:price|amount|total|discount|fee|cost|pricingrule|价格|费用|金额|报价)/iu.test(
      context,
    )
  ) {
    amounts.add(value);
    return;
  }
  if (typeof value === "string") {
    for (const amount of extractMoneyAmounts(value)) amounts.add(amount);
    for (const date of extractDates(value)) dates.add(date);
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (iso) dates.add(`${Number(iso[2])}月${Number(iso[3])}日`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAllowedRisks(item, context, amounts, dates);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      collectAllowedRisks(item, `${context}.${key}`, amounts, dates);
    }
  }
}

export function inferFactIdsForMentionedHighRiskValues(
  message: string,
  facts: GroundedFact[],
): string[] {
  const mentionedAmounts = new Set(extractMoneyAmounts(message));
  const mentionedDates = new Set(extractDates(message));
  if (mentionedAmounts.size === 0 && mentionedDates.size === 0) return [];

  return facts
    .filter((fact) => {
      const factAmounts = new Set<number>();
      const factDates = new Set<string>();
      collectAllowedRisks(
        fact.value,
        `${fact.id}.${fact.label}`,
        factAmounts,
        factDates,
      );
      return (
        [...mentionedAmounts].some((amount) => factAmounts.has(amount)) ||
        [...mentionedDates].some((date) => factDates.has(date))
      );
    })
    .map(({ id }) => id);
}

export function assertHighRiskValuesGrounded(input: {
  message: string;
  userMessage?: string;
  facts: GroundedFact[];
  calculations: GroundedCalculation[];
}): void {
  const amounts = new Set<number>();
  const dates = new Set<string>();
  for (const fact of input.facts) {
    collectAllowedRisks(fact.value, `${fact.id}.${fact.label}`, amounts, dates);
  }
  for (const calculation of input.calculations) {
    collectAllowedRisks(
      calculation.value,
      calculation.label,
      amounts,
      dates,
    );
  }
  if (input.userMessage) {
    collectAllowedRisks(input.userMessage, "userMessage", amounts, dates);
  }

  const rejectedAmounts = extractMoneyAmounts(input.message).filter(
    (amount) => !amounts.has(amount),
  );
  const rejectedDates = extractDates(input.message).filter(
    (date) => !dates.has(date),
  );
  if (rejectedAmounts.length) {
    throw new GroundingError(
      "ungrounded_amount",
      "Composer introduced an ungrounded amount",
    );
  }
  if (rejectedDates.length) {
    throw new GroundingError(
      "ungrounded_date",
      "Composer introduced an ungrounded date",
    );
  }
}

export function assertComposerDidNotWriteSources(message: string): void {
  assertComposerDidNotImpersonateHuman(message);
  assertComposerDidNotMakeExternalCommitment(message);
  const detailCode = /[素材资料]\s*[ABC]/u.test(message)
    ? "material_identifier"
    : /第(?:[一二三四五六七八九十]+|\d+)章/u.test(message)
      ? "chapter_reference"
      : /来源/u.test(message)
        ? "source_label"
        : undefined;
  if (detailCode) {
    throw new GroundingError(
      "source_metadata_forbidden",
      "Composer attempted to generate source metadata",
      detailCode,
    );
  }
}

export function assertComposerDidNotMakeExternalCommitment(
  message: string,
): void {
  const clauses = message.split(/[。！？!?；;\n]/u);
  const forbidden = clauses.some((clause) => {
    if (!clause.trim()) return false;
    return (
      /(?:已|已经)(?:为您|替您)?(?:安排|指派).{0,10}(?:人工)?(?:顾问|客服)/u.test(
        clause,
      ) ||
      /(?:顾问|客服).{0,10}(?:稍后|随后|之后|稍候|会|将).{0,8}(?:联系|添加|致电|回电)/u.test(
        clause,
      ) ||
      /(?:已|已经)(?:为您|替您)?(?:提交|登记|创建).{0,10}(?:采购需求|报名|订单|申请)/u.test(
        clause,
      ) ||
      /(?:已|已经)(?:为您|替您)?(?:锁定|预留).{0,8}(?:名额|席位)/u.test(
        clause,
      ) ||
      /(?:已|已经)(?:为您|替您)?报名/u.test(clause) ||
      /(?:会|将)(?:通过)?(?:电话|微信|短信).{0,8}(?:联系|通知)/u.test(
        clause,
      ) ||
      /(?:稍后|随后|之后|稍候).{0,8}(?:会有|将有|会由|将由)?(?:人工)?(?:顾问|客服).{0,8}(?:联系|添加|致电|回电)/u.test(
        clause,
      )
    );
  });
  if (forbidden) {
    throw new GroundingError(
      "external_commitment",
      "Composer made an unsupported real-world commitment",
    );
  }
}

export function assertComposerDidNotImpersonateHuman(message: string): void {
  const humanRole = String.raw`(?:模拟(?:的)?\s*)?人工(?:课程)?(?:顾问|客服)`;
  if (
    new RegExp(
      String.raw`(?:` +
        String.raw`(?:我|本人|这里)\s*(?:现在|目前|当前|接下来)?\s*(?:是|系|作为|会作为|将作为)\s*(?:一名\s*)?(?:您的?\s*)?${humanRole}` +
        String.raw`|作为\s*(?:一名\s*)?(?:您的?\s*)?${humanRole}\s*[,，]?\s*(?:我|本人)` +
        String.raw`|${humanRole}.{0,6}(?:为您服务|来为您服务|为您解答)` +
        String.raw`|(?:现在|目前|当前)\s*(?:由|将由)\s*${humanRole}.{0,6}(?:接待|服务|解答|处理)(?:您|你)` +
      String.raw`)`,
      "u",
    ).test(message)
  ) {
    throw new GroundingError(
      "human_impersonation",
      "Composer attempted to impersonate a human advisor",
    );
  }
}

export function assertComposerMentionedOnlyPlannedPeriods(
  message: string,
  entityIds: string[],
): void {
  const allowedPeriods = new Set(
    entityIds.flatMap((entityId) => {
      const match = entityId.match(/^camp-p([123])-/u);
      return match ? [Number(match[1])] : [];
    }),
  );
  if (!allowedPeriods.size) return;

  const numberMap: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    "1": 1,
    "2": 2,
    "3": 3,
  };
  const mentionedPeriods = [...message.matchAll(/第\s*([一二三123])\s*期/gu)]
    .map((match) => numberMap[match[1]]);
  if (mentionedPeriods.some((period) => !allowedPeriods.has(period))) {
    throw new GroundingError(
      "period_mismatch",
      "Composer changed the recommended period",
    );
  }
}

export function assertFollowUpUsesClosedDimensions(
  message: string,
  nextQuestionKeys: string[],
): void {
  const keys = new Set(nextQuestionKeys);
  const asksQuestion = /[?？]/u.test(message);
  if (
    /(?:哪个|哪一个|具体).{0,8}(?:区域|区县|城区|片区|行政区|区)(?:呢|吗|？|\?|$)|(?:区域|区县|城区|片区|行政区).{0,8}(?:哪里|哪)/u.test(
      message,
    )
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer invented a district-level constraint",
    );
  }
  if (
    asksQuestion &&
    /(?:周末|平日|平时|晚上|晚间).{0,8}(?:可以|有空|有时间|方便|能参加|上课)/u.test(
      message,
    )
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer invented a non-period schedule constraint",
    );
  }
  if (
    asksQuestion &&
    /(?:偏好|选择|想要|希望).{0,12}(?:线上|线下).{0,12}(?:录播|回放)|(?:线上|线下).{0,8}(?:还是|或).{0,6}(?:录播|回放)/u.test(
      message,
    )
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer treated replay as a delivery mode",
    );
  }
  if (
    asksQuestion &&
    !keys.has("goal") &&
    /(?:考级|认证|学习目标)/u.test(message)
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer invented an unsupported follow-up dimension",
    );
  }
  if (
    asksQuestion &&
    !keys.has("needsReplay") &&
    /(?:是否|要不要|需不需要|需要).{0,6}(?:录播|回放)|(?:录播|回放).{0,6}(?:吗|是否|需要)/u.test(
      message,
    )
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer asked for an unplanned replay constraint",
    );
  }
  if (
    asksQuestion &&
    /(?:哪个|哪所|什么).{0,6}(?:学校|年级)|(?:学校|年级).{0,6}(?:哪个|哪所|什么)/u.test(
      message,
    )
  ) {
    throw new GroundingError(
      "unsupported_follow_up",
      "Composer invented a school-level constraint",
    );
  }
}

const NEXT_QUESTION_KEYS: Record<
  ConversationState["domain"],
  ReadonlySet<string>
> = {
  unknown: new Set(["identity"]),
  student: new Set([
    "region",
    "availablePeriods",
    "modePreference",
    "canTravel",
    "preferredOfflineCampus",
    "needsReplay",
    "selectedCourse",
    "factTopic",
  ]),
  teacher: new Set([
    "level",
    "goal",
    "startingLevel",
    "canTakeContinuousLeave",
    "canTravelToCourseCity",
    "availableProductIds",
    "city",
    "prerequisiteStatus",
    "levelGoalOrStartingLevel",
    "availableDates",
    "selectedCourse",
    "factTopic",
  ]),
  platform: new Set(["institutionNeed", "selectedCourse", "factTopic"]),
};

export function assertNextQuestionKeysAllowed(
  domain: ConversationState["domain"],
  nextQuestionKeys: string[],
): void {
  const rejected = nextQuestionKeys.filter(
    (key) => !NEXT_QUESTION_KEYS[domain].has(key),
  );
  if (rejected.length) {
    throw new GroundingError(
      "unsupported_follow_up",
      `Plan contains unsupported follow-up keys: ${rejected.join(", ")}`,
    );
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function campForEntity(entityId: string) {
  return CAMPS.find(({ id }) => id === entityId);
}

export function assertPlanMatchesConfirmedState(
  state: ConversationState,
  plan: ComposerPlan,
): void {
  if (state.domain !== plan.domain) {
    throw new GroundingError(
      "recommendation_invariant",
      "Composer plan domain does not match confirmed state",
    );
  }
  assertNextQuestionKeysAllowed(plan.domain, plan.nextQuestionKeys);
  if (
    plan.status === "unrelated" &&
    (
      Object.keys(plan.confirmedConstraints).length > 0 ||
      plan.facts.length > 0 ||
      plan.calculations.length > 0 ||
      plan.decisionTrace.length > 0 ||
      plan.entityIds.length > 0 ||
      plan.nextQuestionKeys.length > 0 ||
      plan.nextQuestionOptions.length > 0 ||
      plan.requiredPrefix !== undefined ||
      plan.boundaryCode !== undefined
    )
  ) {
    throw new GroundingError(
      "recommendation_invariant",
      "Unrelated plan carried business context",
    );
  }

  const confirmed =
    state.domain === "student"
      ? state.studentConstraints
      : state.domain === "teacher"
        ? state.teacherConstraints
        : state.domain === "platform"
          ? { institutionNeed: state.institutionNeed }
          : {};
  for (const [key, value] of Object.entries(plan.confirmedConstraints)) {
    if (!sameValue(value, (confirmed as Record<string, unknown>)[key])) {
      throw new GroundingError(
        "recommendation_invariant",
        `Composer plan changed confirmed constraint: ${key}`,
      );
    }
  }

  for (const trace of plan.decisionTrace) {
    for (const key of trace.constraintKeys) {
      if (
        trace.constraintValues &&
        key in trace.constraintValues &&
        !sameValue(
          trace.constraintValues[key],
          (plan.confirmedConstraints as Record<string, unknown>)[key],
        )
      ) {
        throw new GroundingError(
          "invalid_decision_trace",
          `Decision trace changed confirmed constraint: ${key}`,
        );
      }
    }
    if (
      trace.constraintValues &&
      "regionDisplayName" in trace.constraintValues &&
      !sameValue(
        trace.constraintValues.regionDisplayName,
        plan.confirmedConstraints.regionDisplayName,
      )
    ) {
      throw new GroundingError(
        "invalid_decision_trace",
        "Decision trace changed confirmed region display name",
      );
    }
  }

  if (state.domain !== "student") return;
  if (plan.status === "recommended") {
    const deterministic = recommendStudentCamps(state.studentConstraints);
    if (
      deterministic.status !== "recommended" ||
      !sameValue(
        plan.entityIds,
        deterministic.recommendations.map(({ item }) => item.id),
      )
    ) {
      throw new GroundingError(
        "recommendation_invariant",
        "Student recommendation entities differ from deterministic output",
      );
    }
  }
  const periods = state.studentConstraints.availablePeriods;
  if (!periods?.length) return;
  if (
    plan.status !== "recommended" &&
    plan.status !== "fact_answer" &&
    plan.status !== "contextual_followup"
  ) {
    return;
  }
  const studentEntityIds = plan.entityIds.filter((id) => id.startsWith("camp-"));
  for (const entityId of studentEntityIds) {
    const camp = campForEntity(entityId);
    if (!camp || !periods.includes(camp.period)) {
      throw new GroundingError(
        "recommendation_invariant",
        `Student entity escaped confirmed periods: ${entityId}`,
      );
    }
  }
  for (const trace of plan.decisionTrace) {
    for (const factId of trace.factIds) {
      const entityId = factId.slice(0, factId.lastIndexOf("."));
      if (!entityId.startsWith("camp-")) continue;
      const camp = campForEntity(entityId);
      if (!camp || !periods.includes(camp.period)) {
        throw new GroundingError(
          "invalid_decision_trace",
          `Decision trace escaped confirmed periods: ${factId}`,
        );
      }
    }
  }
  if (
    plan.status === "recommended" &&
    !plan.decisionTrace.some(
      ({ code, constraintValues }) =>
        code === "period_available" &&
        sameValue(constraintValues?.availablePeriods, periods),
    )
  ) {
    throw new GroundingError(
      "invalid_decision_trace",
      "Recommendation omitted the confirmed period trace",
    );
  }

  if (
    plan.status === "recommended" &&
    (state.studentConstraints.region === "guangzhou" ||
      state.studentConstraints.region === "other") &&
    state.studentConstraints.modePreference === "offline" &&
    state.studentConstraints.canTravel === false
  ) {
    const requiredCodes = [
      state.studentConstraints.region === "guangzhou"
        ? "guangzhou_student_offline_not_provided"
        : "other_region_student_offline_not_provided",
      "beijing_shanghai_travel_unavailable",
      "online_fallback_for_unmet_offline_preference",
    ];
    const traceCodes = new Set(plan.decisionTrace.map(({ code }) => code));
    if (
      requiredCodes.some((code) => !traceCodes.has(code)) ||
      studentEntityIds.some(
        (entityId) => campForEntity(entityId)?.campus !== "online",
      )
    ) {
      throw new GroundingError(
        "recommendation_invariant",
        "Non-Beijing/Shanghai offline fallback is incomplete",
      );
    }
  }
}
