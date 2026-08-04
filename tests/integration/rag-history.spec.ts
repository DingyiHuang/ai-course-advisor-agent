import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/history/types";
import type { LlmCompletionRequest } from "@/lib/llm/types";
import { createInitialConversationState } from "@/lib/conversation/session";

vi.mock("server-only", () => ({}));

const control = vi.hoisted(() => ({
  sessions: new Map<string, ChatMessage[]>(),
  composerPayloads: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/history/createConversationStore", () => ({
  createConversationStore: () => ({
    async createSession() {
      throw new Error("not used");
    },
    async getMessages(sessionId: string) {
      const messages = control.sessions.get(sessionId);
      if (!messages) throw new Error("missing session fixture");
      return structuredClone(messages);
    },
    async appendMessage(input: {
      id?: string;
      sessionId: string;
      role: ChatMessage["role"];
      content: string;
      sources?: ChatMessage["sources"];
      metadata?: ChatMessage["metadata"];
    }) {
      const messages = control.sessions.get(input.sessionId);
      if (!messages) throw new Error("missing session fixture");
      const message: ChatMessage = {
        id: input.id ?? crypto.randomUUID(),
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        sources: input.sources ?? [],
        metadata: input.metadata ?? {},
        createdAt: new Date(1_785_744_000_000 + messages.length).toISOString(),
      };
      messages.push(message);
      return structuredClone(message);
    },
  }),
}));

vi.mock("@/lib/llm/runtime", () => ({
  createRuntimeLlmClient: () => ({
    async complete(request: LlmCompletionRequest) {
      const payload = JSON.parse(
        request.messages.at(-1)?.content ?? "{}",
      ) as Record<string, unknown>;
      control.composerPayloads.push(structuredClone(payload));
      const chunks = payload.knowledgeChunks as Array<{ id: string }>;
      const curriculum = chunks.find(
        ({ id }) => id === "student-camp-daily-outline",
      );
      if (!curriculum) throw new Error("curriculum chunk was not retrieved");
      return {
        content: JSON.stringify({
          answer:
            "第五天学习Agent、知识库、工作流、测试与边界，并完成个人学习助手Bot。",
          usedChunkIds: [curriculum.id],
          followUpSuggestions: [],
        }),
        model: "task-b02-history-mock",
        httpStatus: 200,
        latencyMs: 1,
      };
    },
  }),
}));

vi.mock("@/lib/time/shanghai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time/shanghai")>();
  return { ...actual, shanghaiToday: () => "2026-07-22" };
});

import { POST } from "@/app/api/chat/route";

const SESSION_A = "10000000-0000-4000-8000-000000000001";
const SESSION_B = "20000000-0000-4000-8000-000000000002";

function storedMessage(
  sessionId: string,
  index: number,
  content: string,
): ChatMessage {
  return {
    id: `${index.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
    sessionId,
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    sources: [],
    metadata: {},
    createdAt: new Date(1_785_744_000_000 + index).toISOString(),
  };
}

describe("TASK-B02 persisted conversation history prompting", () => {
  beforeEach(() => {
    control.composerPayloads = [];
    control.sessions = new Map([
      [
        SESSION_A,
        Array.from({ length: 10 }, (_, index) =>
          storedMessage(
            SESSION_A,
            index,
            index === 9
              ? "已选择第一期北京线下班。\n\n来源：应从Prompt剥离"
              : `会话A消息${index}`,
          ),
        ),
      ],
      [SESSION_B, [storedMessage(SESSION_B, 0, "会话B不得注入")]],
    ]);
  });

  it("injects only the latest eight messages from the current session", async () => {
    const state = createInitialConversationState();
    state.domain = "student";
    state.selectedEntityId = "camp-p1-bj";
    state.lastRecommendationIds = ["camp-p1-bj"];
    state.shortHistory = [
      { role: "assistant", content: "浏览器提交的历史不应覆盖服务端历史" },
    ];

    const httpResponse = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "message",
          message: "第五天学什么？",
          state,
          sessionId: SESSION_A,
          clientRequestId: "task-b02-history-current-session",
          testMode: false,
          diagnostics: true,
        }),
      }),
    );
    const response = (await httpResponse.json()) as {
      message: string;
      diagnostics?: { retrievedChunkIds: string[]; usedChunkIds: string[] };
    };

    if (httpResponse.status !== 200) {
      throw new Error(JSON.stringify(response));
    }
    expect(control.composerPayloads).toHaveLength(1);
    const payload = control.composerPayloads[0];
    const history = payload.recentConversation as Array<{
      role: string;
      content: string;
    }>;
    expect(history).toHaveLength(8);
    expect(history[0].content).toBe("会话A消息2");
    expect(history.at(-1)?.content).toBe("已选择第一期北京线下班。");
    expect(JSON.stringify(history)).not.toContain("会话B不得注入");
    expect(JSON.stringify(history)).not.toContain("浏览器提交的历史");
    expect(JSON.stringify(history)).not.toContain("来源：");
    expect(payload.currentUserMessage).toBe("第五天学什么？");
    expect(response.diagnostics?.retrievedChunkIds).toContain(
      "student-camp-daily-outline",
    );
    expect(response.diagnostics?.usedChunkIds).toEqual([
      "student-camp-daily-outline",
    ]);
    expect(response.message).toContain("来源：");
  });
});
