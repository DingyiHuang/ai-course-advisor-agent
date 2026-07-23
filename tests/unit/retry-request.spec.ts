import { describe, expect, it } from "vitest";
import { createInitialConversationState } from "@/lib/conversation/session";
import {
  consumeRetryRequest,
  createRetryRequestSnapshot,
  identifyChatRequest,
  requestFromRetrySnapshot,
} from "@/lib/conversation/retryRequest";

describe("TASK-05 per-error retry snapshots", () => {
  it("binds each error to its own request and forces retries out of test mode", () => {
    const firstState = createInitialConversationState();
    firstState.domain = "student";
    const secondState = createInitialConversationState();
    secondState.domain = "teacher";

    const first = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "第一个请求",
        state: firstState,
        testMode: true,
        clientRequestId: "request-1",
      },
      errorMessageId: "error-1",
    });
    const second = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "第二个请求",
        state: secondState,
        testMode: true,
        clientRequestId: "request-2",
      },
      errorMessageId: "error-2",
    });

    expect(first.errorMessageId).toBe("error-1");
    expect(second.errorMessageId).toBe("error-2");
    expect(first.originalState).not.toBe(firstState);
    expect(second.originalState).not.toBe(secondState);
    expect(requestFromRetrySnapshot(first)).toMatchObject({
      message: "第一个请求",
      action: "message",
      state: { domain: "student" },
      testMode: false,
      clientRequestId: "request-1",
      retryOf: "request-1",
    });
    expect(requestFromRetrySnapshot(second)).toMatchObject({
      message: "第二个请求",
      action: "message",
      state: { domain: "teacher" },
      testMode: false,
      clientRequestId: "request-2",
      retryOf: "request-2",
    });
  });

  it("clears the simulated failure bit without mutating the original snapshot", () => {
    const armedState = createInitialConversationState();
    armedState.test.failNextModelCall = true;
    const snapshot = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "保留原请求",
        state: armedState,
        testMode: true,
        clientRequestId: "request-consumed",
      },
      errorMessageId: "error-consumed",
    });

    const retry = requestFromRetrySnapshot(snapshot);
    expect(retry.state.test.failNextModelCall).toBe(false);
    expect(retry.testMode).toBe(false);
    retry.state.domain = "teacher";
    expect(snapshot.originalState.domain).toBe("unknown");
    expect(snapshot.originalState.test.failNextModelCall).toBe(true);
  });

  it("keeps an existing logical request id and creates one only for a new request", () => {
    const state = createInitialConversationState();
    const existing = identifyChatRequest({
      action: "message",
      message: "已有编号",
      state,
      clientRequestId: "stable-request",
    });
    const created = identifyChatRequest(
      { action: "message", message: "新请求", state },
      () => "generated-request",
    );

    expect(existing.clientRequestId).toBe("stable-request");
    expect(created.clientRequestId).toBe("generated-request");
  });

  it("consumes each error message at most once without affecting another error", () => {
    const state = createInitialConversationState();
    const firstSnapshot = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "只允许这个错误卡触发一次",
        state,
        testMode: true,
        clientRequestId: "request-once",
      },
      errorMessageId: "error-once",
    });
    const secondSnapshot = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "另一个错误仍可重试",
        state,
        testMode: true,
        clientRequestId: "request-second",
      },
      errorMessageId: "error-second",
    });
    const initiallyConsumed = new Set<string>();

    const firstConsumption = consumeRetryRequest(
      firstSnapshot,
      initiallyConsumed,
    );
    const duplicateConsumption = consumeRetryRequest(
      firstSnapshot,
      firstConsumption.consumedErrorMessageIds,
    );
    const secondConsumption = consumeRetryRequest(
      secondSnapshot,
      duplicateConsumption.consumedErrorMessageIds,
    );

    expect(initiallyConsumed.size).toBe(0);
    expect(firstConsumption.request).toMatchObject({
      clientRequestId: "request-once",
      retryOf: "request-once",
      message: "只允许这个错误卡触发一次",
      testMode: false,
    });
    expect(duplicateConsumption.request).toBeUndefined();
    expect(duplicateConsumption.consumedErrorMessageIds).toEqual(
      new Set(["error-once"]),
    );
    expect(secondConsumption.request).toMatchObject({
      clientRequestId: "request-second",
      retryOf: "request-second",
      message: "另一个错误仍可重试",
      testMode: false,
    });
    expect(secondConsumption.consumedErrorMessageIds).toEqual(
      new Set(["error-once", "error-second"]),
    );
  });
});
