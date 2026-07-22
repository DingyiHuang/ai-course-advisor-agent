import type {
  FieldSources,
  PlatformService,
} from "@/lib/domain/knowledge";

export const PLATFORM_SERVICES: PlatformService[] = [
  {
    id: "platform-enterprise-training",
    category: "企业AI工具培训",
    audience: "企业员工或管理团队",
    pricingRule: "50人起，500—1500元/人，按内容和天数报价",
    minimumPeople: 50,
    minimumPricePerPerson: 500,
    maximumPricePerPerson: 1500,
    boundary: "不是素材B的教师个人报名价",
  },
  {
    id: "platform-school-procurement",
    category: "学校教师培训采购",
    audience: "学校或教育局统一采购",
    pricingRule: "20人起，项目总价5万元起",
    minimumPeople: 20,
    minimumTotalPrice: 50000,
    boundary: "个人教师报名价格仍以素材B为准",
  },
  {
    id: "platform-basic-agent",
    category: "基础Agent交付",
    audience: "有标准FAQ或流程需求的企业",
    pricingRule: "1万—3万元/项目",
    minimumPrice: 10000,
    maximumPrice: 30000,
    boundary: "由平台按认证等级匹配OPC",
  },
  {
    id: "platform-ai-web",
    category: "AI Web应用",
    audience: "需要独立网页、数据库和LLM功能的企业",
    pricingRule: "3万—8万元/项目",
    minimumPrice: 30000,
    maximumPrice: 80000,
    boundary: "需求确认后另行报价",
  },
  {
    id: "platform-rag",
    category: "企业知识库/RAG",
    audience: "文档量大、需引用和管理后台的企业",
    pricingRule: "8万元起",
    minimumPrice: 80000,
    boundary: "属于A级交付范围",
  },
  {
    id: "platform-membership",
    category: "平台会员",
    audience: "使用课程、工具和社区服务的平台用户",
    grantsOrderPermission: false,
    boundary: "会员不授予订单权限，素材C未提供具体会员售价",
  },
  {
    id: "platform-contest",
    category: "大赛与测试",
    audience: "参加统一大赛的OPC个人选手",
    grantsDirectOrderPermission: false,
    boundary: "大赛只授予对应等级测试资格，测试通过后才开通订单权限",
  },
];

export const PLATFORM_SERVICE_FIELD_SOURCES: FieldSources<PlatformService> = {
  category: { document: "C", chapter: "第一、六章" },
  audience: { document: "C", chapter: "第六章" },
  pricingRule: { document: "C", chapter: "第六章" },
  minimumPeople: { document: "C", chapter: "第六章" },
  minimumPricePerPerson: { document: "C", chapter: "第六章" },
  maximumPricePerPerson: { document: "C", chapter: "第六章" },
  minimumTotalPrice: { document: "C", chapter: "第六章" },
  minimumPrice: { document: "C", chapter: "第六章" },
  maximumPrice: { document: "C", chapter: "第六章" },
  grantsOrderPermission: { document: "C", chapter: "第五章" },
  grantsDirectOrderPermission: { document: "C", chapter: "第三章" },
  boundary: { document: "C", chapter: "第五、六、七章" },
};

export function getPlatformService(id: string): PlatformService {
  const service = PLATFORM_SERVICES.find((candidate) => candidate.id === id);

  if (!service) {
    throw new Error(`Platform service not found: id=${id}`);
  }

  return service;
}
