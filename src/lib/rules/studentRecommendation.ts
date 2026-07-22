import type { Camp } from "@/lib/domain/knowledge";
import type {
  DecisionTraceItem,
  Recommendation,
  RecommendationResult,
  StudentConstraints,
} from "@/lib/domain/rules";
import { CAMPS } from "@/lib/knowledge";

function collectedStudentConstraintKeys(
  constraints: StudentConstraints,
  keys: Array<keyof StudentConstraints>,
): string[] {
  return keys.filter((key) => constraints[key] !== undefined);
}

function countStudentConstraints(constraints: StudentConstraints): number {
  return [
    constraints.region,
    constraints.preferredOfflineCampus,
    constraints.availablePeriods?.length || constraints.excludedPeriods?.length,
    constraints.modePreference,
    constraints.canTravel,
    constraints.needsReplay,
    constraints.learningGoal,
  ].filter((value) => value !== undefined && value !== 0).length;
}

function missingStudentConstraints(
  constraints: StudentConstraints,
): string[] {
  const missing: string[] = [];

  if (!constraints.region) missing.push("region");
  if (
    !constraints.availablePeriods?.length &&
    !constraints.excludedPeriods?.length
  ) {
    missing.push("availablePeriods");
  }
  if (!constraints.modePreference && constraints.canTravel === undefined) {
    missing.push("modePreference");
  }
  if (!constraints.learningGoal && constraints.needsReplay === undefined) {
    missing.push("learningGoal");
  }
  if (
    constraints.region === "guangzhou" &&
    constraints.modePreference === "offline"
  ) {
    if (constraints.canTravel === undefined) {
      missing.push("canTravel");
    } else if (
      constraints.canTravel === true &&
      !constraints.preferredOfflineCampus
    ) {
      missing.push("preferredOfflineCampus");
    }
  }

  return missing;
}

function chooseCampus(
  constraints: StudentConstraints,
): Camp["campus"] | undefined {
  if (
    constraints.modePreference === "online" ||
    constraints.canTravel === false ||
    constraints.needsReplay === true
  ) {
    return "online";
  }

  if (constraints.region === "beijing") return "bj";
  if (constraints.region === "shanghai") return "sh";
  if (constraints.preferredOfflineCampus === "beijing") return "bj";
  if (constraints.preferredOfflineCampus === "shanghai") return "sh";

  if (constraints.modePreference === "either") return "online";
  return undefined;
}

function toStudentRecommendation(
  camp: Camp,
  constraints: StudentConstraints,
): Recommendation<Camp> {
  const decisionTrace: DecisionTraceItem[] = [];

  if (constraints.availablePeriods?.includes(camp.period)) {
    decisionTrace.push({
      code: "period_available",
      constraintKeys: ["availablePeriods"],
      factIds: [`${camp.id}.startDate`, `${camp.id}.endDate`],
    });
  } else if (constraints.excludedPeriods?.length) {
    decisionTrace.push({
      code: "period_not_excluded",
      constraintKeys: ["excludedPeriods"],
      factIds: [`${camp.id}.startDate`, `${camp.id}.endDate`],
    });
  }

  if (camp.campus === "bj" || camp.campus === "sh") {
    decisionTrace.push({
      code:
        constraints.region === "guangzhou"
          ? `travel_campus_${camp.campus}`
          : `region_match_${camp.campus}`,
      constraintKeys: collectedStudentConstraintKeys(constraints, [
        "region",
        "preferredOfflineCampus",
        "modePreference",
        "canTravel",
      ]),
      factIds: [
        `${camp.id}.campus`,
        `${camp.id}.deliveryMode`,
        `${camp.id}.addressOrPlatform`,
      ],
    });
  }

  if (camp.campus === "online") {
    decisionTrace.push({
      code: constraints.needsReplay
        ? "online_for_replay"
        : "online_for_travel_or_preference",
      constraintKeys: collectedStudentConstraintKeys(constraints, [
        "needsReplay",
        "canTravel",
        "modePreference",
      ]),
      factIds: [
        `${camp.id}.deliveryMode`,
        `${camp.id}.addressOrPlatform`,
        `${camp.id}.replayDays`,
      ],
    });
  }

  if (constraints.learningGoal) {
    decisionTrace.push({
      code: "learning_goal_supported",
      constraintKeys: ["learningGoal"],
      factIds: [`${camp.id}.dailyOutline`],
    });
  }

  if (constraints.needsReplay === false) {
    decisionTrace.push({
      code: "replay_not_required",
      constraintKeys: ["needsReplay"],
      factIds: [`${camp.id}.deliveryMode`, `${camp.id}.replayDays`],
    });
  }

  return {
    item: camp,
    decisionTrace,
    factIds: [...new Set(decisionTrace.flatMap((trace) => trace.factIds))],
  };
}

export function recommendStudentCamps(
  constraints: StudentConstraints,
): RecommendationResult<Camp> {
  const effectiveConstraintCount = countStudentConstraints(constraints);
  const missingConstraintKeys = missingStudentConstraints(constraints);

  if (effectiveConstraintCount < 2) {
    const shouldExit =
      constraints.refusesMoreQuestions === true ||
      (constraints.stalledTurns ?? 0) >= 2;

    return shouldExit
      ? {
          status: "insufficient_information",
          missingConstraintKeys,
          effectiveConstraintCount,
          canExit: true,
        }
      : {
          status: "needs_more_information",
          missingConstraintKeys,
          effectiveConstraintCount,
          canExit: false,
        };
  }

  if (
    constraints.region === "guangzhou" &&
    constraints.modePreference === "offline" &&
    constraints.canTravel === undefined
  ) {
    const factIds = CAMPS.map((camp) => `${camp.id}.campus`);
    return {
      status: "boundary_follow_up",
      boundaryCode: "student_guangzhou_offline_not_provided",
      factIds,
      decisionTrace: [
        {
          code: "student_guangzhou_offline_not_provided",
          constraintKeys: ["region", "modePreference"],
          factIds,
        },
      ],
      nextQuestionKeys: ["canTravel"],
      nextQuestionOptions: ["可以前往北京", "可以前往上海", "均不便出行"],
      effectiveConstraintCount,
    };
  }

  const campus = chooseCampus(constraints);

  if (!campus) {
    return {
      status: "needs_more_information",
      missingConstraintKeys,
      effectiveConstraintCount,
      canExit: false,
    };
  }

  const availablePeriods: Array<Camp["period"]> = constraints.availablePeriods?.length
    ? constraints.availablePeriods
    : ([1, 2, 3] as Array<Camp["period"]>).filter(
        (period) => !constraints.excludedPeriods?.includes(period),
      );
  const candidates = CAMPS.filter(
    (camp) => camp.campus === campus && availablePeriods.includes(camp.period),
  ).slice(0, 2);

  if (!candidates.length) {
    return {
      status: "no_match",
      boundaryCode: "student_date_conflict",
      factIds: CAMPS.map((camp) => `${camp.id}.startDate`),
      decisionTrace: [
        {
          code: "student_date_conflict",
          constraintKeys: collectedStudentConstraintKeys(constraints, [
            "availablePeriods",
            "excludedPeriods",
          ]),
          factIds: CAMPS.map((camp) => `${camp.id}.startDate`),
        },
      ],
      effectiveConstraintCount,
    };
  }

  return {
    status: "recommended",
    recommendations: candidates.map((camp) =>
      toStudentRecommendation(camp, constraints),
    ),
    effectiveConstraintCount,
  };
}
