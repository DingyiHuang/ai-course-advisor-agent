import { describe, expect, it } from "vitest";
import { createInitialConversationState } from "@/lib/conversation/session";
import {
  consumeRetryRequest,
  createRetryRequestSnapshot,
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
      },
      retryState: firstState,
      errorMessageId: "error-1",
    });
    const second = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "第二个请求",
        state: secondState,
        testMode: true,
      },
      retryState: secondState,
      errorMessageId: "error-2",
    });

    expect(first.errorMessageId).toBe("error-1");
    expect(second.errorMessageId).toBe("error-2");
    expect(requestFromRetrySnapshot(first)).toMatchObject({
      message: "第一个请求",
      action: "message",
      state: { domain: "student" },
      testMode: false,
    });
    expect(requestFromRetrySnapshot(second)).toMatchObject({
      message: "第二个请求",
      action: "message",
      state: { domain: "teacher" },
      testMode: false,
    });
  });

  it("uses the consumed-failure response state without mutating the snapshot", () => {
    const armedState = createInitialConversationState();
    armedState.test.failNextModelCall = true;
    const consumedState = structuredClone(armedState);
    consumedState.test.failNextModelCall = false;
    const snapshot = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "保留原请求",
        state: armedState,
        testMode: true,
      },
      retryState: consumedState,
      errorMessageId: "error-consumed",
    });

    const retry = requestFromRetrySnapshot(snapshot);
    expect(retry.state.test.failNextModelCall).toBe(false);
    retry.state.domain = "teacher";
    expect(snapshot.state.domain).toBe("unknown");
  });

  it("consumes each error message at most once without mutating the input set", () => {
    const state = createInitialConversationState();
    const firstSnapshot = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "只允许重试一次",
        state,
        testMode: true,
      },
      retryState: state,
      errorMessageId: "error-once",
    });
    const secondSnapshot = createRetryRequestSnapshot({
      request: {
        action: "message",
        message: "另一个错误仍可重试",
        state,
        testMode: true,
      },
      retryState: state,
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
      message: "只允许重试一次",
      testMode: false,
    });
    expect(duplicateConsumption.request).toBeUndefined();
    expect(duplicateConsumption.consumedErrorMessageIds).toEqual(
      new Set(["error-once"]),
    );
    expect(secondConsumption.request).toMatchObject({
      message: "另一个错误仍可重试",
      testMode: false,
    });
    expect(secondConsumption.consumedErrorMessageIds).toEqual(
      new Set(["error-once", "error-second"]),
    );
  });
});
