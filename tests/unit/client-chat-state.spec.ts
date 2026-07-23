import { describe, expect, it } from "vitest";
import {
  acquireRequestLease,
  areErrorControlsDisabled,
  clientChatReducer,
  createClientChatState,
  releaseRequestLease,
  type IdentifiedClientUiMessage,
} from "@/lib/conversation/clientChatState";
import {
  createRetryRequestSnapshot,
  type IdentifiedChatRequest,
} from "@/lib/conversation/retryRequest";
import { createInitialConversationState } from "@/lib/conversation/session";

const EMPTY_PRESENTATION = { recommendations: [] };

function request(
  clientRequestId: string,
  message = "我是北京家长，第一期偏好线下",
): IdentifiedChatRequest {
  return {
    action: "message",
    message,
    state: createInitialConversationState(),
    clientRequestId,
  };
}

function userMessage(clientRequestId: string): IdentifiedClientUiMessage {
  return {
    id: `${clientRequestId}-user`,
    clientRequestId,
    role: "user",
    content: "我是北京家长，第一期偏好线下",
    createdAt: "2026-07-23T01:00:00.000Z",
    sources: [],
    presentation: EMPTY_PRESENTATION,
    actions: [],
    options: [],
  };
}

function errorMessage(
  clientRequestId: string,
  errorMessageId = `${clientRequestId}-error`,
): IdentifiedClientUiMessage {
  return {
    id: errorMessageId,
    clientRequestId,
    role: "error",
    content: "暂时无法完成请求。",
    createdAt: "2026-07-23T01:00:01.000Z",
    status: "error",
    sources: [],
    presentation: EMPTY_PRESENTATION,
    actions: ["重试"],
    options: [],
    retrySnapshot: createRetryRequestSnapshot({
      request: request(clientRequestId),
      errorMessageId,
    }),
  };
}

function successMessage(clientRequestId: string): IdentifiedClientUiMessage {
  const card = {
    entityId: "camp-p1-bj",
    kind: "student" as const,
    name: "2026暑期AI素养夏令营·第1期·北京线下班",
    date: "2026-08-01 至 2026-08-07",
    delivery: "北京线下",
    standardPrice: 6980,
    actualPrice: 6980,
    discountLabel: "本次按标准价计算",
    reasons: [],
    sources: [],
    availabilityNote: "资料未提供实时余位。",
  };
  return {
    id: `${clientRequestId}-assistant`,
    clientRequestId,
    role: "assistant",
    content: "已推荐第一期北京线下班。",
    createdAt: "2026-07-23T01:00:02.000Z",
    status: "recommended",
    sources: [],
    presentation: { recommendations: [card, { ...card }] },
    actions: [],
    options: [],
  };
}

const RETRYABLE_ERROR = {
  code: "simulated_model_failure" as const,
  retryable: true,
};
const SECOND_RETRYABLE_ERROR = {
  code: "model_unavailable",
  retryable: true,
};

