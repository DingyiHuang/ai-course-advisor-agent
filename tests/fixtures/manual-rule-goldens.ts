// Values supplied directly by the participant before TASK-03 implementation.
// Rule tests must compare implementation output to this fixture; they must not
// derive expected values by calling the production fee or status functions.
export const MANUAL_RULE_GOLDENS = {
  referenceDate: "2026-07-22",
  timeZone: "Asia/Shanghai",
  fees: {
    "fee.p1.beijing.single": 6980,
    "fee.p1.beijing.group3": 6680,
    "fee.p1.beijing.group3.withLodging": 9040,
    "fee.p3.online.single": 3280,
    "fee.p3.online.group3": 3280,
    "fee.teacher.L1.weekend.single": 2980,
    "fee.teacher.L2.weekend.single": 5980,
  },
  statuses: {
    "earlyBird.status.p1": "expired",
    "earlyBird.status.p2": "expired",
    "earlyBird.status.p3": "active",
    "earlyBird.status.teacher.L1.intensive": "expired",
    "earlyBird.status.teacher.L1.weekend": "expired",
    "earlyBird.status.teacher.L2.intensive": "expired",
    "earlyBird.status.teacher.L2.weekend": "active",
    "earlyBird.status.teacher.L3.intensive": "active",
    "earlyBird.status.teacher.L3.weekend": "active",
    "registration.status.all": "open",
  },
} as const;
