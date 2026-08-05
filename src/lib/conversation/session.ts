import type {
  ConversationDomain,
  ConversationState,
  ShortHistoryItem,
} from "@/lib/domain/conversation";
import type {
  StudentConstraints,
  TeacherConstraints,
} from "@/lib/domain/rules";
import {
  CAMPS,
  PLATFORM_SERVICES,
  TEACHER_PRODUCTS,
} from "@/lib/knowledge";
import { normalizeStudentRegionName } from "./studentRegion";

const DOMAINS: ConversationDomain[] = [
  "unknown",
  "student",
  "teacher",
  "platform",
];

const KNOWN_ENTITY_IDS = new Set([
  ...CAMPS.map(({ id }) => id),
  ...TEACHER_PRODUCTS.map(({ id }) => id),
  ...PLATFORM_SERVICES.map(({ id }) => id),
]);

const PENDING_QUESTION_KEYS: Record<ConversationDomain, ReadonlySet<string>> = {
  unknown: new Set(["identity"]),
  student: new Set([
    "region",
    "preferredOfflineCampus",
    "availablePeriods",
    "excludedPeriods",
    "modePreference",
    "canTravel",
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

export function createInitialConversationState(): ConversationState {
  return {
    version: 1,
    domain: "unknown",
    studentConstraints: {},
    teacherConstraints: {},
    lastRecommendationIds: [],
    pendingQuestionKeys: [],
    pendingQuestionOptions: [],
    shortHistory: [],
    test: { failNextModelCall: false },
  };
}

export function transitionConversationDomain(
  state: ConversationState,
  domain: Exclude<ConversationDomain, "unknown">,
): ConversationState {
  const next = structuredClone(state);
  if (next.domain === domain) return next;

  const provisionalStudentConstraints =
    next.domain === "unknown" && domain === "student"
      ? sanitizeStudentConstraints(next.studentConstraints)
      : {};
  next.domain = domain;
  next.studentConstraints = provisionalStudentConstraints;
  next.teacherConstraints = {};
  delete next.institutionNeed;
  delete next.selectedEntityId;
  next.lastRecommendationIds = [];
  next.pendingQuestionKeys = [];
  next.pendingQuestionOptions = [];
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeHistory(value: unknown): ShortHistoryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    .flatMap((item) => {
      if (
        (item.role !== "user" && item.role !== "assistant") ||
        typeof item.content !== "string"
      ) {
        return [];
      }
      return [{
        role: item.role as ShortHistoryItem["role"],
        content: item.content.slice(0, 500),
      }];
    })
    .slice(-6);
}

function sanitizeStudentConstraints(value: unknown): StudentConstraints {
  const input = asRecord(value);
  const output: StudentConstraints = {};
  if (["beijing", "shanghai", "guangzhou", "other"].includes(String(input.region))) {
    output.region = input.region as StudentConstraints["region"];
  }
  if (output.region && typeof input.regionDisplayName === "string") {
    const normalized = normalizeStudentRegionName(input.regionDisplayName);
    if (
      normalized?.region === output.region &&
      normalized.regionDisplayName
    ) {
      output.regionDisplayName = normalized.regionDisplayName;
    }
  }
  if (["beijing", "shanghai"].includes(String(input.preferredOfflineCampus))) {
    output.preferredOfflineCampus =
      input.preferredOfflineCampus as StudentConstraints["preferredOfflineCampus"];
  }
  for (const key of ["availablePeriods", "excludedPeriods"] as const) {
    if (Array.isArray(input[key])) {
      const periods = [...new Set(input[key].filter((item) => item === 1 || item === 2 || item === 3))];
      if (periods.length) output[key] = periods;
    }
  }
  if (["offline", "online", "any"].includes(String(input.modePreference))) {
    output.modePreference = input.modePreference as StudentConstraints["modePreference"];
  }
  for (const key of [
    "canTravel",
    "needsReplay",
    "groupSamePeriodAndCamp",
    "includeLodging",
    "refusesMoreQuestions",
  ] as const) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  if (
    Number.isInteger(input.groupSize) &&
    Number(input.groupSize) >= 1 &&
    Number(input.groupSize) <= 100
  ) {
    output.groupSize = Number(input.groupSize);
  }
  if (Number.isInteger(input.stalledTurns) && Number(input.stalledTurns) >= 0) {
    output.stalledTurns = Math.min(Number(input.stalledTurns), 3);
  }
  return output;
}

function sanitizeTeacherConstraints(value: unknown): TeacherConstraints {
  const input = asRecord(value);
  const output: TeacherConstraints = {};
  if (["L1", "L2", "L3"].includes(String(input.level))) {
    output.level = input.level as TeacherConstraints["level"];
  }
  if (["tools", "web-app", "rag-project"].includes(String(input.goal))) {
    output.goal = input.goal as TeacherConstraints["goal"];
  }
  if (["beginner", "L1", "L2"].includes(String(input.startingLevel))) {
    output.startingLevel = input.startingLevel as TeacherConstraints["startingLevel"];
  }
  if (typeof input.canTakeContinuousLeave === "boolean") {
    output.canTakeContinuousLeave = input.canTakeContinuousLeave;
  }
  if (typeof input.canTravelToCourseCity === "boolean") {
    output.canTravelToCourseCity = input.canTravelToCourseCity;
  }
  if (Array.isArray(input.availableProductIds)) {
    const known = new Set(TEACHER_PRODUCTS.map(({ id }) => id));
    const ids = [...new Set(input.availableProductIds.filter(
      (item): item is string => typeof item === "string" && known.has(item),
    ))];
    if (ids.length) output.availableProductIds = ids;
  }
  if (typeof input.city === "string" && input.city.trim()) {
    output.city = input.city.trim().slice(0, 20);
  }
  if (["met", "not_met", "unknown"].includes(String(input.prerequisiteStatus))) {
    output.prerequisiteStatus =
      input.prerequisiteStatus as TeacherConstraints["prerequisiteStatus"];
  }
  if (typeof input.refusesMoreQuestions === "boolean") {
    output.refusesMoreQuestions = input.refusesMoreQuestions;
  }
  if (Number.isInteger(input.stalledTurns) && Number(input.stalledTurns) >= 0) {
    output.stalledTurns = Math.min(Number(input.stalledTurns), 3);
  }
  return output;
}

export function sanitizeConversationState(value: unknown): ConversationState {
  const input = asRecord(value);
  const state = createInitialConversationState();
  if (DOMAINS.includes(input.domain as ConversationDomain)) {
    state.domain = input.domain as ConversationDomain;
  }
  state.studentConstraints = sanitizeStudentConstraints(input.studentConstraints);
  state.teacherConstraints = sanitizeTeacherConstraints(input.teacherConstraints);
  if (
    typeof input.institutionNeed === "string" &&
    [
      "membership",
      "enterprise_training",
      "school_procurement",
      "basic_agent",
      "ai_web",
      "rag",
    ].includes(input.institutionNeed)
  ) {
    state.institutionNeed = input.institutionNeed as ConversationState["institutionNeed"];
  }
  const domainPrefix =
    state.domain === "student"
      ? "camp-"
      : state.domain === "teacher"
        ? "teacher-"
        : state.domain === "platform"
          ? "platform-"
          : undefined;
  if (
    domainPrefix &&
    typeof input.selectedEntityId === "string" &&
    input.selectedEntityId.startsWith(domainPrefix) &&
    KNOWN_ENTITY_IDS.has(input.selectedEntityId)
  ) {
    state.selectedEntityId = input.selectedEntityId;
  }
  if (Array.isArray(input.lastRecommendationIds)) {
    state.lastRecommendationIds = [...new Set(input.lastRecommendationIds.filter(
      (item): item is string =>
            typeof item === "string" &&
            (domainPrefix ? item.startsWith(domainPrefix) : false) &&
            KNOWN_ENTITY_IDS.has(item),
    ))].slice(0, 9);
  }
  if (Array.isArray(input.pendingQuestionKeys)) {
    state.pendingQuestionKeys = input.pendingQuestionKeys.filter(
      (item): item is string =>
        typeof item === "string" &&
        PENDING_QUESTION_KEYS[state.domain].has(item),
    ).slice(0, 5);
  }
  if (Array.isArray(input.pendingQuestionOptions)) {
    state.pendingQuestionOptions = input.pendingQuestionOptions.filter(
      (item): item is string => typeof item === "string" && item.length <= 80,
    ).slice(0, 8);
  }
  state.shortHistory = sanitizeHistory(input.shortHistory);
  const test = asRecord(input.test);
  state.test.failNextModelCall = test.failNextModelCall === true;
  return state;
}

export function appendHistory(
  state: ConversationState,
  item: ShortHistoryItem,
): ConversationState {
  return {
    ...state,
    shortHistory: [...state.shortHistory, { ...item, content: item.content.slice(0, 500) }].slice(-6),
  };
}

function presentConstraintKeys(value: object): string[] {
  return Object.entries(value)
    .filter(([key, item]) =>
      key !== "stalledTurns" &&
      key !== "refusesMoreQuestions" &&
      item !== undefined &&
      (!Array.isArray(item) || item.length > 0),
    )
    .map(([key]) => key);
}

export function collectedConstraintKeys(state: ConversationState): string[] {
  if (state.domain === "student") {
    return presentConstraintKeys(state.studentConstraints);
  }
  if (state.domain === "teacher") {
    return presentConstraintKeys(state.teacherConstraints);
  }
  if (state.domain === "platform" && state.institutionNeed) {
    return ["institutionNeed"];
  }
  return [];
}
