import { describe, expect, it } from "vitest";
import type { BusinessDate } from "@/lib/time/shanghai";
import { CAMPS, TEACHER_PRODUCTS, getCamp, getTeacherProduct } from "@/lib/knowledge";
import {
  calculateCampFee,
  calculateTeacherFee,
  getCampStatuses,
  getTeacherProductStatuses,
} from "@/lib/rules";
import { MANUAL_RULE_GOLDENS } from "../fixtures/manual-rule-goldens";

const CURRENT_DATE = MANUAL_RULE_GOLDENS.referenceDate as BusinessDate;

describe("participant-authored TASK-03 expectations", () => {
  it("locks 7 fee results and 10 status results before implementation", () => {
    expect(Object.keys(MANUAL_RULE_GOLDENS.fees)).toHaveLength(7);
    expect(Object.keys(MANUAL_RULE_GOLDENS.statuses)).toHaveLength(10);
    expect(CURRENT_DATE).toBe("2026-07-22");
    expect(MANUAL_RULE_GOLDENS.timeZone).toBe("Asia/Shanghai");
  });
});

describe("TASK-03 date status rules at Shanghai date 2026-07-22", () => {
  it("marks student period 1 and 2 early bird expired, period 3 active", () => {
    expect(getCampStatuses(getCamp(1, "bj"), CURRENT_DATE).earlyBird).toBe(
      MANUAL_RULE_GOLDENS.statuses["earlyBird.status.p1"],
    );
    expect(getCampStatuses(getCamp(2, "bj"), CURRENT_DATE).earlyBird).toBe(
      MANUAL_RULE_GOLDENS.statuses["earlyBird.status.p2"],
    );
    expect(getCampStatuses(getCamp(3, "bj"), CURRENT_DATE).earlyBird).toBe(
      MANUAL_RULE_GOLDENS.statuses["earlyBird.status.p3"],
    );
  });

  it("marks all three student registration deadlines active", () => {
    const status = CAMPS.every(
      (camp) => getCampStatuses(camp, CURRENT_DATE).registration === "active",
    )
      ? "open"
      : "closed";
    expect(status).toBe(MANUAL_RULE_GOLDENS.statuses["registration.status.all"]);
  });

  it("marks L1 intensive, L1 weekend and L2 intensive early bird expired", () => {
    expect(
      getTeacherProductStatuses(
        getTeacherProduct("L1", "intensive"),
        CURRENT_DATE,
      ).earlyBird,
    ).toBe(
      MANUAL_RULE_GOLDENS.statuses[
        "earlyBird.status.teacher.L1.intensive"
      ],
    );
    expect(
      getTeacherProductStatuses(
        getTeacherProduct("L1", "weekend"),
        CURRENT_DATE,
      ).earlyBird,
    ).toBe(
      MANUAL_RULE_GOLDENS.statuses["earlyBird.status.teacher.L1.weekend"],
    );
    expect(
      getTeacherProductStatuses(
        getTeacherProduct("L2", "intensive"),
        CURRENT_DATE,
      ).earlyBird,
    ).toBe(
      MANUAL_RULE_GOLDENS.statuses[
        "earlyBird.status.teacher.L2.intensive"
      ],
    );
  });

  it("marks L2 weekend, L3 intensive and L3 weekend early bird active", () => {
    expect(
      getTeacherProductStatuses(
        getTeacherProduct("L2", "weekend"),
        CURRENT_DATE,
      ).earlyBird,
    ).toBe(
      MANUAL_RULE_GOLDENS.statuses["earlyBird.status.teacher.L2.weekend"],
    );
    expect(
      getTeacherProductStatuses(
        getTeacherProduct("L3", "intensive"),
        CURRENT_DATE,
      ).earlyBird,
    ).toBe(
      MANUAL_RULE_GOLDENS.statuses[
        "earlyBird.status.teacher.L3.intensive"
      ],
    );
    expect(
      getTeacherProductStatuses(
        getTeacherProduct("L3", "weekend"),
        CURRENT_DATE,
      ).earlyBird,
    ).toBe(
      MANUAL_RULE_GOLDENS.statuses["earlyBird.status.teacher.L3.weekend"],
    );
  });

  it("marks all six teacher product registration deadlines active", () => {
    const status = TEACHER_PRODUCTS.every(
      (product) =>
        getTeacherProductStatuses(product, CURRENT_DATE).registration ===
        "active",
    )
      ? "open"
      : "closed";
    expect(status).toBe(MANUAL_RULE_GOLDENS.statuses["registration.status.all"]);
  });
});

