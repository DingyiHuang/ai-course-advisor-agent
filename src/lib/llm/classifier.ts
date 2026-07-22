import type {
  ConversationDomain,
  ConversationIntent,
  ConversationState,
  FactTopic,
} from "@/lib/domain/conversation";
import type {
  InstitutionNeed,
  StudentConstraints,
  TeacherConstraints,
} from "@/lib/domain/rules";
import { CAMPS, TEACHER_PRODUCTS } from "@/lib/knowledge";
import { parseStrictJsonObject } from "./json";
import { withOneModelRetry } from "./retry";
import type { LlmClient } from "./types";

const DOMAINS: Exclude<ConversationDomain, "unknown">[] = [
  "student",
  "teacher",
  "platform",
];
const INTENTS: ConversationIntent[] = [
  "recommendation",
  "fact_question",
  "institution_service",
  "reset",
  "menu",
  "unrelated",
  "unknown",
];
const FACT_TOPICS: FactTopic[] = [
  "schedule",
  "registration",
  "price",
  "location",
  "required_items",
  "fee_includes",
  "refund",
  "replay",
  "availability",
  "curriculum",
  "prerequisite",
];
const INSTITUTION_NEEDS: InstitutionNeed[] = [
  "membership",
  "enterprise_training",
  "school_procurement",
  "basic_agent",
  "ai_web",
  "rag",
];

export type ClassifierCandidate = {
  domainCandidate?: Exclude<ConversationDomain, "unknown">;
  intent: ConversationIntent;
  studentConstraints: Partial<StudentConstraints>;
  teacherConstraints: Partial<TeacherConstraints>;
  studentReference: { period?: 1 | 2 | 3; campus?: "bj" | "sh" | "online" };
  teacherReference: { level?: "L1" | "L2" | "L3"; format?: "intensive" | "weekend" };
  institutionNeed?: InstitutionNeed;
  factTopics: FactTopic[];
  evidence: Record<string, string>;
};

export type AppliedClassifierCandidate = {
  state: ConversationState;
  intent: ConversationIntent;
  factTopics: FactTopic[];
  crossDomainFrom?: Exclude<ConversationDomain, "unknown">;
  acceptedConstraintKeys: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseEvidence(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) =>
      typeof item === "string" && item.trim()
        ? [[key, item.trim()]]
        : [],
    ),
  );
}

function readEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return (typeof value === "string" || typeof value === "number") &&
    allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readShortString(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
}

function readPeriods(value: unknown): Array<1 | 2 | 3> | undefined {
  if (!Array.isArray(value)) return undefined;
  const periods = [...new Set(value.filter((item) => item === 1 || item === 2 || item === 3))];
  return periods.length ? periods : undefined;
}

function readTeacherProductIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const known = new Set(TEACHER_PRODUCTS.map(({ id }) => id));
  const ids = [...new Set(value.filter(
    (item): item is string => typeof item === "string" && known.has(item),
  ))];
  return ids.length ? ids : undefined;
}

export function parseClassifierCandidate(content: string): ClassifierCandidate {
  const parsed = parseStrictJsonObject(content);
  const student = asRecord(parsed.studentConstraints);
  const teacher = asRecord(parsed.teacherConstraints);
  const studentReference = asRecord(parsed.studentReference);
  const teacherReference = asRecord(parsed.teacherReference);
  const factTopics = Array.isArray(parsed.factTopics)
    ? [...new Set(parsed.factTopics.filter(
        (topic): topic is FactTopic =>
          typeof topic === "string" && FACT_TOPICS.includes(topic as FactTopic),
      ))]
    : [];

  return {
    domainCandidate: readEnum(parsed.domainCandidate, DOMAINS),
    intent: readEnum(parsed.intent, INTENTS) ?? "unknown",
    studentConstraints: {
      region: readEnum(student.region, ["beijing", "shanghai", "guangzhou", "other"]),
      preferredOfflineCampus: readEnum(student.preferredOfflineCampus, ["beijing", "shanghai"]),
      availablePeriods: readPeriods(student.availablePeriods),
      excludedPeriods: readPeriods(student.excludedPeriods),
      modePreference: readEnum(student.modePreference, ["offline", "online", "either"]),
      canTravel: readBoolean(student.canTravel),
      needsReplay: readBoolean(student.needsReplay),
      learningGoal: readShortString(student.learningGoal, 80),
      refusesMoreQuestions: readBoolean(student.refusesMoreQuestions),
    },
    teacherConstraints: {
      level: readEnum(teacher.level, ["L1", "L2", "L3"]),
      goal: readEnum(teacher.goal, ["tools", "web-app", "rag-project"]),
      startingLevel: readEnum(teacher.startingLevel, ["beginner", "L1", "L2"]),
      canTakeContinuousLeave: readBoolean(teacher.canTakeContinuousLeave),
      availableProductIds: readTeacherProductIds(teacher.availableProductIds),
      city: readShortString(teacher.city, 20),
      prerequisiteStatus: readEnum(teacher.prerequisiteStatus, ["met", "not_met", "unknown"]),
      refusesMoreQuestions: readBoolean(teacher.refusesMoreQuestions),
    },
    studentReference: {
      period: readEnum(studentReference.period, [1, 2, 3] as const),
      campus: readEnum(studentReference.campus, ["bj", "sh", "online"]),
    },
    teacherReference: {
      level: readEnum(teacherReference.level, ["L1", "L2", "L3"]),
      format: readEnum(teacherReference.format, ["intensive", "weekend"]),
    },
    institutionNeed: readEnum(parsed.institutionNeed, INSTITUTION_NEEDS),
    factTopics,
    evidence: parseEvidence(parsed.evidence),
  };
}

