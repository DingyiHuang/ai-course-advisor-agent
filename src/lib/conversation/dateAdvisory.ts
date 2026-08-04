import type { ComposerPlan } from "@/lib/domain/conversation";
import type { KnowledgeChunk } from "@/lib/domain/knowledge";

export type DateAdvisoryRequiredFact = {
  label: "报名截止" | "早鸟缴费截止";
  value: string;
  factId: string;
  requiredChunkId: string;
};

export type DateAdvisoryRequirements = {
  requiredFacts: [DateAdvisoryRequiredFact, DateAdvisoryRequiredFact];
  requiredPhrases: ["中国标准时间", "以主办方最新通知为准"];
};

function chineseBusinessDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return value;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

export function resolveDateAdvisoryRequirements(
  plan: ComposerPlan,
  chunks: KnowledgeChunk[],
): DateAdvisoryRequirements | undefined {
  if (plan.boundaryCode !== "registration_current_advisory") {
    return undefined;
  }

  for (const entityId of plan.entityIds) {
    const registrationFact = plan.facts.find(
      ({ id, value }) =>
        id === `${entityId}.registrationDeadline` && typeof value === "string",
    );
    const earlyBirdFact = plan.facts.find(
      ({ id, value }) =>
        id === `${entityId}.earlyBirdDeadline` && typeof value === "string",
    );
    if (!registrationFact || !earlyBirdFact) continue;

    const registrationChunk = chunks.find(
      (chunk) =>
        chunk.entityIds.includes(entityId) &&
        chunk.factIds.includes(registrationFact.id),
    );
    const earlyBirdChunk = chunks.find(
      (chunk) =>
        chunk.entityIds.includes(entityId) &&
        chunk.factIds.includes(earlyBirdFact.id),
    );
    if (!registrationChunk || !earlyBirdChunk) continue;

    return {
      requiredFacts: [
        {
          label: "报名截止",
          value: `${chineseBusinessDate(String(registrationFact.value))}24:00`,
          factId: registrationFact.id,
          requiredChunkId: registrationChunk.id,
        },
        {
          label: "早鸟缴费截止",
          value: chineseBusinessDate(String(earlyBirdFact.value)),
          factId: earlyBirdFact.id,
          requiredChunkId: earlyBirdChunk.id,
        },
      ],
      requiredPhrases: ["中国标准时间", "以主办方最新通知为准"],
    };
  }

  return undefined;
}
