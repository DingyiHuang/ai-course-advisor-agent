import { describe, expect, it } from "vitest";
import {
  recommendStudentCamps,
  recommendTeacherProducts,
  routeInstitutionNeed,
} from "@/lib/rules";
import type {
  DecisionTraceItem,
  StudentConstraints,
  TeacherConstraints,
} from "@/lib/domain/rules";

function printForReview(label: string, value: unknown): void {
  if (process.env.PRINT_REVIEW_TRACES === "1") {
    console.log(`REVIEW_SAMPLE ${label}\n${JSON.stringify(value, null, 2)}`);
  }
}

function expectOnlyCollectedConstraintKeys(
  decisionTrace: DecisionTraceItem[],
  collectedConstraints: object,
): void {
  const collectedKeys = new Set(
    Object.entries(collectedConstraints)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key),
  );
  const uncollectedKeys = decisionTrace
    .flatMap((trace) => trace.constraintKeys)
    .filter((key) => !collectedKeys.has(key));

  expect(uncollectedKeys).toEqual([]);
}

describe("three participant review samples", () => {
  it("keeps Guangzhou offline inquiry at the travel clarification step", () => {
    const constraints: StudentConstraints = {
      region: "guangzhou",
      modePreference: "offline",
      availablePeriods: [1],
    };
    const result = recommendStudentCamps(constraints);

    printForReview("guangzhou_parent_offline", result);
    expect(result).toMatchObject({
      status: "boundary_follow_up",
      boundaryCode: "student_guangzhou_offline_not_provided",
      nextQuestionKeys: ["canTravel"],
      nextQuestionOptions: [
        "可以前往北京",
        "可以前往上海",
        "均不便出行",
      ],
    });
    if (result.status !== "boundary_follow_up") return;
    expectOnlyCollectedConstraintKeys(result.decisionTrace, constraints);
  });

  it("maps a beginner who cannot leave work to L1 weekend only", () => {
    const constraints: TeacherConstraints = {
      startingLevel: "beginner",
      canTakeContinuousLeave: false,
    };
    const result = recommendTeacherProducts(constraints);

    printForReview("beginner_teacher_weekday_unavailable", result);
    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations.map(({ item }) => item.id)).toEqual([
      "teacher-l1-weekend",
    ]);
    expectOnlyCollectedConstraintKeys(
      result.recommendations.flatMap(
        (recommendation) => recommendation.decisionTrace,
      ),
      constraints,
    );
    expect(result.recommendations[0].decisionTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "level_l1",
          constraintKeys: ["startingLevel"],
        }),
      ]),
    );
  });

  it("keeps 20-person school procurement in platform pricing only", () => {
    const result = routeInstitutionNeed("school_procurement");

    printForReview("school_procurement_20_people", result);
    expect(result.service).toMatchObject({
      minimumPeople: 20,
      minimumTotalPrice: 50000,
    });
    expect(JSON.stringify(result)).not.toContain("2980");
  });
});
