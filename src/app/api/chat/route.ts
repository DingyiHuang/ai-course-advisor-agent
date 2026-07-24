import { runConversationTurn } from "@/lib/conversation/orchestrator";
import { createClassifier } from "@/lib/llm/classifier";
import { createComposer } from "@/lib/llm/composer";
import { createRuntimeLlmClient } from "@/lib/llm/runtime";
import { shanghaiToday } from "@/lib/time/shanghai";
import type { ConversationState, TurnDiagnostics } from "@/lib/domain/conversation";

export const runtime = "nodejs";
export const maxDuration = 300;

function productionSafeRequest(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const explicitTestMode = body.testMode === true;
  const rawState =
    body.state && typeof body.state === "object" && !Array.isArray(body.state)
      ? (body.state as Record<string, unknown>)
      : undefined;
  const rawTest =
    rawState?.test &&
    typeof rawState.test === "object" &&
    !Array.isArray(rawState.test)
      ? (rawState.test as Record<string, unknown>)
      : {};
  return {
    ...body,
    testMode: explicitTestMode,
    state: rawState
      ? {
          ...rawState,
          test: {
            ...rawTest,
            failNextModelCall:
              explicitTestMode && rawTest.failNextModelCall === true,
          },
        }
      : body.state,
  };
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const bodyRecord = body as Record<string, unknown>;
  const diagnosticsAllowed =
    process.env.NODE_ENV !== "production" ||
    process.env.VERCEL_ENV === "preview";
  const diagnosticsEnabled =
    diagnosticsAllowed && bodyRecord.diagnostics === true;
  const diagnostics: TurnDiagnostics | undefined = diagnosticsEnabled
    ? {
        corrections: [],
        confirmedDomain: "unknown",
        confirmedConstraints: {},
        pendingQuestionKeys: [],
        entityIds: [],
        decisionTrace: [],
        groundingFailures: [],
        composerAttempts: 0,
        composerRetries: 0,
        externalModelCalls: 0,
        contextParsingMs: 0,
        constraintExtractionMs: 0,
        classifierMs: 0,
        ruleExecutionMs: 0,
        composerMs: 0,
        groundingMs: 0,
      }
    : undefined;
  const safeBody = process.env.NODE_ENV !== "production"
    ? bodyRecord
    : productionSafeRequest(bodyRecord);

  let runtimeClient: ReturnType<typeof createRuntimeLlmClient> | undefined;
  const getClient = () => {
    if (!runtimeClient) {
      const client = createRuntimeLlmClient();
      runtimeClient = {
        async complete(request) {
          if (diagnostics) diagnostics.externalModelCalls += 1;
          return client.complete(request);
        },
      };
    }
    return runtimeClient;
  };
  const response = await runConversationTurn(safeBody, {
    currentDate: shanghaiToday(),
    classifier: {
      classify: (message, state) =>
        createClassifier(getClient()).classify(message, state),
    },
    composer: {
      composeOnce: (plan, history) =>
        createComposer(getClient()).composeOnce(plan, history),
    },
    diagnostics,
  });
  if (diagnostics) {
    const planWasRecorded =
      diagnostics.composerAttempts > 0 ||
      diagnostics.entityIds.length > 0 ||
      diagnostics.decisionTrace.length > 0 ||
      diagnostics.pendingQuestionKeys.length > 0;
    if (!planWasRecorded) {
      diagnostics.confirmedDomain = response.state.domain;
    }
    diagnostics.confirmedConstraints =
      diagnostics.confirmedConstraints &&
      Object.keys(diagnostics.confirmedConstraints).length
        ? diagnostics.confirmedConstraints
        : confirmedConstraintsFromState(response.state);
    diagnostics.pendingQuestionKeys = [...response.state.pendingQuestionKeys];
    diagnostics.entityIds = [...response.entityIds];
    diagnostics.finalStatus = response.status;
    diagnostics.routeLatencyMs = Math.round(performance.now() - startedAt);
    for (const field of [
      "contextParsingMs",
      "constraintExtractionMs",
      "classifierMs",
      "ruleExecutionMs",
      "composerMs",
      "groundingMs",
    ] as const) {
      diagnostics[field] = Math.round(diagnostics[field]);
    }
    response.diagnostics = diagnostics;
  } else {
    delete response.diagnostics;
  }
  const status = response.error
    ? response.error.retryable
      ? 503
      : 400
    : 200;
  return Response.json(response, { status });
}

function confirmedConstraintsFromState(
  state: ConversationState,
): Record<string, unknown> {
  if (state.domain === "student") {
    return structuredClone(state.studentConstraints);
  }
  if (state.domain === "teacher") {
    return structuredClone(state.teacherConstraints);
  }
  return state.domain === "platform" && state.institutionNeed
    ? { institutionNeed: state.institutionNeed }
    : {};
}
