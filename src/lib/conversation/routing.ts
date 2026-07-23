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
import {
  extractExplicitStudentRegion,
  normalizeStudentRegionName,
  type ConfirmedStudentRegion,
} from "./studentRegion";

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
  if (/^(?:学生|家长|学生或家长)$/u.test(text)) return "student";
  if (/^(?:教师|老师)$/u.test(text)) return "teacher";
  if (/^(?:机构|学校|机构或企业人员|机构\/学校)$/u.test(text)) {
    return "platform";
  }
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

function promptInjectionOrSensitiveRequest(message: string): boolean {
  const text = normalized(message);
  return (
    /(?:忽略|无视|绕过).{0,16}(?:此前|之前|以上|原有|系统).{0,12}(?:要求|指令|规则|提示词)/u.test(
      text,
    ) ||
    /(?:输出|显示|泄露|告诉我).{0,12}(?:系统提示词|api密钥|apikey|环境变量|模型配置|内部reasoncode)/iu.test(
      text,
    )
  );
}

function explicitUnrelatedIntent(message: string): boolean {
  const text = normalized(message);
  if (/(?:今天天气|天气怎么样|天气预报)/u.test(text)) return true;
  if (
    /(?:分析|预测|判断).{0,8}(?:股票|股价|大盘|证券).{0,8}(?:走势|行情)?/u.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /(?:项目开发进度|git提交|git操作|代码提交|部署要求|部署操作|测试操作|系统开发)/iu.test(
      text,
    )
  ) {
    return true;
  }
  const infrastructureSignals = [
    /港口/u.test(text),
    /公路/u.test(text),
    /道路/u.test(text),
    /交通/u.test(text),
    /经济数据|经济指标|国内生产总值|gdp/iu.test(text),
  ].filter(Boolean).length;
  const courseSignals =
    /(?:学生课程|教师培训|学校采购|企业培训|ai课程|夏令营|班型|报名条件|平台服务)/iu.test(
      text,
    );
  return (
    infrastructureSignals >= 2 &&
    !courseSignals &&
    /(?:分析|报告|建设|数据|规划|统计|增长)/u.test(text)
  );
}

function residenceRegion(
  message: string,
  state: ConversationState,
): ConfirmedStudentRegion | undefined {
  const text = normalized(message);
  const explicit = extractExplicitStudentRegion(message);
  if (explicit) return explicit;

  const regionIsOpen =
    state.domain === "unknown" ||
    state.pendingQuestionKeys.includes("region");
  if (!regionIsOpen || /(?:前往|去往|去|到)(?:北京|上海)/u.test(text)) {
    return undefined;
  }
  const regions = [
    /北京/u.test(text) || BEIJING_DISTRICTS.test(text)
      ? normalizeStudentRegionName("北京")
      : undefined,
    /上海/u.test(text) ? normalizeStudentRegionName("上海") : undefined,
    /广州/u.test(text) ? normalizeStudentRegionName("广州") : undefined,
    /(?:其他城市|其他地区|外地|非北上广)/u.test(text)
      ? normalizeStudentRegionName("其他地区")
      : undefined,
  ].filter(
    (value): value is ConfirmedStudentRegion => value !== undefined,
  );
  return regions.length === 1 ? regions[0] : undefined;
}

