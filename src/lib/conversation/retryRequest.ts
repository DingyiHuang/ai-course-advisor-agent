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
  sessionId?: string;
  action?: ChatAction;
  domain?: "student" | "teacher" | "platform";
  entityId?: string;
  testMode?: boolean;
  clientRequestId?: string;
  retryOf?: string;
};

export type IdentifiedChatRequest = ChatRequest & {
  clientRequestId: string;
};

export type RetryRequestSnapshot = {
  clientRequestId: string;
  message?: string;
  originalState: ConversationState;
  action?: ChatAction;
  errorMessageId: string;
  domain?: ChatRequest["domain"];
  entityId?: string;
};

export function createClientRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function identifyChatRequest(
  request: ChatRequest,
  createId: () => string = createClientRequestId,
): IdentifiedChatRequest {
  return {
    ...request,
    clientRequestId: request.clientRequestId ?? createId(),
  };
}

export function createRetryRequestSnapshot(input: {
  request: IdentifiedChatRequest;
  errorMessageId: string;
}): RetryRequestSnapshot {
  return {
    clientRequestId: input.request.clientRequestId,
    message: input.request.message,
    originalState: structuredClone(input.request.state),
    action: input.request.action,
    errorMessageId: input.errorMessageId,
    domain: input.request.domain,
    entityId: input.request.entityId,
  };
}

export function requestFromRetrySnapshot(
  snapshot: RetryRequestSnapshot,
): IdentifiedChatRequest {
  const state = structuredClone(snapshot.originalState);
  state.test.failNextModelCall = false;
  return {
    message: snapshot.message,
    state,
    action: snapshot.action,
    domain: snapshot.domain,
    entityId: snapshot.entityId,
    testMode: false,
    clientRequestId: snapshot.clientRequestId,
    retryOf: snapshot.clientRequestId,
  };
}

export type RetryRequestConsumption = {
  consumedErrorMessageIds: Set<string>;
  request?: IdentifiedChatRequest;
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
