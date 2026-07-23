import type { ConversationState } from "@/lib/domain/conversation";

export type ChatAction =
  | "message"
  | "reset"
  | "menu"
  | "catalog"
  | "select_domain"
  | "select_entity"
  | "inject_next_failure";

export type ChatRequest = {
  message?: string;
  state: ConversationState;
  action?: ChatAction;
  domain?: "student" | "teacher" | "platform";
  entityId?: string;
  testMode?: boolean;
};

export type RetryRequestSnapshot = {
  message?: string;
  state: ConversationState;
  action?: ChatAction;
  errorMessageId: string;
  domain?: ChatRequest["domain"];
  entityId?: string;
};

export function createRetryRequestSnapshot(input: {
  request: ChatRequest;
  retryState: ConversationState;
  errorMessageId: string;
}): RetryRequestSnapshot {
  return {
    message: input.request.message,
    state: structuredClone(input.retryState),
    action: input.request.action,
    errorMessageId: input.errorMessageId,
    domain: input.request.domain,
    entityId: input.request.entityId,
  };
}

export function requestFromRetrySnapshot(
  snapshot: RetryRequestSnapshot,
): ChatRequest {
  return {
    message: snapshot.message,
    state: structuredClone(snapshot.state),
    action: snapshot.action,
    domain: snapshot.domain,
    entityId: snapshot.entityId,
    testMode: false,
  };
}

export type RetryRequestConsumption = {
  consumedErrorMessageIds: Set<string>;
  request?: ChatRequest;
};

export function consumeRetryRequest(
  snapshot: RetryRequestSnapshot,
  consumedErrorMessageIds: ReadonlySet<string>,
): RetryRequestConsumption {
  const nextConsumedErrorMessageIds = new Set(consumedErrorMessageIds);
  if (nextConsumedErrorMessageIds.has(snapshot.errorMessageId)) {
    return { consumedErrorMessageIds: nextConsumedErrorMessageIds };
  }

  nextConsumedErrorMessageIds.add(snapshot.errorMessageId);
  return {
    consumedErrorMessageIds: nextConsumedErrorMessageIds,
    request: requestFromRetrySnapshot(snapshot),
  };
}
