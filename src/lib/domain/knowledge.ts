export type SourceDocument = "A" | "B" | "C";

export type Source = {
  document: SourceDocument;
  chapter: string;
  section?: string;
};

export type KnowledgeChunkDomain = "student" | "teacher" | "platform";

export type KnowledgeChunkSource = {
  material: SourceDocument;
  documentTitle: string;
  chapter: string;
  section?: string;
};

export type KnowledgeChunk = {
  id: string;
  domain: KnowledgeChunkDomain;
  title: string;
  content: string;
  topics: string[];
  entityIds: string[];
  source: KnowledgeChunkSource;
  factIds: string[];
};

export type FieldSources<T> = Partial<Record<keyof T, Source>>;

export type CampDay = {
  day: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  theme: string;
  content: string[];
  output: string;
};

export type RefundRule = {
  condition: string;
  refundRate: number;
};

export type Camp = {
  id: string;
  period: 1 | 2 | 3;
  campus: "bj" | "sh" | "online";
  deliveryMode: "offline" | "online";
  locationName: string;
  addressOrPlatform: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  earlyBirdDeadline: string;
  standardPrice: number;
  earlyBirdPrice: number;
  groupDiscount: number;
  groupMinimum: number;
  groupScope: string;
  lodgingPrice?: number;
  accommodationPrice?: number;
  mealPrice?: number;
  feeIncludes: string[];
  replayDays?: number;
  dailyOutline: CampDay[];
  requiredItems: string[];
  equipmentRequirements: string[];
  refundRules: RefundRule[];
  capacity: number;
  minimumToOpen: number;
  availabilityKnown: false;
};

export type TeacherLevel = "L1" | "L2" | "L3";
export type TeacherFormat = "intensive" | "weekend";

export type TeacherProduct = {
  id: string;
  level: TeacherLevel;
  format: TeacherFormat;
  cities: string[];
  locationsOrPlatforms: string[];
  startDate: string;
  schedule: string[];
  registrationDeadline: string;
  earlyBirdDeadline: string;
  standardPrice: number;
  earlyBirdDiscount: number;
  groupDiscount: number;
  groupMinimum: number;
  feeIncludes: string[];
  deviceRequirements: string[];
  replayPolicy: string;
  refundPolicyProvided: false;
  prerequisite: string | null;
  curriculumModules: string[];
  outcome: string;
  availabilityKnown: false;
};

export type PlatformService = {
  id: string;
  category: string;
  audience: string;
  pricingRule?: string;
  minimumPeople?: number;
  minimumPricePerPerson?: number;
  maximumPricePerPerson?: number;
  minimumTotalPrice?: number;
  minimumPrice?: number;
  maximumPrice?: number;
  priceProvided?: boolean;
  grantsOrderPermission?: boolean;
  grantsDirectOrderPermission?: boolean;
  boundary: string;
};

export type KnowledgeEntity = Camp | TeacherProduct | PlatformService;

export function factId(entityId: string, field: string): string {
  return `${entityId}.${field}`;
}
