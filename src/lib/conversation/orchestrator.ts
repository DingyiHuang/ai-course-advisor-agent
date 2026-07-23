import type {
  ChatNotice,
  ChatResponse,
  ComposerOutput,
  ComposerPlan,
  ConversationState,
} from "@/lib/domain/conversation";
import type { BusinessDate } from "@/lib/time/shanghai";
import {
  collectSources,
  formatSourceFootnotes,
} from "@/lib/citations";
import {
  appendHistory,
  collectedConstraintKeys,
  createInitialConversationState,
  sanitizeConversationState,
  transitionConversationDomain,
} from "./session";
import { buildCatalogPlan, buildComposerPlan } from "./plan";
import { buildChatPresentation } from "./presentation";
import { resolveDeterministicTurnRouting } from "./routing";
import type { ClassifierCandidate } from "@/lib/llm/classifier";
import { applyClassifierCandidate } from "@/lib/llm/classifier";
import type { ComposerOutput as LlmComposerOutput } from "@/lib/domain/conversation";
import { withOneModelRetry } from "@/lib/llm/retry";
import { isRetryableModelError } from "@/lib/llm/retry";
import {
  assertComposerDidNotWriteSources,
  assertComposerMentionedOnlyPlannedPeriods,
  assertDecisionTraceConstraints,
  assertFollowUpUsesClosedDimensions,
  assertHighRiskValuesGrounded,
  GroundingError,
  validateUsedFactIds,
} from "@/lib/validation/grounding";
import {
  InputValidationError,
  validateUserMessage,
} from "@/lib/validation/input";

export type ConversationDependencies = {
  currentDate: BusinessDate;
  classifier: {
    classify(message: string, state: ConversationState): Promise<ClassifierCandidate>;
  };
  composer: {
    composeOnce(
      plan: ComposerPlan,
      history: ConversationState["shortHistory"],
    ): Promise<ComposerOutput>;
  };
};

export type ConversationRequest = {
  message?: unknown;
  state?: unknown;
  action?:
    | "message"
    | "reset"
    | "menu"
    | "catalog"
    | "select_domain"
    | "select_entity"
    | "inject_next_failure";
  domain?: "student" | "teacher" | "platform";
  entityId?: unknown;
  testMode?: boolean;
};

const EMPTY_PRESENTATION: ChatResponse["presentation"] = {
  recommendations: [],
};

function operationalResponse(input: {
  status: ChatResponse["status"];
  message: string;
  state: ConversationState;
}): ChatResponse {
  return {
    status: input.status,
    message: input.message,
    state: input.state,
    sources: [],
    entityIds: [],
    actions: [],
    presentation: EMPTY_PRESENTATION,
    notices: [],
  };
}

function errorResponse(input: {
  state: ConversationState;
  code: NonNullable<ChatResponse["error"]>["code"];
  retryable: boolean;
  message: string;
}): ChatResponse {
  return {
    status: "error",
    message: input.message,
    state: input.state,
    sources: [],
    entityIds: [],
    actions: input.retryable ? ["重试"] : [],
    presentation: EMPTY_PRESENTATION,
    notices: [],
    error: { code: input.code, retryable: input.retryable },
  };
}

function incrementStalledTurns(
  state: ConversationState,
  madeProgress: boolean,
): void {
  if (state.domain === "student") {
    state.studentConstraints.stalledTurns = madeProgress
      ? 0
      : Math.min((state.studentConstraints.stalledTurns ?? 0) + 1, 3);
  }
  if (state.domain === "teacher") {
    state.teacherConstraints.stalledTurns = madeProgress
      ? 0
      : Math.min((state.teacherConstraints.stalledTurns ?? 0) + 1, 3);
  }
}

function prepareStateForPlan(
  state: ConversationState,
  plan: ComposerPlan,
): ConversationState {
  const next = structuredClone(state);
  next.pendingQuestionKeys = [...plan.nextQuestionKeys];
  next.pendingQuestionOptions = [...plan.nextQuestionOptions];
  if (plan.status === "recommended") {
    next.lastRecommendationIds = [...plan.entityIds];
    next.selectedEntityId =
      plan.entityIds.length === 1 ? plan.entityIds[0] : undefined;
  } else if (plan.entityIds.length === 1 && !next.selectedEntityId) {
    next.selectedEntityId = plan.entityIds[0];
  }
  return next;
}

