import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ChatResponse } from "@/lib/domain/conversation";
import { createInitialConversationState } from "@/lib/conversation/session";
import {
  persistChatResponse,
  preparePersistedTurn,
} from "@/lib/history/chatPersistence";
import {
  ConversationStoreError,
  type ConversationStore,
} from "@/lib/history/conversationStore";
import type { ChatMessage } from "@/lib/history/types";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function inMemoryStore(): { store: ConversationStore; messages: ChatMessage[] } {
  const messages: ChatMessage[] = [];
  return {
    messages,
    store: {
      async createSession() {
        throw new Error("not used");
      },
      async appendMessage(input) {
        const saved: ChatMessage = {
          id: input.id ?? crypto.randomUUID(),
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          sources: input.sources ?? [],
          metadata: input.metadata ?? {},
          createdAt: input.createdAt ?? new Date().toISOString(),
        };
        messages.push(saved);
        return saved;
      },
      async getMessages(sessionId) {
        if (sessionId !== SESSION_ID) {
          throw new ConversationStoreError("session_not_found");
        }
        return [...messages];
      },
    },
  };
}

function response(): ChatResponse {
  return {
    status: "needs_more_information",
    message: "请补充您的授课形式偏好。",
    state: createInitialConversationState(),
    sources: [],
    entityIds: [],
    actions: [],
    presentation: { recommendations: [] },
    notices: [],
  };
}

describe("chat route conversation persistence", () => {
  it("persists one user message and one assistant response idempotently", async () => {
    const { store, messages } = inMemoryStore();
    const input = {
      store,
      body: {
        sessionId: SESSION_ID,
        clientRequestId: "request-stable-1",
        message: "我想了解学生课程",
      },
    };

    const first = await preparePersistedTurn(input);
    await persistChatResponse(first, response());
    const retry = await preparePersistedTurn(input);
    await persistChatResponse(retry, response());

    expect(messages.map(({ role }) => role)).toEqual(["user", "assistant"]);
    expect(messages.map(({ content }) => content)).toEqual([
      "我想了解学生课程",
      "请补充您的授课形式偏好。",
    ]);
    expect(messages[1].metadata).toMatchObject({
      clientRequestId: "request-stable-1",
      status: "needs_more_information",
      presentation: { recommendations: [] },
    });
  });

  it("persists the selected canonical course in the server-side session state", async () => {
    const { store, messages } = inMemoryStore();
    const turn = await preparePersistedTurn({
      store,
      body: {
        sessionId: SESSION_ID,
        clientRequestId: "request-selection-1",
        action: "select_entity",
        entityId: "camp-p3-online",
      },
    });
    const selected = response();
    selected.status = "selection";
    selected.message = "已将该班型设为当前咨询对象。";
    selected.state.domain = "student";
    selected.state.selectedEntityId = "camp-p3-online";
    selected.state.lastRecommendationIds = ["camp-p3-online"];

    await persistChatResponse(turn, selected);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
    expect(messages[0].metadata).toMatchObject({
      status: "selection",
      state: {
        domain: "student",
        selectedEntityId: "camp-p3-online",
        lastRecommendationIds: ["camp-p3-online"],
      },
    });
  });

  it("does not initialize storage for legacy requests without a session id", async () => {
    const { store, messages } = inMemoryStore();
    const turn = await preparePersistedTurn({
      store,
      body: { clientRequestId: "legacy-request", message: "旧调用" },
    });

    expect(turn).toBeUndefined();
    expect(messages).toEqual([]);
  });

  it("rejects malformed browser session ids with a public-safe store error", async () => {
    const { store } = inMemoryStore();
    await expect(
      preparePersistedTurn({
        store,
        body: { sessionId: "predictable", clientRequestId: "request-1" },
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
