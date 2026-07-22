import { describe, expect, it } from "vitest";
import {
  CAMPS,
  CAMP_FIELD_SOURCES,
  KNOWLEDGE_COUNTS,
  PLATFORM_SERVICES,
  PLATFORM_SERVICE_FIELD_SOURCES,
  sourcedFact,
  TEACHER_PRODUCTS,
  TEACHER_PRODUCT_FIELD_SOURCES,
} from "@/lib/knowledge";

describe("typed knowledge inventory", () => {
  it("contains 9 student combinations, 6 teacher products and 7 platform services", () => {
    expect(KNOWLEDGE_COUNTS).toEqual({
      camps: 9,
      teacherProducts: 6,
      platformServices: 7,
    });
  });

  it("never treats capacity or minimum-to-open as live availability", () => {
    expect(CAMPS.every((camp) => camp.availabilityKnown === false)).toBe(true);
    expect(
      TEACHER_PRODUCTS.every(
        (product) => product.availabilityKnown === false,
      ),
    ).toBe(true);
  });

  it("keeps all student group-discount inputs in typed knowledge", () => {
    expect(
      CAMPS.every(
        (camp) =>
          camp.groupMinimum === 3 &&
          camp.groupDiscount === 300 &&
          camp.groupScope === "同一期、同一班型",
      ),
    ).toBe(true);
  });

  it("provides sources for every scoring-critical top-level field", () => {
    const campFields = [
      "startDate",
      "registrationDeadline",
      "earlyBirdDeadline",
      "standardPrice",
      "earlyBirdPrice",
      "groupDiscount",
      "groupMinimum",
      "groupScope",
      "addressOrPlatform",
      "dailyOutline",
      "requiredItems",
      "refundRules",
      "availabilityKnown",
    ] as const;
    const teacherFields = [
      "cities",
      "schedule",
      "registrationDeadline",
      "earlyBirdDeadline",
      "standardPrice",
      "groupDiscount",
      "deviceRequirements",
      "replayPolicy",
      "prerequisite",
      "availabilityKnown",
    ] as const;
    const platformFields = [
      "pricingRule",
      "minimumPeople",
      "minimumPrice",
      "grantsOrderPermission",
      "grantsDirectOrderPermission",
      "boundary",
    ] as const;

    for (const field of campFields) {
      expect(CAMP_FIELD_SOURCES[field], `camp.${field}`).toBeDefined();
    }
    for (const field of teacherFields) {
      expect(
        TEACHER_PRODUCT_FIELD_SOURCES[field],
        `teacher.${field}`,
      ).toBeDefined();
    }
    for (const field of platformFields) {
      expect(
        PLATFORM_SERVICE_FIELD_SOURCES[field],
        `platform.${field}`,
      ).toBeDefined();
    }
  });

  it("derives fact IDs and sources without asking the model for chapters", () => {
    expect(sourcedFact("camp", "camp-p1-bj", "standardPrice")).toEqual({
      id: "camp-p1-bj.standardPrice",
      source: { document: "A", chapter: "第五章" },
    });
    expect(
      sourcedFact("teacher", "teacher-l2-weekend", "schedule"),
    ).toEqual({
      id: "teacher-l2-weekend.schedule",
      source: { document: "B", chapter: "第二章" },
    });
    expect(
      sourcedFact("platform", "platform-school-procurement", "pricingRule"),
    ).toEqual({
      id: "platform-school-procurement.pricingRule",
      source: { document: "C", chapter: "第六章" },
    });
  });

  it("keeps platform services in the platform domain only", () => {
    expect(PLATFORM_SERVICES.map((service) => service.id)).toContain(
      "platform-school-procurement",
    );
  });
});
