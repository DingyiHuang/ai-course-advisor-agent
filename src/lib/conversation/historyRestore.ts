import type {
  ChatPresentation,
  ConversationState,
} from "@/lib/domain/conversation";
import type { ChatMessage } from "@/lib/history/types";
import { sanitizeConversationState } from "./session";
import type { IdentifiedClientUiMessage } from "./clientChatState";

const EMPTY_PRESENTATION: ChatPresentation = { recommendations: [] };

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function presentation(value: unknown): ChatPresentation {
  const candidate = record(value);
  return candidate && Array.isArray(candidate.recommendations)
    ? (candidate as ChatPresentation)
    : EMPTY_PRESENTATION;
}

export type RestoredConversation = {
  messages: IdentifiedClientUiMessage[];
  state: ConversationState;
};

export function restoreConversation(
  storedMessages: ChatMessage[],
): RestoredConversation {
  let latestState: unknown;
  const messages = storedMessages.map((message) => {
    const metadata = record(message.metadata) ?? {};
    if (metadata.state !== undefined) latestState = metadata.state;

    return {
      id: message.id,
      clientRequestId:
        typeof metadata.clientRequestId === "string"
          ? metadata.clientRequestId
          : message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      ...(typeof metadata.status === "string"
        ? { status: metadata.status }
        : {}),
      sources: message.sources,
      presentation: presentation(metadata.presentation),
      actions: stringArray(metadata.actions),
      options: stringArray(metadata.options),
      ...(metadata.answerMode === "ai_grounded" ||
      metadata.answerMode === "system_grounded"
        ? { answerMode: metadata.answerMode }
        : {}),
    } satisfies IdentifiedClientUiMessage;
  });

  return {
    messages,
    state: sanitizeConversationState(latestState),
  };
}