function normalizedContains(input: string, evidence: string | undefined): boolean {
  if (!evidence) return false;
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/gu, "");
  return normalize(input).includes(normalize(evidence));
}

function acceptFields<T extends object>(input: {
  message: string;
  prefix: "student" | "teacher";
  candidate: Partial<T>;
  existing: T;
  evidence: Record<string, string>;
}): { value: T; keys: string[] } {
  const value = { ...input.existing };
  const keys: string[] = [];
  for (const [key, item] of Object.entries(input.candidate)) {
    if (item === undefined) continue;
    const evidenceKey = `${input.prefix}.${key}`;
    if (!normalizedContains(input.message, input.evidence[evidenceKey])) continue;
    Object.assign(value, { [key]: item });
    keys.push(key);
  }
  return { value, keys };
}

export function applyClassifierCandidate(input: {
  message: string;
  state: ConversationState;
  candidate: ClassifierCandidate;
}): AppliedClassifierCandidate {
  const next: ConversationState = structuredClone(input.state);
  const acceptedConstraintKeys: string[] = [];
  let crossDomainFrom: Exclude<ConversationDomain, "unknown"> | undefined;

  if (
    input.candidate.domainCandidate &&
    normalizedContains(input.message, input.candidate.evidence.domain)
  ) {
    if (
      next.domain !== "unknown" &&
      next.domain !== input.candidate.domainCandidate
    ) {
      crossDomainFrom = next.domain;
    }
    next.domain = input.candidate.domainCandidate;
  }

  if (next.domain === "student") {
    const student = acceptFields<StudentConstraints>({
      message: input.message,
      prefix: "student",
      candidate: input.candidate.studentConstraints,
      existing: next.studentConstraints,
      evidence: input.candidate.evidence,
    });
    next.studentConstraints = student.value;
    acceptedConstraintKeys.push(...student.keys);
  }

  if (next.domain === "teacher") {
    const teacherCandidate = { ...input.candidate.teacherConstraints };
    const startingEvidence = input.candidate.evidence["teacher.startingLevel"];
    const goalEvidence = input.candidate.evidence["teacher.goal"];
    if (
      teacherCandidate.startingLevel === "beginner" &&
      teacherCandidate.goal &&
      (!goalEvidence || goalEvidence === startingEvidence)
    ) {
      delete teacherCandidate.goal;
    }
    if (teacherCandidate.availableProductIds) {
      const dateEvidence = input.candidate.evidence["teacher.availableProductIds"];
      teacherCandidate.availableProductIds = dateEvidence
        ? teacherCandidate.availableProductIds.filter((id) => {
            const product = TEACHER_PRODUCTS.find((item) => item.id === id);
            const haystack = [product?.startDate, ...(product?.schedule ?? [])].join(" ");
            return Boolean(product) &&
              normalizedContains(input.message, dateEvidence) &&
              normalizedContains(haystack, dateEvidence);
          })
        : undefined;
      if (!teacherCandidate.availableProductIds?.length) {
        delete teacherCandidate.availableProductIds;
      }
    }
    const teacher = acceptFields<TeacherConstraints>({
      message: input.message,
      prefix: "teacher",
      candidate: teacherCandidate,
      existing: next.teacherConstraints,
      evidence: input.candidate.evidence,
    });
    next.teacherConstraints = teacher.value;
    acceptedConstraintKeys.push(...teacher.keys);
  }

  if (
    input.candidate.institutionNeed &&
    normalizedContains(input.message, input.candidate.evidence.institutionNeed)
  ) {
    next.institutionNeed = input.candidate.institutionNeed;
    if (next.domain === "platform") acceptedConstraintKeys.push("institutionNeed");
  }

  const factTopics = input.candidate.factTopics.filter((topic) =>
    normalizedContains(input.message, input.candidate.evidence[`topic.${topic}`]),
  );

  if (next.domain === "student") {
    const period = normalizedContains(
      input.message,
      input.candidate.evidence["studentReference.period"],
    )
      ? input.candidate.studentReference.period
      : undefined;
    const campus = normalizedContains(
      input.message,
      input.candidate.evidence["studentReference.campus"],
    )
      ? input.candidate.studentReference.campus
      : undefined;
    if (period || campus) {
      const ids = CAMPS.filter(
        (item) =>
          (period === undefined || item.period === period) &&
          (campus === undefined || item.campus === campus),
      ).map(({ id }) => id);
      next.lastRecommendationIds = ids;
      next.selectedEntityId = ids.length === 1 ? ids[0] : undefined;
    }
  }
  if (next.domain === "teacher") {
    const level = normalizedContains(
      input.message,
      input.candidate.evidence["teacherReference.level"],
    )
      ? input.candidate.teacherReference.level
      : undefined;
    const format = normalizedContains(
      input.message,
      input.candidate.evidence["teacherReference.format"],
    )
      ? input.candidate.teacherReference.format
      : undefined;
    if (level || format) {
      const ids = TEACHER_PRODUCTS.filter(
        (item) =>
          (level === undefined || item.level === level) &&
          (format === undefined || item.format === format),
      ).map(({ id }) => id);
      next.lastRecommendationIds = ids;
      next.selectedEntityId = ids.length === 1 ? ids[0] : undefined;
    }
  }

  return {
    state: next,
    intent:
      input.candidate.intent === "unknown" ||
      normalizedContains(input.message, input.candidate.evidence.intent)
        ? input.candidate.intent
        : "unknown",
    factTopics,
    crossDomainFrom,
    acceptedConstraintKeys: [...new Set(acceptedConstraintKeys)],
  };
}

