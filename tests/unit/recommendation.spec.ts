import { describe, expect, it } from "vitest";
import {
  recommendStudentCamps,
  recommendTeacherProducts,
} from "@/lib/rules";

describe("student deterministic recommendation mappings", () => {
  it("maps Beijing availability to the matching Beijing offline period", () => {
    const result = recommendStudentCamps({
      region: "beijing",
      availablePeriods: [1],
      canTravel: true,
      modePreference: "offline",
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations.map(({ item }) => item.id)).toEqual([
      "camp-p1-bj",
    ]);
    expect(result.recommendations[0].decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "period_available",
          constraintKeys: ["availablePeriods"],
        }),
        expect.objectContaining({ code: "region_match_bj" }),
      ]),
    );
  });

  it("maps Shanghai availability to the matching Shanghai offline period", () => {
    const result = recommendStudentCamps({
      region: "shanghai",
      availablePeriods: [2],
      canTravel: true,
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations[0].item.id).toBe("camp-p2-sh");
  });

  it("prefers online when travel is inconvenient or replay is required", () => {
    const result = recommendStudentCamps({
      region: "other",
      availablePeriods: [3],
      canTravel: false,
      needsReplay: true,
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations[0].item.id).toBe("camp-p3-online");
    expect(result.recommendations[0].decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "online_for_replay" }),
      ]),
    );
  });

  it("does not leak the teacher Guangzhou workshop into student camps", () => {
    const result = recommendStudentCamps({
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
    });

    expect(result).toMatchObject({
      status: "boundary_follow_up",
      boundaryCode: "student_guangzhou_offline_not_provided",
    });
    if (result.status !== "boundary_follow_up") return;
    expect(result.factIds.every((id) => id.startsWith("camp-"))).toBe(true);
    expect(result.nextQuestionKeys).toEqual(["canTravel"]);
    expect(result.nextQuestionOptions).toEqual([
      "可以前往北京",
      "可以前往上海",
      "均不便出行",
    ]);
    expect(result.decisionTrace[0]).toMatchObject({
      code: "student_guangzhou_offline_not_provided",
      constraintKeys: ["region", "modePreference"],
    });
  });

  it("recommends online only after the Guangzhou family confirms travel is impossible", () => {
    const result = recommendStudentCamps({
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
      canTravel: false,
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations[0].item.id).toBe("camp-p1-online");
    expect(result.recommendations[0].decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "guangzhou_student_offline_not_provided",
          constraintKeys: ["region"],
        }),
        expect.objectContaining({
          code: "beijing_shanghai_travel_unavailable",
          constraintKeys: ["canTravel"],
        }),
        expect.objectContaining({
          code: "online_fallback_for_unmet_offline_preference",
          constraintKeys: ["modePreference"],
        }),
      ]),
    );
  });

  it("filters by explicit available periods before applying delivery or campus", () => {
    const result = recommendStudentCamps({
      region: "guangzhou",
      availablePeriods: [1],
      modePreference: "offline",
      canTravel: false,
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations.every(({ item }) => item.period === 1)).toBe(true);
    expect(result.recommendations.map(({ item }) => item.id)).toEqual([
      "camp-p1-online",
    ]);
    expect(
      result.recommendations[0].decisionTrace
        .flatMap(({ factIds }) => factIds)
        .every((factId) => factId.startsWith("camp-p1-")),
    ).toBe(true);
  });

  it("exits with an explicit insufficient-information result after refusal", () => {
    expect(
      recommendStudentCamps({
        region: "beijing",
        refusesMoreQuestions: true,
      }),
    ).toMatchObject({
      status: "insufficient_information",
      effectiveConstraintCount: 1,
      canExit: true,
    });
  });

  it("asks for missing information before reaching two constraints", () => {
    expect(recommendStudentCamps({ region: "beijing" })).toMatchObject({
      status: "needs_more_information",
      effectiveConstraintCount: 1,
      canExit: false,
    });
  });

  it("returns no match when all three periods conflict", () => {
    expect(
      recommendStudentCamps({
        region: "beijing",
        canTravel: true,
        excludedPeriods: [1, 2, 3],
      }),
    ).toMatchObject({
      status: "no_match",
      boundaryCode: "student_date_conflict",
    });
  });
});

describe("teacher deterministic recommendation and prerequisites", () => {
  it("maps inability to leave work continuously to L1 weekend, including Guangzhou", () => {
    const result = recommendTeacherProducts({
      goal: "tools",
      canTakeContinuousLeave: false,
      city: "广州",
      availableProductIds: ["teacher-l1-weekend"],
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations[0].item.id).toBe("teacher-l1-weekend");
    expect(result.recommendations[0].item.cities).toContain("广州");
    expect(result.recommendations[0].decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "weekend_time" }),
        expect.objectContaining({ code: "city_confirmed" }),
      ]),
    );
  });

  it("maps complete continuous time and web-app goal to L2 intensive", () => {
    const result = recommendTeacherProducts({
      goal: "web-app",
      canTakeContinuousLeave: true,
      prerequisiteStatus: "met",
      availableProductIds: ["teacher-l2-intensive"],
    });

    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations[0].item.id).toBe("teacher-l2-intensive");
    expect(result.recommendations[0].decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "continuous_time" }),
        expect.objectContaining({ code: "prerequisite_met" }),
      ]),
    );
  });

  it("blocks L2 direct enrollment when its prerequisite is not met", () => {
    expect(
      recommendTeacherProducts({
        goal: "web-app",
        canTakeContinuousLeave: true,
        prerequisiteStatus: "not_met",
        availableProductIds: ["teacher-l2-intensive"],
      }),
    ).toMatchObject({
      status: "prerequisite_blocked",
      product: { id: "teacher-l2-intensive" },
      nextActions: ["recommend_L1", "ability_assessment"],
    });
  });

  it("blocks L3 direct enrollment and points to L2 or an equivalent project", () => {
    expect(
      recommendTeacherProducts({
        goal: "rag-project",
        canTakeContinuousLeave: false,
        prerequisiteStatus: "not_met",
        availableProductIds: ["teacher-l3-weekend"],
      }),
    ).toMatchObject({
      status: "prerequisite_blocked",
      nextActions: ["recommend_L2", "submit_equivalent_project"],
    });
  });

  it("does not default to intensive when continuous-time availability is missing", () => {
    expect(
      recommendTeacherProducts({ goal: "tools", city: "北京" }),
    ).toMatchObject({
      status: "needs_more_information",
      missingConstraintKeys: expect.arrayContaining([
        "canTakeContinuousLeave",
      ]),
    });
  });

  it("asks for L2 prerequisite evidence before making a recommendation", () => {
    expect(
      recommendTeacherProducts({
        goal: "web-app",
        canTakeContinuousLeave: true,
        prerequisiteStatus: "unknown",
      }),
    ).toMatchObject({
      status: "needs_more_information",
      missingConstraintKeys: expect.arrayContaining(["prerequisiteStatus"]),
    });
  });

  it("exits teacher collection after repeated failure to gain constraints", () => {
    expect(
      recommendTeacherProducts({ goal: "tools", stalledTurns: 2 }),
    ).toMatchObject({
      status: "insufficient_information",
      effectiveConstraintCount: 1,
      canExit: true,
    });
  });
});
