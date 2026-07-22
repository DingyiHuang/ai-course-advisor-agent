import type {
  FieldSources,
  TeacherFormat,
  TeacherLevel,
  TeacherProduct,
} from "@/lib/domain/knowledge";

const DEVICE_REQUIREMENTS = [
  "必须携带笔记本电脑",
  "Windows 10及以上或macOS 12及以上",
  "8GB内存",
];

const REPLAY_POLICY =
  "线上平台为腾讯会议，线上部分提供30天回放；线下实操环节不提供回放";

const LEVEL_DETAILS: Record<
  TeacherLevel,
  Pick<
    TeacherProduct,
    | "standardPrice"
    | "earlyBirdDiscount"
    | "feeIncludes"
    | "prerequisite"
    | "curriculumModules"
    | "outcome"
  >
> = {
  L1: {
    standardPrice: 2980,
    earlyBirdDiscount: 500,
    feeIncludes: ["课程", "资料", "考核"],
    prerequisite: null,
    curriculumModules: [
      "提示词",
      "AI备课",
      "课件与图像",
      "作业反馈",
      "教学伦理",
    ],
    outcome: "含教案、课件和练习的AI辅助教学资源包",
  },
  L2: {
    standardPrice: 6980,
    earlyBirdDiscount: 1000,
    feeIncludes: ["课程", "资料", "考核", "模拟云资源"],
    prerequisite: "完成L1或通过同等能力测评",
    curriculumModules: [
      "需求拆解",
      "响应式页面",
      "数据库基础",
      "LLM API",
      "错误处理与部署",
    ],
    outcome: "可运行的AI教学Web应用MVP并进行10分钟演示",
  },
  L3: {
    standardPrice: 12800,
    earlyBirdDiscount: 2000,
    feeIncludes: ["课程", "资料", "考核", "项目辅导"],
    prerequisite: "完成L2或提交同等项目作品",
    curriculumModules: [
      "RAG",
      "文档切片",
      "向量检索",
      "引用",
      "Agent Skill",
      "日志与项目交付",
    ],
    outcome: "企业/学校知识库助手原型、架构说明和测试记录",
  },
};

type ProductSeed = Pick<
  TeacherProduct,
  | "id"
  | "level"
  | "format"
  | "cities"
  | "locationsOrPlatforms"
  | "startDate"
  | "schedule"
  | "registrationDeadline"
  | "earlyBirdDeadline"
>;

const PRODUCT_SEEDS: ProductSeed[] = [
  {
    id: "teacher-l1-intensive",
    level: "L1",
    format: "intensive",
    cities: ["北京"],
    locationsOrPlatforms: [
      "北京教学基地线下",
      "北京市海淀区中关村南大街5号，AI教育中心北京教学基地（模拟地址）",
    ],
    startDate: "2026-08-01",
    schedule: ["8月1日09:00—12:00、14:00—17:00，共8课时"],
    registrationDeadline: "2026-07-25",
    earlyBirdDeadline: "2026-07-18",
  },
  {
    id: "teacher-l1-weekend",
    level: "L1",
    format: "weekend",
    cities: ["北京", "上海", "广州"],
    locationsOrPlatforms: [
      "腾讯会议",
      "北京教学基地",
      "上海工作坊",
      "广州工作坊",
    ],
    startDate: "2026-08-02",
    schedule: ["8月2日上午4课时线上、下午4课时线下工作坊"],
    registrationDeadline: "2026-07-26",
    earlyBirdDeadline: "2026-07-19",
  },
  {
    id: "teacher-l2-intensive",
    level: "L2",
    format: "intensive",
    cities: ["北京"],
    locationsOrPlatforms: [
      "北京市海淀区中关村南大街5号，AI教育中心北京教学基地（模拟地址）",
    ],
    startDate: "2026-08-03",
    schedule: ["8月3日8课时、8月4日8课时、8月5日上午4课时，共20课时"],
    registrationDeadline: "2026-07-27",
    earlyBirdDeadline: "2026-07-20",
  },
  {
    id: "teacher-l2-weekend",
    level: "L2",
    format: "weekend",
    cities: [],
    locationsOrPlatforms: ["腾讯会议", "线下工作坊"],
    startDate: "2026-08-08",
    schedule: [
      "8月8日线上8课时、8月9日线下8课时、8月15日上午线上4课时，共20课时",
    ],
    registrationDeadline: "2026-08-01",
    earlyBirdDeadline: "2026-07-25",
  },
  {
    id: "teacher-l3-intensive",
    level: "L3",
    format: "intensive",
    cities: ["北京"],
    locationsOrPlatforms: [
      "北京市海淀区中关村南大街5号，AI教育中心北京教学基地（模拟地址）",
    ],
    startDate: "2026-08-10",
    schedule: ["8月10-12日每天8课时，共24课时"],
    registrationDeadline: "2026-08-03",
    earlyBirdDeadline: "2026-07-27",
  },
  {
    id: "teacher-l3-weekend",
    level: "L3",
    format: "weekend",
    cities: [],
    locationsOrPlatforms: ["腾讯会议", "线下场地（资料未指明城市）"],
    startDate: "2026-08-16",
    schedule: ["8月16日线下、8月22日线上、8月23日线下，每天8课时，共24课时"],
    registrationDeadline: "2026-08-09",
    earlyBirdDeadline: "2026-08-02",
  },
];

export const TEACHER_PRODUCTS: TeacherProduct[] = PRODUCT_SEEDS.map((seed) => ({
  ...seed,
  ...LEVEL_DETAILS[seed.level],
  groupDiscount: 300,
  groupMinimum: 3,
  deviceRequirements: DEVICE_REQUIREMENTS,
  replayPolicy: REPLAY_POLICY,
  refundPolicyProvided: false,
  availabilityKnown: false,
}));

export const TEACHER_PRODUCT_FIELD_SOURCES: FieldSources<TeacherProduct> = {
  level: { document: "B", chapter: "第一章" },
  format: { document: "B", chapter: "第二章" },
  cities: { document: "B", chapter: "第二、四章" },
  locationsOrPlatforms: { document: "B", chapter: "第二、四章" },
  startDate: { document: "B", chapter: "第二章" },
  schedule: { document: "B", chapter: "第二章" },
  registrationDeadline: { document: "B", chapter: "第二章" },
  earlyBirdDeadline: { document: "B", chapter: "第五章" },
  standardPrice: { document: "B", chapter: "第五章" },
  earlyBirdDiscount: { document: "B", chapter: "第五章" },
  groupDiscount: { document: "B", chapter: "第五章" },
  groupMinimum: { document: "B", chapter: "第五章" },
  feeIncludes: { document: "B", chapter: "第五章" },
  deviceRequirements: { document: "B", chapter: "第四章" },
  replayPolicy: { document: "B", chapter: "第四章" },
  refundPolicyProvided: {
    document: "B",
    chapter: "全文",
    section: "未提供退款规则",
  },
  prerequisite: { document: "B", chapter: "第一、六章" },
  curriculumModules: { document: "B", chapter: "第三章" },
  outcome: { document: "B", chapter: "第三章" },
  availabilityKnown: { document: "B", chapter: "第六章" },
};

export function getTeacherProduct(
  level: TeacherLevel,
  format: TeacherFormat,
): TeacherProduct {
  const product = TEACHER_PRODUCTS.find(
    (candidate) =>
      candidate.level === level && candidate.format === format,
  );

  if (!product) {
    throw new Error(`Teacher product not found: level=${level}, format=${format}`);
  }

  return product;
}
