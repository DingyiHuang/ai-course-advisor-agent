import type {
  Camp,
  PlatformService,
  TeacherProduct,
} from "@/lib/domain/knowledge";
import type { BusinessDate } from "@/lib/time/shanghai";

export type DeadlineStatus = "active" | "expired";
export type DiscountKind = "none" | "earlyBird" | "group";

export type DecisionTraceItem = {
  code: string;
  constraintKeys: string[];
  factIds: string[];
};

export type FeeDecision = {
  currentDate: BusinessDate;
  registrationStatus: DeadlineStatus;
  earlyBirdStatus: DeadlineStatus;
  basePrice: number;
  earlyBirdDiscount: number;
  groupDiscount: number;
  appliedDiscount: number;
  discountKind: DiscountKind;
  lodgingPrice: number;
  total: number;
  factIds: string[];
  decisionTrace: DecisionTraceItem[];
};

export type StudentRegion =
  | "beijing"
  | "shanghai"
  | "guangzhou"
  | "other";

export type StudentConstraints = {
  region?: StudentRegion;
  availablePeriods?: Array<Camp["period"]>;
  excludedPeriods?: Array<Camp["period"]>;
  modePreference?: "offline" | "online" | "either";
  canTravel?: boolean;
  needsReplay?: boolean;
  learningGoal?: string;
  refusesMoreQuestions?: boolean;
  stalledTurns?: number;
};

export type TeacherGoal = "tools" | "web-app" | "rag-project";
export type PrerequisiteStatus = "met" | "not_met" | "unknown";

export type TeacherConstraints = {
  level?: TeacherProduct["level"];
  goal?: TeacherGoal;
  canTakeContinuousLeave?: boolean;
  availableProductIds?: string[];
  city?: string;
  prerequisiteStatus?: PrerequisiteStatus;
  refusesMoreQuestions?: boolean;
  stalledTurns?: number;
};

export type Recommendation<T> = {
  item: T;
  decisionTrace: DecisionTraceItem[];
  factIds: string[];
};

export type RecommendationResult<T> =
  | {
      status: "recommended";
      recommendations: Array<Recommendation<T>>;
      effectiveConstraintCount: number;
    }
  | {
      status: "needs_more_information";
      missingConstraintKeys: string[];
      effectiveConstraintCount: number;
      canExit: false;
    }
  | {
      status: "insufficient_information";
      missingConstraintKeys: string[];
      effectiveConstraintCount: number;
      canExit: true;
    }
  | {
      status: "no_match";
      boundaryCode: string;
      factIds: string[];
      effectiveConstraintCount: number;
    }
  | {
      status: "prerequisite_blocked";
      product: TeacherProduct;
      nextActions: string[];
      factIds: string[];
      effectiveConstraintCount: number;
    };

export type InstitutionNeed =
  | "membership"
  | "enterprise_training"
  | "school_procurement"
  | "basic_agent"
  | "ai_web"
  | "rag";

export type InstitutionRoute = {
  domain: "platform";
  service: PlatformService;
  entersPersonalRecommendation: false;
  requiresSimulatedConsultant: true;
  factIds: string[];
  decisionTrace: DecisionTraceItem[];
};
