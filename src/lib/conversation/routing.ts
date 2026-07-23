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

type KnownDomain = Exclude<ConversationDomain, "unknown">;

export type DeterministicTurnRouting = {
  domain?: KnownDomain;
  institutionNeed?: InstitutionNeed;
  studentConstraints: Partial<StudentConstraints>;
  teacherConstraints: Partial<TeacherConstraints>;
  intent?: ConversationIntent;
  factTopics: FactTopic[];
};

function normalized(message: string): string {
  return message.toLocaleLowerCase().replace(/\s+/gu, "");
}

const BEIJING_DISTRICTS = /(?:东城|西城|朝阳|丰台|石景山|海淀|门头沟|房山|通州|顺义|昌平|大兴|怀柔|平谷|密云|延庆)区/u;

function studentRegion(message: string): StudentConstraints["region"] | undefined {
  const text = normalized(message);
  if (/北京/u.test(text) || BEIJING_DISTRICTS.test(text)) return "beijing";
  if (/上海/u.test(text)) return "shanghai";
  if (/广州/u.test(text)) return "guangzhou";
  if (/(?:其他城市|其他地区|外地|非北上广)/u.test(text)) return "other";
  return undefined;
}

function institutionRouting(
  message: string,
): Pick<DeterministicTurnRouting, "domain" | "institutionNeed" | "intent"> | undefined {
  const text = normalized(message);
  const schoolProcurement =
    /(?:学校|教育局).{0,12}(?:计划)?(?:统一)?采购/u.test(text) ||
    /(?:学校|教育局).{0,12}\d+人.{0,8}(?:采购|培训)/u.test(text);
  if (schoolProcurement) {
    return {
      domain: "platform",
      institutionNeed: "school_procurement",
      intent: "institution_service",
    };
  }

  if (
    /(?:企业培训|公司.{0,8}(?:组织|开展).{0,6}培训|我们公司.{0,12}培训)/u.test(text)
  ) {
    return {
      domain: "platform",
      institutionNeed: "enterprise_training",
      intent: "institution_service",
    };
  }
  if (/(?:会员权益|平台会员)/u.test(text)) {
    return {
      domain: "platform",
      institutionNeed: "membership",
      intent: "institution_service",
    };
  }
  if (/(?:知识库|rag).{0,10}(?:项目|交付|服务)/u.test(text)) {
    return {
      domain: "platform",
      institutionNeed: "rag",
      intent: "institution_service",
    };
  }
  if (/(?:aiweb|web应用).{0,10}(?:项目|交付|服务)/u.test(text)) {
    return {
      domain: "platform",
      institutionNeed: "ai_web",
      intent: "institution_service",
    };
  }
  if (/(?:agent|智能体).{0,10}(?:项目|交付|服务)/u.test(text)) {
    return {
      domain: "platform",
      institutionNeed: "basic_agent",
      intent: "institution_service",
    };
  }

  const generalInstitutionContext =
    /(?:统一采购|批量培训|学校采购|企业培训|项目交付)/u.test(text) ||
    /(?:我们学校|我们公司).{0,12}(?:组织|采购|培训)/u.test(text) ||
    /\d+人(?:采购|起)/u.test(text);
  return generalInstitutionContext
    ? { domain: "platform", intent: "institution_service" }
    : undefined;
}

function personalDomain(message: string): KnownDomain | undefined {
  const text = normalized(message);
  if (/我(?:是|是一名|作为).{0,12}(?:家长|学生)/u.test(text)) {
    return "student";
  }
  if (/我(?:是|是一名|作为).{0,12}(?:教师|老师)/u.test(text)) {
    return "teacher";
  }
  return undefined;
}

function pendingIdentity(
  message: string,
  state: ConversationState,
): KnownDomain | undefined {
  if (!state.pendingQuestionKeys.includes("identity")) return undefined;
  const text = normalized(message);
  if (/^(?:学生|家长|学生或家长)$/u.test(text)) return "student";
  if (/^(?:教师|老师)$/u.test(text)) return "teacher";
  if (/^(?:机构|学校|机构或企业人员|机构\/学校)$/u.test(text)) {
    return "platform";
  }
  return undefined;
}

function pendingInstitutionNeed(
  message: string,
  state: ConversationState,
): InstitutionNeed | undefined {
  if (!state.pendingQuestionKeys.includes("institutionNeed")) return undefined;
  const text = normalized(message);
  if (text.startsWith("会员权益")) return "membership";
  if (text.startsWith("企业培训")) return "enterprise_training";
  if (text.startsWith("学校采购")) return "school_procurement";
  return undefined;
}

