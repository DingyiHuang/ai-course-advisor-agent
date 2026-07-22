import type { Camp, CampDay, FieldSources } from "@/lib/domain/knowledge";

const DAILY_OUTLINE: CampDay[] = [
  {
    day: 1,
    theme: "AI认知与工具体验",
    content: ["生成式AI", "模型边界", "文本/图像/视频工具体验"],
    output: "个人AI工具使用清单",
  },
  {
    day: 2,
    theme: "提示词工程",
    content: ["任务", "背景", "约束", "输出格式", "多轮修改"],
    output: "3个可复用提示词模板",
  },
  {
    day: 3,
    theme: "AI绘画",
    content: ["画面主体", "风格", "构图", "色彩与一致性"],
    output: "主题海报或绘本角色",
  },
  {
    day: 4,
    theme: "AI视频",
    content: ["分镜", "图生视频", "配音", "字幕和剪辑"],
    output: "30—60秒短视频",
  },
  {
    day: 5,
    theme: "智能体搭建",
    content: ["Agent", "知识库", "工作流", "测试与边界"],
    output: "个人学习助手Bot",
  },
  {
    day: 6,
    theme: "项目冲刺",
    content: ["小组方案", "内容生产", "整合与测试"],
    output: "可演示项目初版",
  },
  {
    day: 7,
    theme: "路演与结营",
    content: ["作品优化", "5分钟路演", "反馈与复盘"],
    output: "项目终版与结营证书",
  },
];

const REQUIRED_ITEMS = [
  "笔记本电脑（必须）",
  "充电器",
  "按开营通知注册的模拟/免费工具账号",
  "线下学员：身份证明复印件、洗漱用品、换洗衣物、水杯和雨具",
];

const EQUIPMENT_REQUIREMENTS = [
  "Windows 10及以上或macOS 12及以上",
  "8GB内存",
  "可正常运行Chrome/Edge和腾讯会议",
  "线上班建议网络带宽不低于20Mbps",
];

const REFUND_RULES = [
  { condition: "开营前15日及以上取消", refundRate: 0.9 },
  { condition: "开营前7—14日取消", refundRate: 0.5 },
  { condition: "开营前7日内及开营后取消", refundRate: 0 },
];

const PERIODS = [
  {
    period: 1 as const,
    startDate: "2026-08-01",
    endDate: "2026-08-07",
    registrationDeadline: "2026-07-25",
    earlyBirdDeadline: "2026-07-11",
  },
  {
    period: 2 as const,
    startDate: "2026-08-10",
    endDate: "2026-08-16",
    registrationDeadline: "2026-08-03",
    earlyBirdDeadline: "2026-07-20",
  },
  {
    period: 3 as const,
    startDate: "2026-08-20",
    endDate: "2026-08-26",
    registrationDeadline: "2026-08-13",
    earlyBirdDeadline: "2026-07-30",
  },
];

const CAMPUS_OPTIONS = [
  {
    campus: "bj" as const,
    deliveryMode: "offline" as const,
    locationName: "AI教育中心北京教学基地",
    addressOrPlatform:
      "北京市海淀区中关村南大街5号，AI教育中心北京教学基地（模拟地址）",
    standardPrice: 6980,
    earlyBirdPrice: 5980,
    lodgingPrice: 2360,
    accommodationPrice: 1800,
    mealPrice: 560,
    feeIncludes: ["课程费"],
    replayDays: undefined,
    capacity: 30,
    minimumToOpen: 15,
  },
  {
    campus: "sh" as const,
    deliveryMode: "offline" as const,
    locationName: "AI教育中心上海教学基地",
    addressOrPlatform:
      "上海市浦东新区张江路1000号，AI教育中心上海教学基地（模拟地址）",
    standardPrice: 6980,
    earlyBirdPrice: 5980,
    lodgingPrice: 2360,
    accommodationPrice: 1800,
    mealPrice: 560,
    feeIncludes: ["课程费"],
    replayDays: undefined,
    capacity: 30,
    minimumToOpen: 15,
  },
  {
    campus: "online" as const,
    deliveryMode: "online" as const,
    locationName: "腾讯会议直播",
    addressOrPlatform: "腾讯会议直播（会议号缴费确认后发送）",
    standardPrice: 3980,
    earlyBirdPrice: 3280,
    lodgingPrice: undefined,
    accommodationPrice: undefined,
    mealPrice: undefined,
    feeIncludes: ["课程费", "30天回放", "在线答疑"],
    replayDays: 30,
    capacity: 50,
    minimumToOpen: 20,
  },
];

export const CAMPS: Camp[] = PERIODS.flatMap((period) =>
  CAMPUS_OPTIONS.map((campus) => ({
    id: `camp-p${period.period}-${campus.campus}`,
    ...period,
    ...campus,
    groupDiscount: 300,
    groupMinimum: 3,
    groupScope: "同一期、同一班型",
    dailyOutline: DAILY_OUTLINE,
    requiredItems: REQUIRED_ITEMS,
    equipmentRequirements: EQUIPMENT_REQUIREMENTS,
    refundRules: REFUND_RULES,
    availabilityKnown: false as const,
  })),
);

export const CAMP_FIELD_SOURCES: FieldSources<Camp> = {
  period: { document: "A", chapter: "第三章" },
  campus: { document: "A", chapter: "第三章" },
  deliveryMode: { document: "A", chapter: "第三章" },
  locationName: { document: "A", chapter: "第三章" },
  addressOrPlatform: { document: "A", chapter: "第三章" },
  startDate: { document: "A", chapter: "第三章" },
  endDate: { document: "A", chapter: "第三章" },
  registrationDeadline: { document: "A", chapter: "第三章" },
  earlyBirdDeadline: { document: "A", chapter: "第五章" },
  standardPrice: { document: "A", chapter: "第五章" },
  earlyBirdPrice: { document: "A", chapter: "第五章" },
  groupDiscount: { document: "A", chapter: "第五章" },
  groupMinimum: { document: "A", chapter: "第五章" },
  groupScope: { document: "A", chapter: "第五章" },
  lodgingPrice: { document: "A", chapter: "第五章" },
  accommodationPrice: { document: "A", chapter: "第五章" },
  mealPrice: { document: "A", chapter: "第五章" },
  feeIncludes: { document: "A", chapter: "第五章" },
  replayDays: { document: "A", chapter: "第三章" },
  dailyOutline: { document: "A", chapter: "第二章" },
  requiredItems: { document: "A", chapter: "第六章" },
  equipmentRequirements: { document: "A", chapter: "第六章" },
  refundRules: { document: "A", chapter: "第七章" },
  capacity: { document: "A", chapter: "第三章" },
  minimumToOpen: { document: "A", chapter: "第三章" },
  availabilityKnown: { document: "A", chapter: "第一章" },
};

export function getCamp(
  period: Camp["period"],
  campus: Camp["campus"],
): Camp {
  const camp = CAMPS.find(
    (candidate) =>
      candidate.period === period && candidate.campus === campus,
  );

  if (!camp) {
    throw new Error(`Camp not found: period=${period}, campus=${campus}`);
  }

  return camp;
}