describe("TASK-03 fee branches at Shanghai date 2026-07-22", () => {
  it("prices period 1 Beijing offline single registration at the standard price", () => {
    const decision = calculateCampFee({
      camp: getCamp(1, "bj"),
      currentDate: CURRENT_DATE,
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.p1.beijing.single"],
    );
    expect(decision.registrationStatus).toBe("active");
    expect(decision.earlyBirdStatus).toBe("expired");
    expect(decision.discountKind).toBe("none");
  });

  it("executes the group branch for period 1 Beijing 3-person registration", () => {
    const decision = calculateCampFee({
      camp: getCamp(1, "bj"),
      currentDate: CURRENT_DATE,
      group: { size: 3, samePeriodAndCamp: true },
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.p1.beijing.group3"],
    );
    expect(decision.discountKind).toBe("group");
    expect(decision.groupDiscount).toBe(300);
    expect(decision.factIds).toEqual(
      expect.arrayContaining([
        "camp-p1-bj.groupMinimum",
        "camp-p1-bj.groupDiscount",
        "camp-p1-bj.groupScope",
      ]),
    );
  });

  it("does not apply a student group discount when the same-period-and-camp scope fails", () => {
    const decision = calculateCampFee({
      camp: getCamp(1, "bj"),
      currentDate: CURRENT_DATE,
      group: { size: 3, samePeriodAndCamp: false },
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.p1.beijing.single"],
    );
    expect(decision.discountKind).toBe("none");
    expect(decision.groupDiscount).toBe(0);
  });

  it("adds the optional lodging package after the period 1 group discount", () => {
    const decision = calculateCampFee({
      camp: getCamp(1, "bj"),
      currentDate: CURRENT_DATE,
      group: { size: 3, samePeriodAndCamp: true },
      includeLodging: true,
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.p1.beijing.group3.withLodging"],
    );
    expect(decision.lodgingPrice).toBe(2360);
  });

  it("prices period 3 online single registration at the early-bird price", () => {
    const decision = calculateCampFee({
      camp: getCamp(3, "online"),
      currentDate: CURRENT_DATE,
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.p3.online.single"],
    );
    expect(decision.discountKind).toBe("earlyBird");
  });

  it("chooses period 3 early bird over the smaller 3-person group discount", () => {
    const decision = calculateCampFee({
      camp: getCamp(3, "online"),
      currentDate: CURRENT_DATE,
      group: { size: 3, samePeriodAndCamp: true },
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.p3.online.group3"],
    );
    expect(decision.discountKind).toBe("earlyBird");
    expect(decision.earlyBirdDiscount).toBeGreaterThan(decision.groupDiscount);
  });

  it("prices L1 weekend single registration without expired early bird", () => {
    const decision = calculateTeacherFee({
      product: getTeacherProduct("L1", "weekend"),
      currentDate: CURRENT_DATE,
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.teacher.L1.weekend.single"],
    );
    expect(decision.discountKind).toBe("none");
  });

  it("prices L2 weekend single registration with active early bird", () => {
    const decision = calculateTeacherFee({
      product: getTeacherProduct("L2", "weekend"),
      currentDate: CURRENT_DATE,
    });

    expect(decision.total).toBe(
      MANUAL_RULE_GOLDENS.fees["fee.teacher.L2.weekend.single"],
    );
    expect(decision.discountKind).toBe("earlyBird");
  });
});
