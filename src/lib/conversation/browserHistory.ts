import type { ChatMessage, ChatSession } from "@/lib/history/types";
import { isConversationId } from "@/lib/history/conversationStore";
import { restoreConversation } from "./historyRestore";
import type { IdentifiedClientUiMessage } from "./clientChatState";
import type { ConversationState } from "@/lib/domain/conversation";

export const HISTORY_SESSION_KEY = "ai-course-advisor.sessionId";

export type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export type BrowserHistory = {
  sessionId: string;
  messages: IdentifiedClientUiMessage[];
  state: ConversationState;
  outcome: "restored" | "created";
};

export class BrowserHistoryClientError extends Error {
  constructor(
    readonly code: "session_not_found" | "load_failed",
  ) {
    super(code);
    this.name = "BrowserHistoryClientError";
  }
}

export function saveHistorySessionId(
  storage: BrowserStorage,
  sessionId: string,
): void {
  if (!isConversationId(sessionId)) {
    throw new BrowserHistoryClientError("load_failed");
  }
  storage.setItem(HISTORY_SESSION_KEY, sessionId);
}

export async function initializeBrowserHistory(input: {
  storage: BrowserStorage;
  loadMessages: (sessionId: string) => Promise<ChatMessage[]>;
  createSession: () => Promise<ChatSession>;
}): Promise<BrowserHistory> {
  const savedSessionId = input.storage.getItem(HISTORY_SESSION_KEY);
  if (isConversationId(savedSessionId)) {
    try {
      const storedMessages = await input.loadMessages(savedSessionId);
      return {
        sessionId: savedSessionId,
        ...restoreConversation(storedMessages),
        outcome: "restored",
      };
    } catch (error) {
      if (
        !(error instanceof BrowserHistoryClientError) ||
        error.code !== "session_not_found"
      ) {
        throw error;
      }
    }
  }

  const session = await input.createSession();
  saveHistorySessionId(input.storage, session.id);
  return {
    sessionId: session.id,
    ...restoreConversation([]),
    outcome: "created",
  };
}
