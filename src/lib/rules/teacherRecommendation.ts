import type { TeacherProduct } from "@/lib/domain/knowledge";
import type {
  Recommendation,
  RecommendationResult,
  TeacherConstraints,
  TeacherGoal,
} from "@/lib/domain/rules";
import { TEACHER_PRODUCTS } from "@/lib/knowledge";

const GOAL_LEVEL: Record<TeacherGoal, TeacherProduct["level"]> = {
  tools: "L1",
  "web-app": "L2",
  "rag-project": "L3",
};

const STARTING_LEVEL_TARGET: Record<
  NonNullable<TeacherConstraints["startingLevel"]>,
  TeacherProduct["level"]
> = {
  beginner: "L1",
  L1: "L2",
  L2: "L3",
};

function resolveTargetLevel(constraints: TeacherConstraints): {
  level: TeacherProduct["level"] | undefined;
  constraintKeys: string[];
} {
  if (constraints.level) {
    return { level: constraints.level, constraintKeys: ["level"] };
  }
  if (constraints.goal) {
    return { level: GOAL_LEVEL[constraints.goal], constraintKeys: ["goal"] };
  }
  if (constraints.startingLevel) {
    return {
      level: STARTING_LEVEL_TARGET[constraints.startingLevel],
      constraintKeys: ["startingLevel"],
    };
  }
  return { level: undefined, constraintKeys: [] };
}

function countTeacherConstraints(constraints: TeacherConstraints): number {
  return [
    constraints.level,
    constraints.goal,
    constraints.startingLevel,
    constraints.canTakeContinuousLeave,
    constraints.availableProductIds?.length,
    constraints.city,
    constraints.prerequisiteStatus === "met" ||
    constraints.prerequisiteStatus === "not_met"
      ? constraints.prerequisiteStatus
      : undefined,
  ].filter((value) => value !== undefined && value !== 0).length;
}

function missingTeacherConstraints(
  constraints: TeacherConstraints,
): string[] {
  const missing: string[] = [];
  if (!constraints.level && !constraints.goal && !constraints.startingLevel) {
    missing.push("levelGoalOrStartingLevel");
  }
  if (constraints.canTakeContinuousLeave === undefined) {
    missing.push("canTakeContinuousLeave");
  }
  if (!constraints.availableProductIds?.length) missing.push("availableDates");
  if (!constraints.city) missing.push("city");
  const targetLevel = resolveTargetLevel(constraints).level;
  if (
    targetLevel &&
    targetLevel !== "L1" &&
    (!constraints.prerequisiteStatus ||
      constraints.prerequisiteStatus === "unknown")
  ) {
    missing.push("prerequisiteStatus");
  }
  return missing;
}

function nextActionsForLevel(level: TeacherProduct["level"]): string[] {
  if (level === "L2") return ["recommend_L1", "ability_assessment"];
  if (level === "L3") return ["recommend_L2", "submit_equivalent_project"];
  return [];
}

function toTeacherRecommendation(
  product: TeacherProduct,
  constraints: TeacherConstraints,
): Recommendation<TeacherProduct> {
  const { constraintKeys: levelConstraintKeys } =
    resolveTargetLevel(constraints);
  const decisionTrace = [
    {
      code: product.format === "intensive" ? "continuous_time" : "weekend_time",
      constraintKeys: ["canTakeContinuousLeave"],
      factIds: [`${product.id}.format`, `${product.id}.schedule`],
    },
    {
      code: `level_${product.level.toLowerCase()}`,
      constraintKeys: levelConstraintKeys,
      factIds: [
        `${product.id}.level`,
        `${product.id}.curriculumModules`,
        `${product.id}.outcome`,
      ],
    },
  ];

  if (product.prerequisite) {
    decisionTrace.push({
      code:
        constraints.prerequisiteStatus === "met"
          ? "prerequisite_met"
          : "prerequisite_review_required",
      constraintKeys: ["prerequisiteStatus"],
      factIds: [`${product.id}.prerequisite`],
    });
  }

  if (constraints.availableProductIds?.includes(product.id)) {
    decisionTrace.push({
      code: "schedule_available",
      constraintKeys: ["availableProductIds"],
      factIds: [`${product.id}.schedule`],
    });
  }

  if (constraints.city) {
    decisionTrace.push({
      code: product.cities.includes(constraints.city)
        ? "city_confirmed"
        : "city_not_specified_in_material",
      constraintKeys: ["city"],
      factIds: [`${product.id}.cities`, `${product.id}.locationsOrPlatforms`],
    });
  }

  return {
    item: product,
    decisionTrace,
    factIds: [...new Set(decisionTrace.flatMap((trace) => trace.factIds))],
  };
}

export function recommendTeacherProducts(
  constraints: TeacherConstraints,
): RecommendationResult<TeacherProduct> {
  const effectiveConstraintCount = countTeacherConstraints(constraints);
  const missingConstraintKeys = missingTeacherConstraints(constraints);

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

  const { level } = resolveTargetLevel(constraints);
  if (!level) {
    return {
      status: "needs_more_information",
      missingConstraintKeys,
      effectiveConstraintCount,
      canExit: false,
    };
  }

  const format =
    constraints.canTakeContinuousLeave === true
      ? "intensive"
      : constraints.canTakeContinuousLeave === false
        ? "weekend"
        : undefined;

  if (!format) {
    return {
      status: "needs_more_information",
      missingConstraintKeys,
      effectiveConstraintCount,
      canExit: false,
    };
  }

  let candidates = TEACHER_PRODUCTS.filter((product) => product.level === level);

  if (format) {
    candidates = candidates.filter((product) => product.format === format);
  }
  if (constraints.availableProductIds?.length) {
    candidates = candidates.filter((product) =>
      constraints.availableProductIds?.includes(product.id),
    );
  }

  const product = candidates[0];
  if (!product) {
    const factIds = TEACHER_PRODUCTS.filter(
      (candidate) => candidate.level === level,
    ).map((candidate) => `${candidate.id}.schedule`);
    return {
      status: "no_match",
      boundaryCode: "teacher_schedule_conflict",
      factIds,
      decisionTrace: [
        {
          code: "teacher_schedule_conflict",
          constraintKeys: [
            ...(constraints.availableProductIds?.length
              ? ["availableProductIds"]
              : []),
            "canTakeContinuousLeave",
          ],
          factIds,
        },
      ],
      effectiveConstraintCount,
    };
  }

  if (
    product.prerequisite &&
    constraints.prerequisiteStatus === "not_met"
  ) {
    return {
      status: "prerequisite_blocked",
      product,
      nextActions: nextActionsForLevel(product.level),
      factIds: [`${product.id}.prerequisite`],
      effectiveConstraintCount,
    };
  }

  if (
    product.prerequisite &&
    (!constraints.prerequisiteStatus ||
      constraints.prerequisiteStatus === "unknown")
  ) {
    return {
      status: "needs_more_information",
      missingConstraintKeys,
      effectiveConstraintCount,
      canExit: false,
    };
  }

  return {
    status: "recommended",
    recommendations: [toTeacherRecommendation(product, constraints)],
    effectiveConstraintCount,
  };
}
