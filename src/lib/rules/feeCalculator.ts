import type { Camp, TeacherProduct } from "@/lib/domain/knowledge";
import type { FeeDecision } from "@/lib/domain/rules";
import type { BusinessDate } from "@/lib/time/shanghai";
import { getCampStatuses, getTeacherProductStatuses } from "./status";

export type CampGroup = {
  size: number;
  samePeriodAndCamp: boolean;
};

export type TeacherGroup = {
  size: number;
  sameSchoolAndProduct: boolean;
};

export function calculateCampFee(input: {
  camp: Camp;
  currentDate: BusinessDate;
  group?: CampGroup;
  includeLodging?: boolean;
}): FeeDecision {
  const { camp, currentDate } = input;
  const statuses = getCampStatuses(camp, currentDate);
  const groupSize = input.group?.size ?? 1;
  const groupScopeMatches = input.group?.samePeriodAndCamp === true;

  if (groupSize < 1 || !Number.isInteger(groupSize)) {
    throw new Error("Group size must be a positive integer");
  }

  if (input.includeLodging && camp.deliveryMode !== "offline") {
    throw new Error("Online camp does not provide lodging");
  }

  const earlyBirdDiscount =
    statuses.earlyBird === "active"
      ? camp.standardPrice - camp.earlyBirdPrice
      : 0;
  const qualifiesForGroup =
    groupScopeMatches &&
    camp.groupScope.trim().length > 0 &&
    groupSize >= camp.groupMinimum;
  const groupDiscount = qualifiesForGroup ? camp.groupDiscount : 0;
  const discountKind =
    earlyBirdDiscount >= groupDiscount && earlyBirdDiscount > 0
      ? "earlyBird"
      : groupDiscount > 0
        ? "group"
        : "none";
  const appliedDiscount = Math.max(earlyBirdDiscount, groupDiscount);
  const lodgingPrice = input.includeLodging ? (camp.lodgingPrice ?? 0) : 0;
  const factIds = [
    `${camp.id}.standardPrice`,
    `${camp.id}.registrationDeadline`,
    `${camp.id}.earlyBirdDeadline`,
  ];

  if (earlyBirdDiscount > 0) {
    factIds.push(`${camp.id}.earlyBirdPrice`);
  }
  if (qualifiesForGroup) {
    factIds.push(
      `${camp.id}.groupMinimum`,
      `${camp.id}.groupDiscount`,
      `${camp.id}.groupScope`,
    );
  }
  if (input.includeLodging) {
    factIds.push(`${camp.id}.lodgingPrice`);
  }

  return {
    currentDate,
    registrationStatus: statuses.registration,
    earlyBirdStatus: statuses.earlyBird,
    basePrice: camp.standardPrice,
    earlyBirdDiscount,
    groupDiscount,
    appliedDiscount,
    discountKind,
    lodgingPrice,
    total: camp.standardPrice - appliedDiscount + lodgingPrice,
    factIds,
    decisionTrace: [
      {
        code: `registration_${statuses.registration}`,
        constraintKeys: ["currentDate"],
        factIds: [`${camp.id}.registrationDeadline`],
      },
      {
        code: `early_bird_${statuses.earlyBird}`,
        constraintKeys: ["currentDate"],
        factIds: [`${camp.id}.earlyBirdDeadline`],
      },
      {
        code: `discount_${discountKind}`,
        constraintKeys: ["group.size", "group.samePeriodAndCamp"],
        factIds: factIds.filter((id) =>
          /earlyBirdPrice|groupMinimum|groupDiscount|groupScope/.test(id),
        ),
      },
    ],
  };
}

export function calculateTeacherFee(input: {
  product: TeacherProduct;
  currentDate: BusinessDate;
  group?: TeacherGroup;
}): FeeDecision {
  const { product, currentDate } = input;
  const statuses = getTeacherProductStatuses(product, currentDate);
  const groupSize = input.group?.size ?? 1;
  const groupScopeMatches = input.group?.sameSchoolAndProduct === true;

  if (groupSize < 1 || !Number.isInteger(groupSize)) {
    throw new Error("Group size must be a positive integer");
  }

  const earlyBirdDiscount =
    statuses.earlyBird === "active" ? product.earlyBirdDiscount : 0;
  const qualifiesForGroup =
    groupScopeMatches &&
    groupSize >= product.groupMinimum;
  const groupDiscount = qualifiesForGroup ? product.groupDiscount : 0;
  const discountKind =
    earlyBirdDiscount >= groupDiscount && earlyBirdDiscount > 0
      ? "earlyBird"
      : groupDiscount > 0
        ? "group"
        : "none";
  const appliedDiscount = Math.max(earlyBirdDiscount, groupDiscount);
  const factIds = [
    `${product.id}.standardPrice`,
    `${product.id}.registrationDeadline`,
    `${product.id}.earlyBirdDeadline`,
  ];

  if (earlyBirdDiscount > 0) {
    factIds.push(`${product.id}.earlyBirdDiscount`);
  }
  if (qualifiesForGroup) {
    factIds.push(
      `${product.id}.groupMinimum`,
      `${product.id}.groupDiscount`,
    );
  }

  return {
    currentDate,
    registrationStatus: statuses.registration,
    earlyBirdStatus: statuses.earlyBird,
    basePrice: product.standardPrice,
    earlyBirdDiscount,
    groupDiscount,
    appliedDiscount,
    discountKind,
    lodgingPrice: 0,
    total: product.standardPrice - appliedDiscount,
    factIds,
    decisionTrace: [
      {
        code: `registration_${statuses.registration}`,
        constraintKeys: ["currentDate"],
        factIds: [`${product.id}.registrationDeadline`],
      },
      {
        code: `early_bird_${statuses.earlyBird}`,
        constraintKeys: ["currentDate"],
        factIds: [`${product.id}.earlyBirdDeadline`],
      },
      {
        code: `discount_${discountKind}`,
        constraintKeys: ["group.size", "group.sameSchoolAndProduct"],
        factIds: factIds.filter((id) =>
          /earlyBirdDiscount|groupMinimum|groupDiscount/.test(id),
        ),
      },
    ],
  };
}
