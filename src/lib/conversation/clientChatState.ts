import type { ChatPresentation, ChatResponse } from "@/lib/domain/conversation";
import type { ExportMessage } from "@/lib/export/markdown";
import type { RetryRequestSnapshot } from "./retryRequest";

export type ClientUiMessage = ExportMessage & {
  actions: string[];
  options: string[];
  answerMode?: ChatResponse["answerMode"];
  evidence?: SafeTurnEvidence;
  clientError?: ClientVisibleError;
  retrySnapshot?: RetryRequestSnapshot;
  retrying?: boolean;
};

export type SafeTurnEvidence = {
  retrievedCount: number;
  usedCount: number;
  groundingChecked: boolean;
  regenerated: boolean;
  responseMode:
    | "normal"
    | "date_advisory_fallback"
    | "system_fee_fallback"
    | "current_fact_fallback";
};

export type IdentifiedClientUiMessage = ClientUiMessage & {
  clientRequestId: string;
};

export type ClientChatState = {
  messages: ClientUiMessage[];
  lastError?: ClientVisibleError;
};

export type ClientVisibleError = {
  code: string;
  retryable: boolean;
};

export type ClientChatAction =
  | {
      type: "request_started";
      userMessage?: IdentifiedClientUiMessage;
    }
  | {
      type: "retry_started";
      clientRequestId: string;
      errorMessageId: string;
    }
  | {
      type: "request_failed";
      message: IdentifiedClientUiMessage;
      error: ClientVisibleError;
    }
  | {
      type: "request_succeeded";
      clientRequestId: string;
      messages: IdentifiedClientUiMessage[];
    }
  | {
      type: "replace_all";
      messages: IdentifiedClientUiMessage[];
      lastError?: ClientVisibleError;
    }
  | {
      type: "menu_completed";
    };

export function createClientChatState(
  messages: ClientUiMessage[] = [],
): ClientChatState {
  return { messages };
}

export function dedupePresentation(
  presentation: ChatPresentation,
): ChatPresentation {
  const byCanonicalId = new Map(
    presentation.recommendations.map((card) => [card.entityId, card]),
  );
  return {
    ...presentation,
    recommendations: [...byCanonicalId.values()],
  };
}

function normalizeMessage<T extends ClientUiMessage>(message: T): T {
  return {
    ...message,
    presentation: dedupePresentation(message.presentation),
  };
}

function replaceRequestResponses(
  messages: ClientUiMessage[],
  clientRequestId: string,
  replacements: ClientUiMessage[],
): ClientUiMessage[] {
  const result: ClientUiMessage[] = [];
  let inserted = false;

  for (const message of messages) {
    const belongsToRequest =
      message.clientRequestId === clientRequestId && message.role !== "user";
    if (!belongsToRequest) {
      result.push(message);
      continue;
    }
    if (!inserted) {
      result.push(...replacements.map(normalizeMessage));
      inserted = true;
    }
  }

  if (!inserted) {
    result.push(...replacements.map(normalizeMessage));
  }
  return result;
}

function latestVisibleError(
  messages: ClientUiMessage[],
): ClientVisibleError | undefined {
  return [...messages]
    .reverse()
    .find(
      (message): message is ClientUiMessage & {
        clientError: ClientVisibleError;
      } => message.role === "error" && Boolean(message.clientError),
    )?.clientError;
}

export function areErrorControlsDisabled(
  loading: boolean,
  retrying: boolean | undefined,
): boolean {
  return loading || retrying === true;
}

export function clientChatReducer(
  state: ClientChatState,
  action: ClientChatAction,
): ClientChatState {
  switch (action.type) {
    case "request_started": {
      if (!action.userMessage) return state;
      const alreadyAdded = state.messages.some(
        (message) =>
          message.role === "user" &&
          message.clientRequestId === action.userMessage?.clientRequestId,
      );
      if (alreadyAdded) return state;
      return {
        ...state,
        messages: [...state.messages, normalizeMessage(action.userMessage)],
      };
    }
    case "retry_started":
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.id === action.errorMessageId &&
          message.clientRequestId === action.clientRequestId
            ? { ...message, retrying: true }
            : message,
        ),
      };
    case "request_failed":
      {
        const messages = replaceRequestResponses(
          state.messages,
          action.message.clientRequestId,
          [
            {
              ...action.message,
              clientError: action.error,
              retrying: false,
            },
          ],
        );
        return {
          messages,
          lastError: latestVisibleError(messages),
        };
      }
    case "request_succeeded":
      {
        const messages = replaceRequestResponses(
          state.messages,
          action.clientRequestId,
          action.messages.map((message) => ({
            ...message,
            clientError: undefined,
            retrySnapshot: undefined,
            retrying: false,
          })),
        );
        return {
          messages,
          lastError: latestVisibleError(messages),
        };
      }
    case "replace_all":
      {
        const messages = action.messages.map(normalizeMessage);
        return {
          messages,
          lastError: action.lastError ?? latestVisibleError(messages),
        };
      }
    case "menu_completed":
      return {
        messages: state.messages
          .filter((message) => message.role !== "error")
          .map((message) => ({
            ...message,
            retrySnapshot: undefined,
            retrying: false,
          })),
        lastError: undefined,
      };
  }
}

export type RequestLease = {
  activeClientRequestId?: string;
  acquired: boolean;
};

export function acquireRequestLease(
  activeClientRequestId: string | undefined,
  requestedClientRequestId: string,
): RequestLease {
  if (activeClientRequestId) {
    return { activeClientRequestId, acquired: false };
  }
  return {
    activeClientRequestId: requestedClientRequestId,
    acquired: true,
  };
}

export function releaseRequestLease(
  activeClientRequestId: string | undefined,
  completedClientRequestId: string,
): string | undefined {
  return activeClientRequestId === completedClientRequestId
    ? undefined
    : activeClientRequestId;
}
