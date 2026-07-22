import { describe, expect, it } from "vitest";
import {
  recommendStudentCamps,
  recommendTeacherProducts,
  routeInstitutionNeed,
} from "@/lib/rules";

function printForReview(label: string, value: unknown): void {
  if (process.env.PRINT_REVIEW_TRACES === "1") {
    console.log(`REVIEW_SAMPLE ${label}\n${JSON.stringify(value, null, 2)}`);
  }
}

describe("three participant review samples", () => {
  it("keeps Guangzhou offline inquiry at the travel clarification step", () => {
    const result = recommendStudentCamps({
      region: "guangzhou",
      modePreference: "offline",
      availablePeriods: [1],
    });

    printForReview("guangzhou_parent_offline", result);
    expect(result).toMatchObject({
      status: "no_match",
      boundaryCode: "student_guangzhou_offline_not_provided",
      nextQuestionKeys: ["canTravel"],
      nextQuestionOptions: [
        "可以前往北京",
        "可以前往上海",
        "均不便出行",
      ],
    });
  });

  it("maps a beginner who cannot leave work to L1 weekend only", () => {
    const result = recommendTeacherProducts({
      goal: "tools",
      canTakeContinuousLeave: false,
    });

    printForReview("beginner_teacher_weekday_unavailable", result);
    expect(result.status).toBe("recommended");
    if (result.status !== "recommended") return;
    expect(result.recommendations.map(({ item }) => item.id)).toEqual([
      "teacher-l1-weekend",
    ]);
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
