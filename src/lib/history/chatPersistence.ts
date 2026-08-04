import "server-only";

import { createHash } from "node:crypto";

import type { ChatResponse } from "@/lib/domain/conversation";
import type { ShortHistoryItem } from "@/lib/domain/conversation";
import type { ConversationStore } from "./conversationStore";
import {
  ConversationStoreError,
  isConversationId,
} from "./conversationStore";
import type { ChatMessage, JsonObject } from "./types";

const SYSTEM_RESPONSE_STATUSES = new Set<ChatResponse["status"]>([
  "reset",
  "menu",
  "selection",
  "identity_selected",
  "test_failure_armed",
]);

export type PersistedTurn = {
  store: ConversationStore;
  sessionId: string;
  clientRequestId: string;
  recentHistory: ShortHistoryItem[];
};

function withoutProgrammaticSources(content: string): string {
  return content.replace(/\n\n来源：[^\n]+$/u, "").trim();
}

export function recentConversationHistory(
  messages: ChatMessage[],
  limit = 8,
): ShortHistoryItem[] {
  return messages
    .filter(
      (message): message is ChatMessage & { role: "user" | "assistant" } =>
        message.role === "user" || message.role === "assistant",
    )
    .slice(-Math.max(1, Math.min(8, limit)))
    .map(({ role, content }) => ({
      role,
      content: withoutProgrammaticSources(content).slice(0, 2_000),
    }));
}

function stableMessageId(clientRequestId: string, phase: string): string {
  const bytes = createHash("sha256")
    .update(`${clientRequestId}:${phase}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function jsonObject(value: Record<string, unknown>): JsonObject {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonObject;
  } catch {
    throw new ConversationStoreError("persistence_error");
  }
}

async function appendOnce(
  store: ConversationStore,
  existing: ChatMessage[],
  input: Parameters<ConversationStore["appendMessage"]>[0],
): Promise<void> {
  if (input.id && existing.some(({ id }) => id === input.id)) return;

  try {
    await store.appendMessage(input);
  } catch (error) {
    if (!(error instanceof ConversationStoreError)) throw error;

    const refreshed = await store.getMessages(input.sessionId);
    if (!input.id || !refreshed.some(({ id }) => id === input.id)) {
      throw error;
    }
  }
}

export async function preparePersistedTurn(input: {
  store: ConversationStore;
  body: Record<string, unknown>;
}): Promise<PersistedTurn | undefined> {
  if (input.body.sessionId === undefined) return undefined;
  if (
    !isConversationId(input.body.sessionId) ||
    typeof input.body.clientRequestId !== "string" ||
    input.body.clientRequestId.length === 0
  ) {
    throw new ConversationStoreError("invalid_input");
  }

  const existing = await input.store.getMessages(input.body.sessionId);
  const recentHistory = recentConversationHistory(existing);
  if (
    typeof input.body.message === "string" &&
    input.body.message.trim().length > 0
  ) {
    await appendOnce(input.store, existing, {
      id: stableMessageId(input.body.clientRequestId, "user"),
      sessionId: input.body.sessionId,
      role: "user",
      content: input.body.message.trim(),
      metadata: {
        clientRequestId: input.body.clientRequestId,
        kind: "ui_user",
      },
    });
  }

  return {
    store: input.store,
    sessionId: input.body.sessionId,
    clientRequestId: input.body.clientRequestId,
    recentHistory,
  };
}

export async function persistChatResponse(
  turn: PersistedTurn | undefined,
  response: ChatResponse,
): Promise<void> {
  if (!turn || response.error) return;

  const existing = await turn.store.getMessages(turn.sessionId);
  await appendOnce(turn.store, existing, {
    id: stableMessageId(turn.clientRequestId, "response"),
    sessionId: turn.sessionId,
    role: SYSTEM_RESPONSE_STATUSES.has(response.status)
      ? "system"
      : "assistant",
    content: response.message,
    sources: response.sources,
    metadata: jsonObject({
      clientRequestId: turn.clientRequestId,
      status: response.status,
      state: response.state,
      presentation: response.presentation,
      actions: response.actions,
      options: response.state.pendingQuestionOptions,
      answerMode: response.answerMode,
    }),
  });
}
