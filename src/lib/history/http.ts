import "server-only";

import {
  ConversationStoreError,
  type ConversationStoreErrorCode,
} from "./conversationStore";

const ERROR_STATUS: Record<ConversationStoreErrorCode, number> = {
  invalid_input: 400,
  session_not_found: 404,
  configuration_error: 503,
  persistence_error: 503,
  unsupported_operation: 501,
};

export function conversationStoreErrorResponse(error: unknown): Response {
  const code =
    error instanceof ConversationStoreError
      ? error.code
      : "persistence_error";

  return Response.json({ error: code }, { status: ERROR_STATUS[code] });
}
