import type { Camp } from "@/lib/domain/knowledge";
import type {
  DecisionTraceItem,
  Recommendation,
  RecommendationResult,
  StudentConstraints,
} from "@/lib/domain/rules";
import { CAMPS } from "@/lib/knowledge";

function studentOfflineNotProvidedLocally(
  constraints: StudentConstraints,
): boolean {
  return constraints.region === "guangzhou" || constraints.region === "other";
}

function localOfflineTraceCode(constraints: StudentConstraints): string {
  return constraints.region === "guangzhou"
    ? "guangzhou_student_offline_not_provided"
    : "other_region_student_offline_not_provided";
}

function collectedStudentConstraintKeys(
  constraints: StudentConstraints,
  keys: Array<keyof StudentConstraints>,
): string[] {
  return keys.filter((key) => constraints[key] !== undefined);
}

function studentConstraintValues(
  constraints: StudentConstraints,
  keys: Array<keyof StudentConstraints>,
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      constraints[key] === undefined
        ? []
        : [[key, structuredClone(constraints[key])]],
    ),
  );
}

function countStudentConstraints(constraints: StudentConstraints): number {
  return [
    constraints.region,
    constraints.preferredOfflineCampus,
    constraints.availablePeriods?.length || constraints.excludedPeriods?.length,
    constraints.modePreference,
    constraints.canTravel,
    constraints.needsReplay,
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
  if (
    studentOfflineNotProvidedLocally(constraints) &&
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

  if (constraints.modePreference === "any") return "online";
  return undefined;
}

function toStudentRecommendation(
  camp: Camp,
  constraints: StudentConstraints,
): Recommendation<Camp> {
  const decisionTrace: DecisionTraceItem[] = [];
  const periodScopedCamps = constraints.availablePeriods?.length
    ? CAMPS.filter((item) => constraints.availablePeriods?.includes(item.period))
    : CAMPS;

  if (constraints.availablePeriods?.includes(camp.period)) {
    decisionTrace.push({
      code: "period_available",
      constraintKeys: ["availablePeriods"],
      constraintValues: studentConstraintValues(constraints, [
        "availablePeriods",
      ]),
      factIds: [`${camp.id}.startDate`, `${camp.id}.endDate`],
    });
  } else if (constraints.excludedPeriods?.length) {
    decisionTrace.push({
      code: "period_not_excluded",
      constraintKeys: ["excludedPeriods"],
      constraintValues: studentConstraintValues(constraints, [
        "excludedPeriods",
      ]),
      factIds: [`${camp.id}.startDate`, `${camp.id}.endDate`],
    });
  }

  if (camp.campus === "bj" || camp.campus === "sh") {
    const constraintKeys = collectedStudentConstraintKeys(constraints, [
      "region",
      "preferredOfflineCampus",
      "modePreference",
      "canTravel",
    ]);
    decisionTrace.push({
      code:
        studentOfflineNotProvidedLocally(constraints)
          ? `travel_campus_${camp.campus}`
          : `region_match_${camp.campus}`,
      constraintKeys,
      constraintValues: studentConstraintValues(
        constraints,
        constraintKeys as Array<keyof StudentConstraints>,
      ),
      factIds: [
        `${camp.id}.campus`,
        `${camp.id}.deliveryMode`,
        `${camp.id}.addressOrPlatform`,
      ],
    });
  }

  if (camp.campus === "online") {
    const onlineFactIds = [
      `${camp.id}.deliveryMode`,
      `${camp.id}.addressOrPlatform`,
      `${camp.id}.replayDays`,
    ];
    if (
      studentOfflineNotProvidedLocally(constraints) &&
      constraints.modePreference === "offline" &&
      constraints.canTravel === false
    ) {
      decisionTrace.push(
        {
          code: localOfflineTraceCode(constraints),
          constraintKeys: ["region"],
          constraintValues: studentConstraintValues(constraints, [
            "region",
            "regionDisplayName",
          ]),
          factIds: periodScopedCamps.flatMap((item) => [
            `${item.id}.campus`,
            `${item.id}.deliveryMode`,
          ]),
        },
        {
          code: "beijing_shanghai_travel_unavailable",
          constraintKeys: ["canTravel"],
          constraintValues: studentConstraintValues(constraints, [
            "canTravel",
          ]),
          factIds: onlineFactIds,
        },
        {
          code: "online_fallback_for_unmet_offline_preference",
          constraintKeys: ["modePreference"],
          constraintValues: studentConstraintValues(constraints, [
            "modePreference",
          ]),
          factIds: onlineFactIds,
        },
      );
    } else {
      const constraintKeys = collectedStudentConstraintKeys(constraints, [
        "needsReplay",
        "canTravel",
        "modePreference",
      ]);
      decisionTrace.push({
        code: constraints.needsReplay
          ? "online_for_replay"
          : "online_for_travel_or_preference",
        constraintKeys,
        constraintValues: studentConstraintValues(
          constraints,
          constraintKeys as Array<keyof StudentConstraints>,
        ),
        factIds: onlineFactIds,
      });
    }
  }

  if (constraints.needsReplay === false) {
    decisionTrace.push({
      code: "replay_not_required",
      constraintKeys: ["needsReplay"],
      constraintValues: studentConstraintValues(constraints, ["needsReplay"]),
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
    studentOfflineNotProvidedLocally(constraints) &&
    constraints.modePreference === "offline" &&
    constraints.canTravel === undefined
  ) {
    const periodScopedCamps = constraints.availablePeriods?.length
      ? CAMPS.filter((camp) =>
          constraints.availablePeriods?.includes(camp.period),
        )
      : CAMPS;
    const factIds = periodScopedCamps.map((camp) => `${camp.id}.campus`);
    return {
      status: "boundary_follow_up",
      boundaryCode:
        constraints.region === "guangzhou"
          ? "student_guangzhou_offline_not_provided"
          : "student_other_region_offline_not_provided",
      factIds,
      decisionTrace: [
        {
          code:
            constraints.region === "guangzhou"
              ? "student_guangzhou_offline_not_provided"
              : "student_other_region_offline_not_provided",
          constraintKeys: ["region", "modePreference"],
          constraintValues: studentConstraintValues(constraints, [
            "region",
            "regionDisplayName",
            "modePreference",
          ]),
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
  const periodCandidates = CAMPS.filter((camp) =>
    availablePeriods.includes(camp.period),
  );
  const candidates = periodCandidates
    .filter((camp) => camp.campus === campus)
    .slice(0, 2);

  if (
    constraints.availablePeriods?.length &&
    candidates.some((camp) => !constraints.availablePeriods?.includes(camp.period))
  ) {
    throw new Error("Student recommendation escaped availablePeriods");
  }

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
          constraintValues: studentConstraintValues(constraints, [
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
