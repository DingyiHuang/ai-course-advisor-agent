import type {
  InstitutionNeed,
  InstitutionRoute,
} from "@/lib/domain/rules";
import { getPlatformService } from "@/lib/knowledge";

const SERVICE_IDS: Record<InstitutionNeed, string> = {
  membership: "platform-membership",
  enterprise_training: "platform-enterprise-training",
  school_procurement: "platform-school-procurement",
  basic_agent: "platform-basic-agent",
  ai_web: "platform-ai-web",
  rag: "platform-rag",
};

export function routeInstitutionNeed(need: InstitutionNeed): InstitutionRoute {
  const service = getPlatformService(SERVICE_IDS[need]);
  const factIds = [
    `${service.id}.category`,
    `${service.id}.audience`,
    `${service.id}.boundary`,
  ];

  if (service.pricingRule !== undefined) {
    factIds.push(`${service.id}.pricingRule`);
  }
  if (need === "school_procurement") {
    factIds.push(
      `${service.id}.minimumPeople`,
      `${service.id}.minimumTotalPrice`,
    );
  }
  if (need === "membership") {
    factIds.push(
      `${service.id}.priceProvided`,
      `${service.id}.grantsOrderPermission`,
    );
  }

  return {
    domain: "platform",
    service,
    entersPersonalRecommendation: false,
    requiresSimulatedConsultant: true,
    factIds,
    decisionTrace: [
      {
        code: `institution_${need}`,
        constraintKeys: ["institutionNeed"],
        constraintValues: { institutionNeed: need },
        factIds,
      },
    ],
  };
}