function explicitStudentConstraints(
  message: string,
  state: ConversationState,
  effectiveDomain: KnownDomain | undefined,
): Partial<StudentConstraints> {
  if (
    effectiveDomain === "teacher" ||
    effectiveDomain === "platform" ||
    (effectiveDomain === undefined &&
      state.domain !== "unknown" &&
      state.domain !== "student")
  ) {
    return {};
  }
  const text = normalized(message);
  const patch: Partial<StudentConstraints> = {};

  if (
    /^(?:均|都)?(?:不便|不能|无法|不方便)(?:出行|前往|去)(?:北京和上海|北京、上海|北京上海)?$/u.test(
      text,
    ) ||
    /北京.{0,4}上海.{0,6}(?:均|都)?(?:不便|不能|无法|不方便)(?:前往|出行|去)/u.test(
      text,
    )
  ) {
    patch.canTravel = false;
  } else if (/^(?:可以)?前往北京$/u.test(text)) {
    patch.canTravel = true;
    patch.preferredOfflineCampus = "beijing";
  } else if (/^(?:可以)?前往上海$/u.test(text)) {
    patch.canTravel = true;
    patch.preferredOfflineCampus = "shanghai";
  }

  const region = residenceRegion(message, state);
  if (region) Object.assign(patch, region);

  const periods = [
    /第?\s*[一1]\s*期|营期\s*[一1]/u.test(message) ? 1 : undefined,
    /第?\s*[二2]\s*期|营期\s*[二2]/u.test(message) ? 2 : undefined,
    /第?\s*[三3]\s*期|营期\s*[三3]/u.test(message) ? 3 : undefined,
  ].filter((value): value is 1 | 2 | 3 => value !== undefined);
  if (periods.length) {
    patch.availablePeriods = periods;
  }

  const modeIsConstraint =
    state.domain === "unknown" ||
    effectiveDomain === "student" && state.domain !== "student" ||
    state.pendingQuestionKeys.includes("modePreference") ||
    /(?:偏好|只想|希望|想要|接受|倾向|改成|改为|选择).{0,4}(?:线上|线下)|(?:线上线下|线下线上).{0,4}(?:均可|都可|都行|不限)/u.test(
      text,
    );
  if (modeIsConstraint) {
    if (
      /(?:线上线下|线下线上).{0,4}(?:均可|都可|都行|不限)|(?:均可|都可以|无所谓)/u.test(
        text,
      )
    ) {
      patch.modePreference = "any";
    } else if (/线下/u.test(text)) {
      patch.modePreference = "offline";
    } else if (/线上/u.test(text)) {
      patch.modePreference = "online";
    }
  }

  if (/(?:不需要|不要|无需).{0,3}(?:录播|回放)/u.test(text)) {
    patch.needsReplay = false;
  } else if (
    /(?:需要|要|希望有).{0,3}(?:录播|回放)|(?:录播|回放).{0,3}(?:需要|要)/u.test(
      text,
    )
  ) {
    patch.needsReplay = true;
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
  const hasCurrentReference =
    /(?:这个|该|当前|刚才|之前推荐的).{0,4}(?:班|班型|课程|培训|方案|服务|项目)|学校采购|当前产品|^(?:它|其)(?:的)?(?:价格|费用|时间|地点|报名|回放|退款|名额|课程内容|前置条件)/u.test(
      text,
    );
  const isEllipticalCurrentQuestion =
    /^(?:多少钱|费用(?:多少|是多少|呢)?|价格(?:多少|是多少|呢)?|什么时候(?:报名|上课)?|哪天(?:报名|上课)?|在哪里(?:上课)?|在哪儿(?:上课)?|哪里上课|需要带(?:什么|电脑|笔记本电脑|设备)(?:吗)?|准备什么|怎么报名|如何报名|有回放吗|可以回放吗|能回放吗|可以退款吗|能退款吗|还有名额吗|有名额吗|课程内容是什么|学什么|需要什么基础|有什么前置条件)[?？]?$/u.test(
      text,
    );
  if (!hasCurrentReference && !isEllipticalCurrentQuestion) {
    return [];
  }
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
  if (
    /(?:至少|最低|起步).{0,5}(?:多少|几)(?:人|位)|(?:多少|几)人起|最低人数/u.test(
      text,
    ) ||
    /\d+\s*人起.{0,6}(?:什么|含义|意思)/u.test(text)
  ) {
    topics.push("availability");
  }
  if (
    /(?:包含哪些服务|包含什么服务|服务内容|方案内容|适合谁|适用对象)/u.test(
      text,
    )
  ) {
    topics.push("curriculum");
  }
  if (/(?:回放|录播)/u.test(text)) topics.push("replay");
  if (/(?:退款|退费)/u.test(text)) topics.push("refund");
  if (/(?:余位|名额|开班人数)/u.test(text)) topics.push("availability");
  if (/(?:课程内容|课程大纲|学什么|培训内容)/u.test(text)) {
    topics.push("curriculum");
  }
  if (/(?:前置条件|需要什么基础|先修)/u.test(text)) {
    topics.push("prerequisite");
  }
  if (/(?:费用包含|费用包括|含食宿)/u.test(text)) {
    topics.push("fee_includes");
  }
  if (/(?:直接下单|能下单|可以下单|锁定名额)/u.test(text)) {
    topics.push("registration");
  }
  return [...new Set(topics)];
}

export function resolveDeterministicTurnRouting(input: {
  message: string;
  state: ConversationState;
}): DeterministicTurnRouting {
  if (
    promptInjectionOrSensitiveRequest(input.message) ||
    explicitUnrelatedIntent(input.message)
  ) {
    return {
      studentConstraints: {},
      teacherConstraints: {},
      intent: "unrelated",
      factTopics: [],
    };
  }
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
  const identity = pendingIdentity(input.message, input.state);
  const institutionNeed = pendingInstitutionNeed(input.message, input.state);
  const domain =
    institutionNeed ? "platform" : explicitPersonal ?? identity;
  const effectiveDomain =
    domain ??
    (input.state.domain === "unknown" ? undefined : input.state.domain);
  const studentConstraints = explicitStudentConstraints(
    input.message,
    input.state,
    effectiveDomain,
  );
  const teacherConstraints = pendingTeacherConstraints(
    input.message,
    input.state,
  );
  const factTopics = currentEntityFactTopics(input.message, input.state);
  const currentInstitutionOperation =
    input.state.domain === "platform" &&
    Boolean(input.state.institutionNeed) &&
    /^(?:整理采购需求清单|查看模拟咨询流程)$/u.test(
      normalized(input.message),
    );
  const acceptedPending =
    Object.keys(studentConstraints).length > 0 ||
    Object.keys(teacherConstraints).length > 0;
  return {
    domain,
    institutionNeed,
    studentConstraints,
    teacherConstraints,
    factTopics,
    intent: institutionNeed
      ? "institution_service"
      : currentInstitutionOperation
        ? "institution_service"
      : identity
        ? "identity_selection"
        : domain
        ? domain === "platform"
          ? "institution_service"
          : "new_consultation"
        : factTopics.length
      ? "contextual_followup"
      : acceptedPending
        ? "new_consultation"
        : undefined,
  };
}
