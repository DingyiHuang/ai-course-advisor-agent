import { describe, expect, it } from "vitest";
import {
  membershipPriceBoundary,
  routeInstitutionNeed,
  teacherRefundBoundary,
} from "@/lib/rules";
import { getTeacherProduct } from "@/lib/knowledge";

describe("institution routing stays inside material C", () => {
  it("routes enterprise training to its organization price, not teacher personal fees", () => {
    const route = routeInstitutionNeed("enterprise_training");

    expect(route).toMatchObject({
      domain: "platform",
      entersPersonalRecommendation: false,
      requiresSimulatedConsultant: true,
      service: {
        id: "platform-enterprise-training",
        minimumPeople: 50,
        minimumPricePerPerson: 500,
        maximumPricePerPerson: 1500,
      },
    });
    expect(route.factIds.every((id) => id.startsWith("platform-"))).toBe(true);
  });

  it("routes school procurement to 20-person and 50000-yuan minimums", () => {
    const route = routeInstitutionNeed("school_procurement");

    expect(route.service).toMatchObject({
      id: "platform-school-procurement",
      minimumPeople: 20,
      minimumTotalPrice: 50000,
    });
    expect("standardPrice" in route.service).toBe(false);
  });

  it("keeps the absent membership price as an explicit boundary fact", () => {
    const boundary = membershipPriceBoundary();
    const route = routeInstitutionNeed("membership");

    expect(boundary).toMatchObject({
      status: "not_provided",
      provided: false,
      factIds: ["platform-membership.priceProvided"],
    });
    expect(route.factIds).toContain("platform-membership.priceProvided");
    expect(route.factIds).not.toContain("platform-membership.pricingRule");
  });
});

describe("material boundaries remain explicit", () => {
  it("does not borrow student refund rules for a teacher product", () => {
    expect(teacherRefundBoundary(getTeacherProduct("L1", "intensive"))).toEqual({
      status: "not_provided",
      provided: false,
      factIds: ["teacher-l1-intensive.refundPolicyProvided"],
    });
  });
});
