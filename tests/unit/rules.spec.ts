import { describe, expect, it } from "vitest";
import { MANUAL_RULE_GOLDENS } from "../fixtures/manual-rule-goldens";

// Executable acceptance specifications supplied by the participant for TASK-03.
// They are registered now so none of the date or discount branches can be lost,
// but remain TODO until the deterministic rule layer exists.
describe("participant-authored TASK-03 expectations", () => {
  it("locks 7 fee results and 10 status results before implementation", () => {
    expect(Object.keys(MANUAL_RULE_GOLDENS.fees)).toHaveLength(7);
    expect(Object.keys(MANUAL_RULE_GOLDENS.statuses)).toHaveLength(10);
    expect(MANUAL_RULE_GOLDENS.referenceDate).toBe("2026-07-22");
    expect(MANUAL_RULE_GOLDENS.timeZone).toBe("Asia/Shanghai");
  });
});

describe("TASK-03 date status rules at Shanghai date 2026-07-22", () => {
  it.todo("marks student period 1 and 2 early bird expired, period 3 active");
  it.todo("marks all three student registration deadlines active");
  it.todo(
    "marks L1 intensive, L1 weekend and L2 intensive early bird expired",
  );
  it.todo("marks L2 weekend, L3 intensive and L3 weekend early bird active");
  it.todo("marks all six teacher product registration deadlines active");
});

describe("TASK-03 fee branches at Shanghai date 2026-07-22", () => {
  it.todo(
    `prices period 1 Beijing offline single registration at ${MANUAL_RULE_GOLDENS.fees["fee.p1.beijing.single"]}`,
  );
  it.todo(
    "prices period 1 Beijing offline 3-person group at 6680 after early bird expiry",
  );
  it.todo(
    "prices period 1 Beijing offline 3-person group plus lodging package at 9040",
  );
  it.todo("prices period 3 online single registration at early-bird 3280");
  it.todo(
    "prices period 3 online 3-person group at 3280 because early bird beats group discount",
  );
  it.todo("prices L1 weekend single registration at 2980 after early bird expiry");
  it.todo("prices L2 weekend single registration at early-bird 5980");
});
