import type { TeacherProduct } from "@/lib/domain/knowledge";
import { getPlatformService } from "@/lib/knowledge";

export function teacherRefundBoundary(product: TeacherProduct): {
  status: "not_provided";
  provided: false;
  factIds: string[];
} {
  return {
    status: "not_provided",
    provided: product.refundPolicyProvided,
    factIds: [`${product.id}.refundPolicyProvided`],
  };
}

export function membershipPriceBoundary(): {
  status: "not_provided";
  provided: false;
  factIds: string[];
} {
  const membership = getPlatformService("platform-membership");

  if (membership.priceProvided !== false) {
    throw new Error("Membership price boundary is not configured");
  }

  return {
    status: "not_provided",
    provided: false,
    factIds: [`${membership.id}.priceProvided`],
  };
}