function assertTraceFactsUsed(plan: ComposerPlan, usedFactIds: string[]): void {
  const used = new Set(usedFactIds);
  for (const trace of plan.decisionTrace) {
    if (trace.factIds.length && !trace.factIds.some((id) => used.has(id))) {
      throw new GroundingError(
        `Composer omitted facts for decision trace: ${trace.code}`,
      );
    }
  }
}

function expectedRecommendationReasonKeys(
  plan: ComposerPlan,
  entityId: string,
): string[] {
  return [
    ...new Set(
      plan.decisionTrace
        .filter((trace) =>
          trace.factIds.some((factId) => factId.startsWith(`${entityId}.`)),
        )
        .flatMap((trace) => trace.constraintKeys),
    ),
  ];
}

function assertRecommendationReasons(
  plan: ComposerPlan,
  output: LlmComposerOutput,
): void {
  if (plan.status !== "recommended") {
    if (output.recommendationReasons.length) {
      throw new GroundingError(
        "Composer introduced recommendation reasons outside recommendation route",
      );
    }
    return;
  }

  const groups = new Map(
    output.recommendationReasons.map((group) => [group.entityId, group]),
  );
  if (
    groups.size !== output.recommendationReasons.length ||
    groups.size !== plan.entityIds.length
  ) {
    throw new GroundingError("Composer recommendation reason groups are incomplete");
  }

  for (const entityId of plan.entityIds) {
    const group = groups.get(entityId);
    const expected = expectedRecommendationReasonKeys(plan, entityId);
    const actual = group?.reasons.map(({ constraintKey }) => constraintKey) ?? [];
    if (
      actual.length !== new Set(actual).size ||
      actual.length !== expected.length ||
      expected.some((key) => !actual.includes(key))
    ) {
      throw new GroundingError(
        `Composer recommendation reasons do not match constraints: ${entityId}`,
      );
    }
  }
}

function validateComposerOutput(input: {
  output: LlmComposerOutput;
  plan: ComposerPlan;
  userMessage: string;
}): { output: LlmComposerOutput; usedFactIds: string[] } {
  assertComposerDidNotWriteSources(input.output.message);
  for (const group of input.output.recommendationReasons) {
    for (const item of group.reasons) {
      assertComposerDidNotWriteSources(item.reason);
    }
  }
  assertRecommendationReasons(input.plan, input.output);
  assertComposerMentionedOnlyPlannedPeriods(
    [
      input.output.message,
      ...input.output.recommendationReasons.flatMap((group) =>
        group.reasons.map(({ reason }) => reason),
      ),
    ].join("\n"),
    input.plan.entityIds,
  );
  const usedFactIds = validateUsedFactIds(
    input.output.usedFactIds,
    input.plan.facts,
  );
  if (input.plan.facts.length && usedFactIds.length === 0) {
    throw new GroundingError("Composer omitted all source-backed facts");
  }
  assertTraceFactsUsed(input.plan, usedFactIds);
  assertHighRiskValuesGrounded({
    message: [
      input.output.message,
      ...input.output.recommendationReasons.flatMap((group) =>
        group.reasons.map(({ reason }) => reason),
      ),
    ].join("\n"),
    userMessage: input.userMessage,
    facts: input.plan.facts,
    calculations: input.plan.calculations,
  });
  if (
    input.plan.nextQuestionKeys.length &&
    !/[?？]/u.test(input.output.message)
  ) {
    throw new GroundingError("Composer omitted the required follow-up question");
  }
  assertFollowUpUsesClosedDimensions(
    input.output.message,
    input.plan.nextQuestionKeys,
  );
  const allowedActions = new Set(input.plan.actions);
  if (input.output.actions.some((action) => !allowedActions.has(action))) {
    throw new GroundingError("Composer introduced an unsupported action");
  }
  return { output: input.output, usedFactIds };
}

async function completeComposerPlan(input: {
  workingState: ConversationState;
  plan: ComposerPlan;
  userMessage: string;
  dependencies: ConversationDependencies;
}): Promise<ChatResponse> {
  assertDecisionTraceConstraints(
    input.plan.decisionTrace,
    collectedConstraintKeys(input.workingState),
  );
  const generated = await withOneModelRetry(async () => {
    const output = await input.dependencies.composer.composeOnce(
      input.plan,
      input.workingState.shortHistory,
    );
    return validateComposerOutput({
      output,
      plan: input.plan,
      userMessage: input.userMessage,
    });
  });

  const sources = collectSources(generated.usedFactIds);
  const prefixes = [input.plan.requiredPrefix].filter(
    (item): item is string => Boolean(item),
  );
  const body = [...prefixes, generated.output.message].join("\n");
  const finalMessage = `${body}${formatSourceFootnotes(generated.usedFactIds)}`;
  let state = prepareStateForPlan(input.workingState, input.plan);
  state = appendHistory(state, { role: "assistant", content: body });

  return {
    status: input.plan.status,
    message: finalMessage,
    state,
    sources,
    entityIds: input.plan.entityIds,
    actions: generated.output.actions,
    presentation: buildChatPresentation({
      plan: input.plan,
      state,
      output: generated.output,
      sources,
    }),
    notices: [],
    boundaryCode: input.plan.boundaryCode,
  };
}