const CLASSIFIER_SYSTEM_PROMPT = `你是AI课程顾问的结构化分类器。只输出JSON对象，不要Markdown或解释。
提取当前消息中有直接文字证据的身份、意图和约束候选；每个非空候选都必须在evidence中给出用户原话的最短连续片段。
身份domainCandidate只能是student、teacher、platform或null。
intent只能是recommendation、fact_question、institution_service、reset、menu、unrelated、unknown。
studentConstraints允许region(beijing/shanghai/guangzhou/other)、preferredOfflineCampus(beijing/shanghai)、availablePeriods/excludedPeriods(1/2/3数组)、modePreference(offline/online/either)、canTravel、needsReplay、learningGoal、refusesMoreQuestions。
teacherConstraints允许level(L1/L2/L3)、goal(tools/web-app/rag-project)、startingLevel(beginner/L1/L2)、canTakeContinuousLeave、availableProductIds、city、prerequisiteStatus(met/not_met/unknown)、refusesMoreQuestions。
“零基础”只提取startingLevel=beginner，除非用户另有明确目标原话，否则不得生成goal。
institutionNeed只能是membership、enterprise_training、school_procurement、basic_agent、ai_web、rag或null。
studentReference用于事实查询，可包含period(1/2/3)和campus(bj/sh/online)；teacherReference可包含level(L1/L2/L3)和format(intensive/weekend)。引用字段也必须提供用户原话证据，不能把班型引用当成用户时间约束。
factTopics可选schedule、registration、price、location、required_items、fee_includes、refund、replay、availability、curriculum、prerequisite。
evidence键使用intent、domain、institutionNeed、student.<字段>、teacher.<字段>、studentReference.<字段>、teacherReference.<字段>、topic.<主题>。`;

export function createClassifier(client: LlmClient): {
  classify(message: string, state: ConversationState): Promise<ClassifierCandidate>;
} {
  return {
    classify(message, state) {
      return withOneModelRetry(async () => {
        const result = await client.complete({
          temperature: 0,
          responseFormat: "json_object",
          messages: [
            { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                currentDomain: state.domain,
                selectedEntityId: state.selectedEntityId ?? null,
                pendingQuestionKeys: state.pendingQuestionKeys,
                pendingQuestionOptions: state.pendingQuestionOptions,
                message,
              }),
            },
          ],
        });
        return parseClassifierCandidate(result.content);
      });
    },
  };
}
