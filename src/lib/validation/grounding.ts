import type {
  GroundedCalculation,
  GroundedFact,
} from "@/lib/domain/conversation";
import type { DecisionTraceItem } from "@/lib/domain/rules";
import { collectSources } from "@/lib/citations";
import { extractMoneyAmounts } from "./money";

export class GroundingError extends Error {
  constructor(message: string) {
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
      `Composer used facts outside this response: ${rejected.join(", ")}`,
    );
  }
  collectSources(unique);
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
  if (rejectedAmounts.length || rejectedDates.length) {
    throw new GroundingError("Composer introduced an ungrounded amount or date");
  }
}

export function assertComposerDidNotWriteSources(message: string): void {
  assertComposerDidNotImpersonateHuman(message);
  if (/(?:来源|[素材资料]\s*[ABC]|第(?:[一二三四五六七八九十]+|\d+)章)/u.test(message)) {
    throw new GroundingError("Composer attempted to generate source metadata");
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
    throw new GroundingError("Composer attempted to impersonate a human advisor");
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
  const mentionedPeriods = [...message.matchAll(/第?\s*([一二三123])\s*期/gu)]
    .map((match) => numberMap[match[1]]);
  if (mentionedPeriods.some((period) => !allowedPeriods.has(period))) {
    throw new GroundingError("Composer changed the recommended period");
  }
}

export function assertFollowUpUsesClosedDimensions(
  message: string,
  nextQuestionKeys: string[],
): void {
  if (!nextQuestionKeys.length) return;
  const keys = new Set(nextQuestionKeys);
  if (
    keys.has("region") &&
    /(?:哪个|哪一个|具体).{0,6}(?:区县|城区|区)(?:呢|吗|？|\?|$)|(?:区县|城区).{0,6}(?:哪里|哪)/u.test(
      message,
    )
  ) {
    throw new GroundingError("Composer invented a district-level constraint");
  }
  if (
    keys.has("availablePeriods") &&
    /(?:周末|平日|平时|晚上|晚间).{0,6}(?:可以|有空|方便|上课)/u.test(message)
  ) {
    throw new GroundingError("Composer invented a non-period schedule constraint");
  }
  if (
    keys.has("modePreference") &&
    !keys.has("needsReplay") &&
    /录播/u.test(message)
  ) {
    throw new GroundingError("Composer treated replay as a delivery mode");
  }
  if (
    !keys.has("goal") &&
    /(?:考级|认证|学习目标)/u.test(message)
  ) {
    throw new GroundingError("Composer invented an unsupported follow-up dimension");
  }
}