function identitySwitchNotice(
  fromDomain: Exclude<ConversationState["domain"], "unknown">,
  toDomain: Exclude<ConversationState["domain"], "unknown">,
): ChatNotice {
  const labels = {
    student: "学生/家长",
    teacher: "教师",
    platform: "机构/学校",
  } as const;
  return {
    code: "identity_switched",
    message: `已切换为${labels[toDomain]}咨询。`,
    fromDomain,
    toDomain,
  };
}

function safeModelFailure(
  originalState: ConversationState,
  error: unknown,
): ChatResponse {
  if (error instanceof GroundingError) {
    return errorResponse({
      state: originalState,
      code: "grounding_rejected",
      retryable: true,
      message: "当前资料核对未通过，请重试。原有对话已保留。",
    });
  }
  const retryable = isRetryableModelError(error);
  return errorResponse({
    state: originalState,
    code: "model_unavailable",
    retryable,
    message: retryable
      ? "模型服务暂时不可用，请稍后重试。原有对话已保留。"
      : "模型服务尚未完成配置。原有对话已保留。",
  });
}

export async function runConversationTurn(
  request: ConversationRequest,
  dependencies: ConversationDependencies,
): Promise<ChatResponse> {
  const originalState = sanitizeConversationState(request.state);
  const action = request.action ?? "message";

  if (action === "reset" || action === "menu") {
    const state = createInitialConversationState();
    return operationalResponse({
      status: action,
      message:
        action === "reset"
          ? "已清空本次对话，请重新选择身份。"
          : "已返回主菜单，请选择学生或家长、教师、机构或企业人员。",
      state,
    });
  }

  if (action === "select_domain") {
    if (
      request.domain !== "student" &&
      request.domain !== "teacher" &&
      request.domain !== "platform"
    ) {
      return errorResponse({
        state: originalState,
        code: "invalid_input",
        retryable: false,
        message: "请选择有效身份。",
      });
    }
    if (originalState.domain === request.domain) {
      return operationalResponse({
        status: "identity_selected",
        message: "当前身份无需重复选择，可以继续咨询现有班型或服务。",
        state: originalState,
      });
    }
    const state = transitionConversationDomain(originalState, request.domain);
    const plan = buildComposerPlan({
      state,
      intent:
        request.domain === "platform"
          ? "institution_service"
          : "recommendation",
      factTopics: [],
      currentDate: dependencies.currentDate,
    });
    if (
      plan.status === "recommended" ||
      plan.status === "boundary_follow_up" ||
      plan.status === "institution_info"
    ) {
      const lastUserMessage = [...state.shortHistory]
        .reverse()
        .find(({ role }) => role === "user")?.content ?? "";
      try {
        return await completeComposerPlan({
          workingState: state,
          plan,
          userMessage: lastUserMessage,
          dependencies,
        });
      } catch (error) {
        return safeModelFailure(originalState, error);
      }
    }
    return operationalResponse({
      status: "identity_selected",
      message:
        request.domain === "student"
          ? "当前身份已设置为学生或家长，请描述所在城市、可参加时间和授课形式偏好。"
          : request.domain === "teacher"
            ? "当前身份已设置为教师，请描述当前基础、培训目标和时间安排。"
            : "当前身份已设置为机构或学校，请选择企业培训、学校采购、项目交付或会员权益。",
      state,
    });
  }

  if (action === "select_entity") {
    if (
      typeof request.entityId !== "string" ||
      !originalState.lastRecommendationIds.includes(request.entityId)
    ) {
      return errorResponse({
        state: originalState,
        code: "invalid_input",
        retryable: false,
        message: "该班型不在本次推荐结果中，请重新选择。",
      });
    }
    const state = structuredClone(originalState);
    state.selectedEntityId = request.entityId;
    state.pendingQuestionKeys = [];
    state.pendingQuestionOptions = [];
    return operationalResponse({
      status: "selection",
      message: "已将该班型设为当前咨询对象，可以继续询问时间、费用、地点或准备事项。",
      state,
    });
  }

  if (action === "inject_next_failure") {
    if (request.testMode !== true) {
      return errorResponse({
        state: originalState,
        code: "invalid_input",
        retryable: false,
        message: "测试模式未启用。",
      });
    }
    const state = structuredClone(originalState);
    state.test.failNextModelCall = true;
    return operationalResponse({
      status: "test_failure_armed",
      message: "下一次模型请求将模拟失败。",
      state,
    });
  }

  let message: string;
  try {
    message = validateUserMessage(request.message);
  } catch (error) {
    return errorResponse({
      state: originalState,
      code: "invalid_input",
      retryable: false,
      message:
        error instanceof InputValidationError
          ? error.message
          : "输入无法处理。",
    });
  }

  if (originalState.test.failNextModelCall) {
    const state = structuredClone(originalState);
    state.test.failNextModelCall = false;
    return errorResponse({
      state,
      code: "simulated_model_failure",
      retryable: true,
      message: "已模拟本次模型失败；原有对话已保留，可以重试。",
    });
  }

  try {
    if (action === "catalog") {
      const workingState = appendHistory(originalState, {
        role: "user",
        content: message,
      });
      const plan = buildCatalogPlan({ state: workingState });
      return await completeComposerPlan({
        workingState,
        plan,
        userMessage: message,
        dependencies,
      });
    }

    const deterministic = resolveDeterministicTurnRouting({
      message,
      state: originalState,
    });
    const deterministicCrossDomainFrom =
      deterministic.domain &&
      originalState.domain !== "unknown" &&
      originalState.domain !== deterministic.domain
        ? originalState.domain
        : undefined;
    const routingState = deterministic.domain
      ? transitionConversationDomain(originalState, deterministic.domain)
      : originalState;
    const candidate = await dependencies.classifier.classify(
      message,
      routingState,
    );
    if (deterministic.domain || deterministic.factTopics.length > 0) {
      candidate.domainCandidate = undefined;
    }
    const applied = applyClassifierCandidate({
      message,
      state: routingState,
      candidate,
    });
    const crossDomainFrom =
      deterministicCrossDomainFrom ?? applied.crossDomainFrom;
    if (deterministic.institutionNeed && applied.state.domain === "platform") {
      applied.state.institutionNeed = deterministic.institutionNeed;
    }
    Object.assign(
      applied.state.studentConstraints,
      deterministic.studentConstraints,
    );
    Object.assign(
      applied.state.teacherConstraints,
      deterministic.teacherConstraints,
    );
    const acceptedConstraintKeys = [
      ...new Set([
        ...applied.acceptedConstraintKeys,
        ...Object.keys(deterministic.studentConstraints),
        ...Object.keys(deterministic.teacherConstraints),
        ...(deterministic.institutionNeed ? ["institutionNeed"] : []),
      ]),
    ];
    const intent = deterministic.intent ?? applied.intent;
    const factTopics = [
      ...new Set([...deterministic.factTopics, ...applied.factTopics]),
    ];
    if (intent === "reset" || intent === "menu") {
      const state = createInitialConversationState();
      return operationalResponse({
        status: intent,
        message:
          intent === "reset"
            ? "已清空本次对话，请重新选择身份。"
            : "已返回主菜单，请选择学生或家长、教师、机构或企业人员。",
        state,
      });
    }
    const unansweredPendingQuestion =
      originalState.pendingQuestionKeys.length > 0 &&
      acceptedConstraintKeys.length === 0 &&
      (intent === "recommendation" || intent === "unknown");
    if (unansweredPendingQuestion) {
      incrementStalledTurns(applied.state, false);
    } else if (acceptedConstraintKeys.length > 0) {
      incrementStalledTurns(applied.state, true);
    }

    const workingState = appendHistory(applied.state, {
      role: "user",
      content: message,
    });
    const plan = buildComposerPlan({
      state: workingState,
      intent,
      factTopics,
      currentDate: dependencies.currentDate,
      crossDomainFrom,
    });
    const response = await completeComposerPlan({
      workingState,
      plan,
      userMessage: message,
      dependencies,
    });
    if (crossDomainFrom && workingState.domain !== "unknown") {
      response.notices.push(
        identitySwitchNotice(crossDomainFrom, workingState.domain),
      );
    }
    return response;
  } catch (error) {
    return safeModelFailure(originalState, error);
  }
}