describe("TASK-05 client request lifecycle reducer", () => {
  it("upserts one user, one error and one final answer for the same logical request", () => {
    const clientRequestId = "request-one";
    let state = createClientChatState();
    const started = {
      type: "request_started" as const,
      userMessage: userMessage(clientRequestId),
    };

    state = clientChatReducer(state, started);
    state = clientChatReducer(state, started);
    expect(state.messages.filter(({ role }) => role === "user")).toHaveLength(1);

    state = clientChatReducer(state, {
      type: "request_failed",
      message: errorMessage(clientRequestId),
      error: RETRYABLE_ERROR,
    });
    state = clientChatReducer(state, {
      type: "request_failed",
      message: errorMessage(clientRequestId, `${clientRequestId}-error-2`),
      error: RETRYABLE_ERROR,
    });
    expect(state.messages.map(({ role }) => role)).toEqual(["user", "error"]);

    state = clientChatReducer(state, {
      type: "retry_started",
      clientRequestId,
      errorMessageId: `${clientRequestId}-error-2`,
    });
    expect(state.messages[1].retrying).toBe(true);

    const succeeded = {
      type: "request_succeeded" as const,
      clientRequestId,
      messages: [successMessage(clientRequestId)],
    };
    state = clientChatReducer(state, succeeded);
    state = clientChatReducer(state, succeeded);

    expect(state.messages.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(state.messages[1].presentation.recommendations).toHaveLength(1);
    expect(state.messages[1].presentation.recommendations[0].entityId).toBe(
      "camp-p1-bj",
    );
    expect(state.lastError).toBeUndefined();
  });

  it("replaces only the retried request and leaves another error bound to its own snapshot", () => {
    let state = createClientChatState();
    for (const clientRequestId of ["request-a", "request-b"]) {
      state = clientChatReducer(state, {
        type: "request_started",
        userMessage: userMessage(clientRequestId),
      });
      state = clientChatReducer(state, {
        type: "request_failed",
        message: errorMessage(clientRequestId),
        error:
          clientRequestId === "request-a"
            ? RETRYABLE_ERROR
            : SECOND_RETRYABLE_ERROR,
      });
    }

    state = clientChatReducer(state, {
      type: "request_succeeded",
      clientRequestId: "request-a",
      messages: [successMessage("request-a")],
    });

    expect(
      state.messages.filter(
        ({ role, clientRequestId }) =>
          role === "assistant" && clientRequestId === "request-a",
      ),
    ).toHaveLength(1);
    const secondError = state.messages.find(
      ({ role, clientRequestId }) =>
        role === "error" && clientRequestId === "request-b",
    );
    expect(secondError?.retrySnapshot?.clientRequestId).toBe("request-b");
    expect(state.lastError).toEqual(SECOND_RETRYABLE_ERROR);
  });

  it("clears visible failures and every retry marker when returning to the menu", () => {
    let state = createClientChatState();
    state = clientChatReducer(state, {
      type: "request_started",
      userMessage: userMessage("request-menu"),
    });
    state = clientChatReducer(state, {
      type: "request_failed",
      message: errorMessage("request-menu"),
      error: RETRYABLE_ERROR,
    });
    state = clientChatReducer(state, {
      type: "retry_started",
      clientRequestId: "request-menu",
      errorMessageId: "request-menu-error",
    });

    state = clientChatReducer(state, { type: "menu_completed" });

    expect(state.messages.map(({ role }) => role)).toEqual(["user"]);
    expect(state.messages.every(({ retrySnapshot }) => !retrySnapshot)).toBe(
      true,
    );
    expect(state.messages.every(({ retrying }) => !retrying)).toBe(true);
    expect(state.lastError).toBeUndefined();
  });

  it("grants only one synchronous request lease until it is released", () => {
    const first = acquireRequestLease(undefined, "request-double-click");
    const duplicate = acquireRequestLease(
      first.activeClientRequestId,
      "request-double-click",
    );

    expect(first.acquired).toBe(true);
    expect(duplicate).toEqual({
      activeClientRequestId: "request-double-click",
      acquired: false,
    });
    expect(
      releaseRequestLease(
        first.activeClientRequestId,
        "request-double-click",
      ),
    ).toBeUndefined();
  });

  it("keeps every idle error card actionable regardless of message age", () => {
    expect(areErrorControlsDisabled(false, false)).toBe(false);
    expect(areErrorControlsDisabled(false, undefined)).toBe(false);
    expect(areErrorControlsDisabled(false, true)).toBe(true);
    expect(areErrorControlsDisabled(true, false)).toBe(true);
  });

  it("keeps a historical recommendation card without copying it onto an unrelated turn", () => {
    let state = createClientChatState();
    state = clientChatReducer(state, {
      type: "request_succeeded",
      clientRequestId: "request-course",
      messages: [successMessage("request-course")],
    });
    state = clientChatReducer(state, {
      type: "request_succeeded",
      clientRequestId: "request-unrelated",
      messages: [{
        id: "request-unrelated-assistant",
        clientRequestId: "request-unrelated",
        role: "assistant",
        content: "这条信息似乎与课程或机构服务咨询无关。",
        createdAt: "2026-07-23T01:00:03.000Z",
        status: "unrelated",
        sources: [],
        presentation: EMPTY_PRESENTATION,
        actions: ["继续当前咨询", "返回菜单"],
        options: [],
      }],
    });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].presentation.recommendations).toHaveLength(1);
    expect(state.messages[1].presentation.recommendations).toEqual([]);
  });
});