function pendingStudentConstraints(
  message: string,
  state: ConversationState,
): Partial<StudentConstraints> {
  if (state.domain === "teacher" || state.domain === "platform") return {};
  const keys = state.domain === "unknown"
    ? new Set(["region", "availablePeriods", "modePreference", "canTravel", "needsReplay"])
    : new Set(state.pendingQuestionKeys);
  const text = normalized(message);
  const patch: Partial<StudentConstraints> = {};

  if (keys.has("canTravel")) {
    if (/^(?:均不便出行|都不便出行|不能出行|不方便出行)$/u.test(text)) {
      patch.canTravel = false;
    } else if (/^(?:可以)?前往北京$/u.test(text)) {
      patch.canTravel = true;
      patch.preferredOfflineCampus = "beijing";
    } else if (/^(?:可以)?前往上海$/u.test(text)) {
      patch.canTravel = true;
      patch.preferredOfflineCampus = "shanghai";
    }
  }
  if (keys.has("region")) {
    patch.region = studentRegion(text);
  }
  if (keys.has("availablePeriods")) {
    const periods = [
      /第一期/u.test(text) ? 1 : undefined,
      /第二期/u.test(text) ? 2 : undefined,
      /第三期/u.test(text) ? 3 : undefined,
    ].filter((value): value is 1 | 2 | 3 => value !== undefined);
    if (periods.length) patch.availablePeriods = periods;
  }
  if (keys.has("modePreference")) {
    if (/(?:线上线下|线下线上).{0,4}(?:均可|都可|都行|不限)|(?:均可|都可以|无所谓)/u.test(text)) {
      patch.modePreference = "any";
    } else if (/线下/u.test(text)) patch.modePreference = "offline";
    else if (/线上/u.test(text)) patch.modePreference = "online";
  }
  if (keys.has("needsReplay")) {
    if (/(?:需要|要).{0,3}回放/u.test(text)) patch.needsReplay = true;
    else if (/(?:不需要|不要).{0,3}回放/u.test(text)) {
      patch.needsReplay = false;
    }
  }
  return patch;
}

function pendingTeacherConstraints(
  message: string,
  state: ConversationState,
): Partial<TeacherConstraints> {
  if (state.domain !== "teacher") return {};
  const keys = new Set(state.pendingQuestionKeys);
  const text = normalized(message);
  const patch: Partial<TeacherConstraints> = {};
  if (
    keys.has("canTakeContinuousLeave") &&
    /(?:不能|不便|无法).{0,8}(?:连续|脱岗|请假)/u.test(text)
  ) {
    patch.canTakeContinuousLeave = false;
  } else if (
    keys.has("canTakeContinuousLeave") &&
    /(?:可以|能).{0,8}(?:连续|脱岗|请假|参加)/u.test(text)
  ) {
    patch.canTakeContinuousLeave = true;
  }
  return patch;
}

function currentEntityFactTopics(
  message: string,
  state: ConversationState,
): FactTopic[] {
  if (!state.selectedEntityId && state.lastRecommendationIds.length === 0) {
    return [];
  }
  const text = normalized(message);
  const topics: FactTopic[] = [];
  if (/(?:什么时候|时间安排|哪天|日期)/u.test(text)) topics.push("schedule");
  if (/(?:需要带什么|带什么|准备什么|携带)/u.test(text)) {
    topics.push("required_items");
  }
  if (/(?:在哪里|在哪儿|哪里上课|上课地点|地点)/u.test(text)) {
    topics.push("location");
  }
  if (/(?:多少钱|费用|价格)/u.test(text)) topics.push("price");
  if (/(?:怎么报名|如何报名|报名方式|报名)/u.test(text)) {
    topics.push("registration");
  }
  return [...new Set(topics)];
}

export function resolveDeterministicTurnRouting(input: {
  message: string;
  state: ConversationState;
}): DeterministicTurnRouting {
  const institution = institutionRouting(input.message);
  if (institution) {
    return {
      ...institution,
      studentConstraints: {},
      teacherConstraints: {},
      factTopics: [],
    };
  }

  const explicitPersonal = personalDomain(input.message);
  if (explicitPersonal) {
    return {
      domain: explicitPersonal,
      intent: "recommendation",
      studentConstraints: {},
      teacherConstraints: {},
      factTopics: [],
    };
  }

  const identity = pendingIdentity(input.message, input.state);
  if (identity) {
    return {
      domain: identity,
      intent: identity === "platform" ? "institution_service" : "recommendation",
      studentConstraints: {},
      teacherConstraints: {},
      factTopics: [],
    };
  }

  const institutionNeed = pendingInstitutionNeed(input.message, input.state);
  if (institutionNeed) {
    return {
      domain: "platform",
      institutionNeed,
      intent: "institution_service",
      studentConstraints: {},
      teacherConstraints: {},
      factTopics: [],
    };
  }

  const studentConstraints = pendingStudentConstraints(
    input.message,
    input.state,
  );
  const teacherConstraints = pendingTeacherConstraints(
    input.message,
    input.state,
  );
  const factTopics = currentEntityFactTopics(input.message, input.state);
  const acceptedPending =
    Object.keys(studentConstraints).length > 0 ||
    Object.keys(teacherConstraints).length > 0;
  return {
    studentConstraints,
    teacherConstraints,
    factTopics,
    intent: factTopics.length
      ? "fact_question"
      : acceptedPending
        ? "recommendation"
        : undefined,
  };
}
