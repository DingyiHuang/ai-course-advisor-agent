import type {
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
import { createInitialConversationState, appendHistory, collectedConstraintKeys, sanitizeConversationState } from "./session";
import { buildComposerPlan } from "./plan";
import type { ClassifierCandidate } from "@/lib/llm/classifier";
import { applyClassifierCandidate } from "@/lib/llm/classifier";
import type { ComposerOutput as LlmComposerOutput } from "@/lib/domain/conversation";
import { withOneModelRetry } from "@/lib/llm/retry";
import { isRetryableModelError } from "@/lib/llm/retry";
import {
  assertComposerDidNotWriteSources,
  assertDecisionTraceConstraints,
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
  action?: "message" | "reset" | "menu" | "inject_next_failure";
  testMode?: boolean;
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

function validateComposerOutput(input: {
  output: LlmComposerOutput;
  plan: ComposerPlan;
  userMessage: string;
}): { output: LlmComposerOutput; usedFactIds: string[] } {
  assertComposerDidNotWriteSources(input.output.message);
  const usedFactIds = validateUsedFactIds(
    input.output.usedFactIds,
    input.plan.facts,
  );
  if (input.plan.facts.length && usedFactIds.length === 0) {
    throw new GroundingError("Composer omitted all source-backed facts");
  }
  assertTraceFactsUsed(input.plan, usedFactIds);
  assertHighRiskValuesGrounded({
    message: input.output.message,
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
  const allowedActions = new Set(input.plan.actions);
  if (input.output.actions.some((action) => !allowedActions.has(action))) {
    throw new GroundingError("Composer introduced an unsupported action");
  }
  return { output: input.output, usedFactIds };
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
    const candidate = await dependencies.classifier.classify(
      message,
      originalState,
    );
    const applied = applyClassifierCandidate({
      message,
      state: originalState,
      candidate,
    });
    if (applied.crossDomainFrom) {
      applied.state.selectedEntityId = undefined;
      applied.state.lastRecommendationIds = [];
      applied.state.pendingQuestionKeys = [];
      applied.state.pendingQuestionOptions = [];
    }
    if (applied.intent === "reset" || applied.intent === "menu") {
      const state = createInitialConversationState();
      return operationalResponse({
        status: applied.intent,
        message:
          applied.intent === "reset"
            ? "已清空本次对话，请重新选择身份。"
            : "已返回主菜单，请选择学生或家长、教师、机构或企业人员。",
        state,
      });
    }
    const unansweredPendingQuestion =
      originalState.pendingQuestionKeys.length > 0 &&
      applied.acceptedConstraintKeys.length === 0 &&
      (applied.intent === "recommendation" || applied.intent === "unknown");
    if (unansweredPendingQuestion) {
      incrementStalledTurns(applied.state, false);
    } else if (applied.acceptedConstraintKeys.length > 0) {
      incrementStalledTurns(applied.state, true);
    }

    const workingState = appendHistory(applied.state, {
      role: "user",
      content: message,
    });
    const plan = buildComposerPlan({
      state: workingState,
      intent: applied.intent,
      factTopics: applied.factTopics,
      currentDate: dependencies.currentDate,
      crossDomainFrom: applied.crossDomainFrom,
    });
    assertDecisionTraceConstraints(
      plan.decisionTrace,
      collectedConstraintKeys(workingState),
    );

    const generated = await withOneModelRetry(async () => {
      const output = await dependencies.composer.composeOnce(
        plan,
        workingState.shortHistory,
      );
      return validateComposerOutput({ output, plan, userMessage: message });
    });

    const sources = collectSources(generated.usedFactIds);
    const prefixes = [plan.crossDomainNotice, plan.requiredPrefix].filter(
      (item): item is string => Boolean(item),
    );
    const body = [...prefixes, generated.output.message].join("\n");
    const finalMessage = `${body}${formatSourceFootnotes(generated.usedFactIds)}`;
    let state = prepareStateForPlan(workingState, plan);
    state = appendHistory(state, { role: "assistant", content: body });

    return {
      status: plan.status,
      message: finalMessage,
      state,
      sources,
      entityIds: plan.entityIds,
      actions: generated.output.actions,
    };
  } catch (error) {
    return safeModelFailure(originalState, error);
  }
}
