import "server-only";

import type { ConversationStore } from "./conversationStore";
import { ConversationStoreError } from "./conversationStore";
import type {
  AppendMessageInput,
  ChatMessage,
  ChatSession,
  CreateSessionInput,
} from "./types";

export type BlobConversationStoreOptions = {
  token?: string;
};

const BLOB_PATH_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isCanonicalIsoTimestamp(value: string): boolean {
  const parsedTimestamp = Date.parse(value);

  return (
    Number.isFinite(parsedTimestamp) &&
    new Date(parsedTimestamp).toISOString() === value
  );
}

export function blobMessageObjectName(input: {
  sessionId: string;
  timestamp: string;
  messageId: string;
}): string {
  if (
    !BLOB_PATH_IDENTIFIER_PATTERN.test(input.sessionId) ||
    !BLOB_PATH_IDENTIFIER_PATTERN.test(input.messageId) ||
    !isCanonicalIsoTimestamp(input.timestamp)
  ) {
    throw new ConversationStoreError("invalid_input");
  }

  return `sessions/${input.sessionId}/messages/${input.timestamp}-${input.messageId}.json`;
}

export class BlobConversationStore implements ConversationStore {
  constructor(options: BlobConversationStoreOptions = {}) {
    void options;
  }

  async createSession(input: CreateSessionInput): Promise<ChatSession> {
    void input;
    throw new ConversationStoreError("unsupported_operation");
  }

  async appendMessage(input: AppendMessageInput): Promise<ChatMessage> {
    void input;
    throw new ConversationStoreError("unsupported_operation");
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    void sessionId;
    throw new ConversationStoreError("unsupported_operation");
  }
}
