import type {
  AppendMessageInput,
  ChatMessage,
  ChatSession,
  CreateSessionInput,
} from "./types";

export type ConversationStoreErrorCode =
  | "invalid_input"
  | "session_not_found"
  | "configuration_error"
  | "persistence_error"
  | "unsupported_operation";

const ERROR_MESSAGES: Record<ConversationStoreErrorCode, string> = {
  invalid_input: "Conversation store input is invalid.",
  session_not_found: "Conversation session was not found.",
  configuration_error: "Conversation store is not configured.",
  persistence_error: "Conversation store operation failed.",
  unsupported_operation: "Conversation store operation is not available.",
};

const CONVERSATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && CONVERSATION_ID_PATTERN.test(value);
}

export class ConversationStoreError extends Error {
  readonly code: ConversationStoreErrorCode;

  constructor(code: ConversationStoreErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ConversationStoreError";
    this.code = code;
  }
}

export interface ConversationStore {
  createSession(input: CreateSessionInput): Promise<ChatSession>;
  appendMessage(input: AppendMessageInput): Promise<ChatMessage>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
}
