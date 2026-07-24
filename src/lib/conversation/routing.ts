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
  referencedEntityIds?: string[];
  boundaryCode?: "unsupported_external_claims";
  catalogRequested?: boolean;
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
    /(?:学校|教育局).{0,12}\d+(?:人|名(?:教师)?).{0,8}(?:采购|培训)/u.test(text);
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
  if (/(?:会员权益|平台会员|专业会员|大师会员)/u.test(text)) {
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
  if (/^(?:学生|家长|学生或家长)(?:$|[，,：:])/u.test(text)) {
    return "student";
  }
  if (/^(?:教师(?:$|[，,：:])|老师$)/u.test(text)) return "teacher";
  if (/^(?:机构|学校|机构或企业人员|机构\/学校)$/u.test(text)) {
    return "platform";
  }
  if (/我(?:是|是一名|作为).{0,12}(?:家长|学生)/u.test(text)) {
    return "student";
  }
  if (/我(?:是|是一名|作为).{0,12}(?:教师|老师)/u.test(text)) {
    return "teacher";
  }
  if (/(?:零基础|中小学|初高中).{0,6}(?:教师|老师)/u.test(text)) {
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
    /(?:足球|篮球|网球|乒乓球|羽毛球|世界杯|奥运会|中超|英超|nba).{0,12}(?:比赛|赛程|比分|冠军|结果|直播)/iu.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /(?:时政|政治|选举|总统|总理|外交|国际局势).{0,12}(?:新闻|消息|评论|分析|怎么样)/u.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(?:你好|您好|在吗|谢谢|讲个笑话|说个笑话|写一首诗|请写一首诗)[。！？!?]*$/u.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /(?:苹果|手机|房价|菜价|汽油).{0,8}(?:多少钱|价格|报价)/u.test(text)
  ) {
    return true;
  }
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
  if (
    /(?:编写|开发|部署|上线).{0,10}(?:其他)?(?:软件|网站|应用|app|系统|代码)/iu.test(
      text,
    ) &&
    !/(?:课程|培训|学习|报名)/u.test(text)
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
  const longInfrastructureSignals = [
    /(?:港航|港区|吞吐量|渔港)/u.test(text),
    /(?:公路|高速|干线|通道)/u.test(text),
    /(?:城市道路|次干路|路网)/u.test(text),
    /(?:公交|客流|发车间隔)/u.test(text),
    /(?:枢纽|货运场站|场站)/u.test(text),
    /(?:轨道|地铁|\d+号线|车站)/u.test(text),
    /(?:重点工程|项目库|代表性项目)/u.test(text),
  ].filter(Boolean).length;
  const businessSignals =
    /(?:课程|班型|线上班|线下班|周末班|学习|培训|费用|学费|报名|学校采购|教师|老师|学生|家长)/u.test(
      text,
    );
  const currentBusinessReference =
    /(?:这个|该|当前|刚才|之前推荐的).{0,6}(?:课程|班型|培训|采购|方案|服务)/u.test(
      text,
    );
  const longInfrastructureBrief =
    text.length >= 120 &&
    longInfrastructureSignals >= 3 &&
    /(?:问题.{0,4}页|行动页|分类表|补齐|原文关键论据|投资口径|一句话小结|项目库|项目名)/u.test(
      text,
    ) &&
    !businessSignals &&
    !currentBusinessReference;
  return (
    longInfrastructureBrief ||
    (infrastructureSignals >= 2 &&
      !courseSignals &&
      /(?:分析|报告|建设|数据|规划|统计|增长)/u.test(text))
  );
}

function generalCourseIntent(message: string): boolean {
  const text = normalized(message);
  return (
    /(?:有什么课程推荐|有什么课程|有哪些班|有什么适合我的|我该选哪个|推荐一个课程|我想学习ai|怎么报名学习|有什么可以学的)/iu.test(
      text,
    ) ||
    /(?:课程|班型).{0,6}(?:推荐|适合|选择|有哪些|有什么)/u.test(text)
  );
}

function unsupportedExternalClaims(message: string): boolean {
  const text = normalized(message);
  return (
    /(?:合作|服务过).{0,8}(?:名校|学校|客户|案例)/u.test(text) ||
    /(?:保证|承诺).{0,8}(?:收入|收益|回报|接单)/u.test(text)
  );
}

function refusesFurtherQuestions(message: string): boolean {
  return /(?:不想|不要|拒绝).{0,8}(?:再|继续)?(?:回答|补充)|不再补充/u.test(
    normalized(message),
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
    !state.studentConstraints.region ||
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
  } else if (
    /(?:不便|不能|无法|不方便)(?:跨城)?(?:出行|前往外地)/u.test(text)
  ) {
    patch.canTravel = false;
  } else if (/^(?:可以)?前往北京$/u.test(text)) {
    patch.canTravel = true;
    patch.preferredOfflineCampus = "beijing";
  } else if (/^(?:可以)?前往上海$/u.test(text)) {
    patch.canTravel = true;
    patch.preferredOfflineCampus = "shanghai";
  } else if (/(?:可以|能|方便)(?:跨城)?(?:出行|前往外地)/u.test(text)) {
    patch.canTravel = true;
  }

  const region = residenceRegion(message, state);
  if (region) Object.assign(patch, region);

  const periods = [
    /第\s*[一1]\s*期|营期\s*[一1]/u.test(message) ? 1 : undefined,
    /第\s*[二2]\s*期|营期\s*[二2]/u.test(message) ? 2 : undefined,
    /第\s*[三3]\s*期|营期\s*[三3]/u.test(message) ? 3 : undefined,
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
  if (/(?:学生|夏令营).{0,4}线下班|本地.{0,8}学生线下班/u.test(text)) {
    patch.modePreference = "offline";
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
  const groupMatch = text.match(/(?:^|[，,。；;])?(?:共|一共)?([三3])人.{0,8}(?:团报|同报|一起报|一起报名)/u) ??
    text.match(/(?:团报|同报|一起报|一起报名).{0,8}([三3])人/u);
  if (groupMatch) {
    patch.groupSize = 3;
    if (
      /同一期.{0,4}同一班型|同一营期.{0,4}同一班型/u.test(text) ||
      /第\s*[一二三123]\s*期.{0,8}(?:北京|上海|线上).{0,4}(?:线下班|直播班|班)/u.test(
        text,
      )
    ) {
      patch.groupSamePeriodAndCamp = true;
    }
  }
  if (/(?:自愿)?(?:加|选择|包含|含).{0,3}食宿|食宿套餐/u.test(text)) {
    patch.includeLodging = true;
  }
  return patch;
}

function explicitTeacherConstraints(
  message: string,
  state: ConversationState,
  effectiveDomain: KnownDomain | undefined,
): Partial<TeacherConstraints> {
  if (effectiveDomain !== "teacher") return {};
  const keys = new Set(state.pendingQuestionKeys);
  const text = normalized(message);
  const patch: Partial<TeacherConstraints> = {};
  if (/(?:完成过|已经完成|已完成|学完)l2/iu.test(text)) {
    patch.startingLevel = "L2";
    patch.prerequisiteStatus = "met";
  } else if (/(?:完成过|已经完成|已完成|学完)l1/iu.test(text)) {
    patch.startingLevel = "L1";
    patch.prerequisiteStatus = "met";
  } else if (/(?:零基础|没学过|刚入门|学过一点)/u.test(text)) {
    patch.startingLevel = "beginner";
  }
  if (/(?:已|已经)?具备l1同等能力|通过l1同等能力测评/iu.test(text)) {
    patch.startingLevel = "L1";
    patch.prerequisiteStatus = "met";
  }
  if (
    /(?:没有|未|没).{0,4}(?:完成|学过)l1/iu.test(text) &&
    /(?:没|未|没有).{0,4}(?:通过|具备).{0,4}同等能力/u.test(text)
  ) {
    patch.prerequisiteStatus = "not_met";
  }
  if (/(?:报名|参加|学习|目标|想上|想报)l2/iu.test(text)) {
    patch.level = "L2";
  } else if (/(?:报名|参加|学习|目标|想上|想报)l3/iu.test(text)) {
    patch.level = "L3";
  }
  if (/web应用|aiweb/iu.test(text)) {
    patch.goal = "web-app";
  } else if (/知识库|rag/iu.test(text)) {
    patch.goal = "rag-project";
  }
  if (
    /8月3日?(?:至|到|—|-)?5日|8月3日至5日/u.test(text)
  ) {
    patch.availableProductIds = ["teacher-l2-intensive"];
  } else if (
    /(?:日期(?:没有要求|没要求|不限|都行)|时间都可以|哪一期都行|看安排)/u.test(
      text,
    )
  ) {
    patch.availableProductIds = TEACHER_PRODUCTS.map(({ id }) => id);
  }
  if (
    /(?:工作日)?(?:不能|不便|无法).{0,8}(?:连续|脱岗|请假|参加)|只能周末|平时没有时间|只能分段上课/u.test(
      text,
    )
  ) {
    patch.canTakeContinuousLeave = false;
  } else if (
    /(?:可以|能|可).{0,12}(?:连续参加|连续脱岗|连续安排|脱岗|请假)|连续几天没问题|都可以参加|可以连续参加|时间可以连续安排/u.test(
      text,
    ) ||
    (keys.has("canTakeContinuousLeave") &&
      /(?:可以|能).{0,8}(?:连续|脱岗|请假|参加)/u.test(text))
  ) {
    patch.canTakeContinuousLeave = true;
  }
  if (
    /(?:北京.{0,4}上海.{0,4}广州|北京、上海、广州).{0,10}(?:均|都)?(?:不便|不能|无法|不方便)(?:前往|去)?|(?:均|都)(?:不便|不能|无法|不方便).{0,8}(?:前往|去)(?:北京|上海|广州)/u.test(
      text,
    ) ||
    (keys.has("canTravelToCourseCity") &&
      /(?:均|都)?(?:不便|不能|无法|不方便)(?:前往|去)?$/u.test(text))
  ) {
    patch.canTravelToCourseCity = false;
  } else if (
    /(?:可以|能|方便).{0,8}(?:前往|去)(?:北京|上海|广州)/u.test(text) ||
    (keys.has("canTravelToCourseCity") &&
      /^(?:可以|能|方便|可以前往|能前往)$/u.test(text))
  ) {
    patch.canTravelToCourseCity = true;
  }
  const city = extractExplicitStudentRegion(message);
  if (city) {
    const cityName =
      city.regionDisplayName ??
      {
        beijing: "北京",
        shanghai: "上海",
        guangzhou: "广州",
        other: undefined,
      }[city.region];
    if (cityName) patch.city = cityName;
  }
  return patch;
}

function factTopicsFromText(message: string): FactTopic[] {
  const text = normalized(message);
  const topics: FactTopic[] = [];
  if (/(?:什么时候|时间安排|哪几天|哪天|日期|怎么安排)/u.test(text)) {
    topics.push("schedule");
  }
  if (/(?:需要带什么|带什么|准备什么|携带|电脑|设备)/u.test(text)) {
    topics.push("required_items");
  }
  if (/(?:在哪里|在哪儿|哪里上课|上课地点|地点)/u.test(text)) {
    topics.push("location");
  }
  if (/(?:多少钱|费用|价格|总价|早鸟|团报)/u.test(text)) {
    topics.push("price");
  }
  if (/(?:怎么报名|如何报名|报名方式|报名|报名截止)/u.test(text)) {
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
  if (/(?:退款|退费|取消报名)/u.test(text)) topics.push("refund");
  if (/(?:余位|名额|开班人数|30人班)/u.test(text)) {
    topics.push("availability");
  }
  if (/(?:课程内容|课程大纲|第\s*[一二三四五六七1234567]\s*天|学什么|培训内容)/u.test(text)) {
    topics.push("curriculum");
  }
  if (/(?:前置条件|需要什么基础|先修)/u.test(text)) {
    topics.push("prerequisite");
  }
  if (/(?:费用包含|费用包括|含食宿|加食宿|食宿套餐)/u.test(text)) {
    topics.push("fee_includes");
  }
  if (/(?:直接下单|能下单|可以下单|锁定名额)/u.test(text)) {
    topics.push("registration");
  }
  return [...new Set(topics)];
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
    /^(?:多少钱|费用(?:多少|是多少|呢)?|价格(?:多少|是多少|呢)?|总价(?:多少|是多少|呢)?|什么时候(?:报名|上课)?|哪天(?:报名|上课)?|在哪里(?:上课)?|在哪儿(?:上课)?|哪里上课|需要带(?:什么|电脑|笔记本电脑|设备)(?:吗)?|准备什么|怎么报名|如何报名|有回放吗|可以回放吗|能回放吗|可以退款吗|能退款吗|还有名额吗|有名额吗|课程内容是什么|学什么|需要什么基础|有什么前置条件|如果.{0,16}(?:加|含|选择)食宿.{0,12}(?:总价(?:多少|是多少)?|多少钱))[?？]?$/u.test(
      text,
    );
  if (!hasCurrentReference && !isEllipticalCurrentQuestion) {
    return [];
  }
  return factTopicsFromText(message);
}

function explicitFactReference(message: string): {
  domain: "student" | "teacher";
  entityIds: string[];
  factTopics: FactTopic[];
} | undefined {
  const text = normalized(message);
  const factTopics = factTopicsFromText(message);
  const hasQuestionShape =
    /[?？]|(?:怎么|如何|什么时候|哪几天|哪天|哪里|在哪|多少|是否|是不是|能否|可以吗|需要带|学什么|还有|取消报名|请告诉我|想了解|查询)/u.test(
      text,
    );
  if (
    !factTopics.length ||
    !hasQuestionShape ||
    /(?:直接报名|想报|怎么缴费|如何缴费)/u.test(text)
  ) {
    return undefined;
  }

  const studentSignal =
    /(?:夏令营|学生班|学生第一营|线上直播班|北京线下班|上海线下班|30人班|第\s*[一二三123]\s*期)/u.test(
      text,
    );
  if (studentSignal) {
    const period =
      /第\s*[一1]\s*期|第一营/u.test(text)
        ? 1
        : /第\s*[二2]\s*期|第二营/u.test(text)
          ? 2
          : /第\s*[三3]\s*期|第三营/u.test(text)
            ? 3
            : undefined;
    const campus =
      /北京.{0,4}线下|北京线下班/u.test(text)
        ? "bj"
        : /上海.{0,4}线下|上海线下班/u.test(text)
          ? "sh"
          : /线上直播|线上班/u.test(text)
            ? "online"
            : undefined;
    const entityIds = CAMPS.filter(
      (camp) =>
        (period === undefined || camp.period === period) &&
        (campus === undefined || camp.campus === campus) &&
        (!/30人班/u.test(text) || camp.campus !== "online"),
    ).map(({ id }) => id);
    if (entityIds.length) {
      return { domain: "student", entityIds, factTopics };
    }
  }

  const teacherSignal =
    /(?:教师培训|教师l[123]|l[123](?:暑期集训|集训|周末研修|周末班|教师培训)|暑期集训班|周末研修班)/iu.test(
      text,
    );
  if (teacherSignal) {
    const level = /l1/iu.test(text)
      ? "L1"
      : /l2/iu.test(text)
        ? "L2"
        : /l3/iu.test(text)
          ? "L3"
          : undefined;
    const format = /(?:暑期集训|集训班)/u.test(text)
      ? "intensive"
      : /(?:周末研修|周末班)/u.test(text)
        ? "weekend"
        : undefined;
    const entityIds = TEACHER_PRODUCTS.filter(
      (product) =>
        (level === undefined || product.level === level) &&
        (format === undefined || product.format === format),
    ).map(({ id }) => id);
    if (entityIds.length) {
      return { domain: "teacher", entityIds, factTopics };
    }
  }
  return undefined;
}

export function resolveDeterministicTurnRouting(input: {
  message: string;
  state: ConversationState;
}): DeterministicTurnRouting {
  if (promptInjectionOrSensitiveRequest(input.message)) {
    return {
      studentConstraints: {},
      teacherConstraints: {},
      intent: "unrelated",
      factTopics: [],
    };
  }
  if (unsupportedExternalClaims(input.message)) {
    return {
      studentConstraints: {},
      teacherConstraints: {},
      intent: "unrelated",
      factTopics: [],
      boundaryCode: "unsupported_external_claims",
    };
  }
  if (refusesFurtherQuestions(input.message)) {
    if (input.state.domain === "student") {
      return {
        studentConstraints: { refusesMoreQuestions: true },
        teacherConstraints: {},
        intent: "new_consultation",
        factTopics: [],
      };
    }
    if (input.state.domain === "teacher") {
      return {
        studentConstraints: {},
        teacherConstraints: { refusesMoreQuestions: true },
        intent: "new_consultation",
        factTopics: [],
      };
    }
  }
  if (explicitUnrelatedIntent(input.message)) {
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

  const factReference = explicitFactReference(input.message);
  const explicitPersonal = personalDomain(input.message);
  const identity = pendingIdentity(input.message, input.state);
  const institutionNeed = pendingInstitutionNeed(input.message, input.state);
  const catalogRequested = generalCourseIntent(input.message);
  const domain =
    institutionNeed
      ? "platform"
      : factReference?.domain ?? explicitPersonal ?? identity;
  const effectiveDomain =
    domain ??
    (input.state.domain === "unknown" ? undefined : input.state.domain);
  const studentConstraints = explicitStudentConstraints(
    input.message,
    input.state,
    effectiveDomain,
  );
  const teacherConstraints = explicitTeacherConstraints(
    input.message,
    input.state,
    effectiveDomain,
  );
  const factTopics =
    factReference?.factTopics ??
    currentEntityFactTopics(input.message, input.state);
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
    referencedEntityIds: factReference?.entityIds,
    catalogRequested,
    intent: institutionNeed
      ? "institution_service"
      : currentInstitutionOperation
        ? "institution_service"
      : factReference
        ? "fact_question"
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
        : catalogRequested
          ? "new_consultation"
        : undefined,
  };
}
