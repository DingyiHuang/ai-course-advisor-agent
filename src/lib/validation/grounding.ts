import type {
  GroundedCalculation,
  GroundedFact,
} from "@/lib/domain/conversation";
import type { DecisionTraceItem } from "@/lib/domain/rules";
import { collectSources } from "@/lib/citations";

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

function extractAmounts(text: string): number[] {
  const amounts = new Set<number>();
  for (const match of text.matchAll(/([0-9][0-9,]{2,})\s*[—–~-]\s*([0-9][0-9,]{2,})\s*元/gu)) {
    amounts.add(Number(match[1].replaceAll(",", "")));
    amounts.add(Number(match[2].replaceAll(",", "")));
  }
  for (const match of text.matchAll(/(?:[￥¥]\s*)?([0-9][0-9,]{2,})\s*元/gu)) {
    amounts.add(Number(match[1].replaceAll(",", "")));
  }
  for (const match of text.matchAll(/[￥¥]\s*([0-9][0-9,]{2,})/gu)) {
    amounts.add(Number(match[1].replaceAll(",", "")));
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*万\s*元?/gu)) {
    amounts.add(Number(match[1]) * 10_000);
  }
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*万\s*[—–~-]\s*(\d+(?:\.\d+)?)\s*万\s*元?/gu)) {
    amounts.add(Number(match[1]) * 10_000);
    amounts.add(Number(match[2]) * 10_000);
  }
  return [...amounts].filter(Number.isFinite);
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
  amounts: Set<number>,
  dates: Set<string>,
): void {
  if (typeof value === "number" && Number.isFinite(value) && value >= 100) {
    amounts.add(value);
    return;
  }
  if (typeof value === "string") {
    for (const amount of extractAmounts(value)) amounts.add(amount);
    for (const date of extractDates(value)) dates.add(date);
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
    if (iso) dates.add(`${Number(iso[2])}月${Number(iso[3])}日`);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectAllowedRisks(item, amounts, dates);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectAllowedRisks(item, amounts, dates);
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
    collectAllowedRisks(fact.value, amounts, dates);
  }
  for (const calculation of input.calculations) {
    collectAllowedRisks(calculation.value, amounts, dates);
  }
  if (input.userMessage) {
    collectAllowedRisks(input.userMessage, amounts, dates);
  }

  const rejectedAmounts = extractAmounts(input.message).filter(
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
  if (/(?:来源|[素材资料]\s*[ABC]|第(?:[一二三四五六七八九十]+|\d+)章)/u.test(message)) {
    throw new GroundingError("Composer attempted to generate source metadata");
  }
}
