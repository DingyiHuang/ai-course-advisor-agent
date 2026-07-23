import type {
  StudentConstraints,
  TeacherConstraints,
  InstitutionNeed,
  DecisionTraceItem,
} from "./rules";
import type { CollectedSource } from "@/lib/citations";

export type ConversationDomain = "unknown" | "student" | "teacher" | "platform";

export type ConversationIntent =
  | "recommendation"
  | "fact_question"
  | "institution_service"
  | "reset"
  | "menu"
  | "unrelated"
  | "unknown";

export type FactTopic =
  | "schedule"
  | "registration"
  | "price"
  | "location"
  | "required_items"
  | "fee_includes"
  | "refund"
  | "replay"
  | "availability"
  | "curriculum"
  | "prerequisite";

export type ShortHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationState = {
  version: 1;
  domain: ConversationDomain;
  studentConstraints: StudentConstraints;
  teacherConstraints: TeacherConstraints;
  institutionNeed?: InstitutionNeed;
  selectedEntityId?: string;
  lastRecommendationIds: string[];
  pendingQuestionKeys: string[];
  pendingQuestionOptions: string[];
  shortHistory: ShortHistoryItem[];
  test: { failNextModelCall: boolean };
};

export type GroundedFact = {
  id: string;
  label: string;
  value: unknown;
};

export type GroundedCalculation = {
  label: string;
  value: unknown;
  relatedFactIds: string[];
};

export type ComposerPlanStatus =
  | "needs_identity"
  | "needs_more_information"
  | "insufficient_information"
  | "boundary_follow_up"
  | "recommended"
  | "no_match"
  | "prerequisite_blocked"
  | "institution_info"
  | "fact_answer"
  | "catalog"
  | "unrelated";

export type ComposerRoute =
  | "ask_follow_up"
  | "recommendation"
  | "fact_answer"
  | "boundary"
  | "institution"
  | "catalog"
  | "insufficient_information"
  | "no_match"
  | "unrelated";

export type ComposerPlan = {
  status: ComposerPlanStatus;
  route: ComposerRoute;
  domain: ConversationDomain;
  facts: GroundedFact[];
  calculations: GroundedCalculation[];
  decisionTrace: DecisionTraceItem[];
  nextQuestionKeys: string[];
  nextQuestionOptions: string[];
  actions: string[];
  entityIds: string[];
  boundaryCode?: string;
  requiredPrefix?: string;
  crossDomainNotice?: string;
};

export type ComposerOutput = {
  message: string;
  usedFactIds: string[];
  actions: string[];
  recommendationReasons: RecommendationReasonGroup[];
};

export type RecommendationReasonItem = {
  constraintKey: string;
  reason: string;
};

export type RecommendationReasonGroup = {
  entityId: string;
  reasons: RecommendationReasonItem[];
};

export type RecommendationCard = {
  entityId: string;
  kind: "student" | "teacher";
  name: string;
  date: string;
  delivery: string;
  standardPrice: number;
  actualPrice: number;
  discountLabel: string;
  reasons: Array<
    RecommendationReasonItem & {
      constraintLabel: string;
      constraintValue: string;
    }
  >;
  sources: CollectedSource[];
  availabilityNote: string;
};

export type InstitutionServiceCard = {
  entityId: string;
  name: string;
  audience: string;
  pricingRule: string;
  boundary: string;
  sources: CollectedSource[];
};

export type ChatPresentation = {
  recommendations: RecommendationCard[];
  institutionService?: InstitutionServiceCard;
};

export type ChatError = {
  code:
    | "invalid_input"
    | "model_unavailable"
    | "grounding_rejected"
    | "simulated_model_failure";
  retryable: boolean;
};

export type ChatNotice = {
  code: "identity_switched";
  message: string;
  fromDomain: Exclude<ConversationDomain, "unknown">;
  toDomain: Exclude<ConversationDomain, "unknown">;
};

export type ChatResponse = {
  status:
    | ComposerPlanStatus
    | "catalog"
    | "selection"
    | "identity_selected"
    | "reset"
    | "menu"
    | "test_failure_armed"
    | "error";
  message: string;
  state: ConversationState;
  sources: CollectedSource[];
  entityIds: string[];
  actions: string[];
  presentation: ChatPresentation;
  notices: ChatNotice[];
  boundaryCode?: string;
  error?: ChatError;
};
