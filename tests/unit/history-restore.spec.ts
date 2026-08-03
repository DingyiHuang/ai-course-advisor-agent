import { describe, expect, it } from "vitest";

import { restoreConversation } from "@/lib/conversation/historyRestore";
import type { ChatMessage } from "@/lib/history/types";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function message(
  id: string,
  role: ChatMessage["role"],
  content: string,
  metadata: ChatMessage["metadata"],
): ChatMessage {
  return {
    id,
    sessionId: SESSION_ID,
    role,
    content,
    sources: [],
    metadata,
    createdAt: "2026-08-03T07:10:00.000Z",
  };
}

describe("browser conversation history restoration", () => {
  it("restores ordered UI messages and the latest sanitized state", () => {
    const restored = restoreConversation([
      message(
        "22222222-2222-4222-8222-222222222222",
        "user",
        "我在北京，第一期偏好线下",
        { clientRequestId: "request-1", kind: "ui_user" },
      ),
      message(
        "33333333-3333-4333-8333-333333333333",
        "assistant",
        "请问您能否前往北京参加线下课程？",
        {
          clientRequestId: "request-1",
          status: "needs_more_information",
          state: {
            version: 1,
            domain: "student",
            studentConstraints: {
              region: "beijing",
              availablePeriods: [1],
              modePreference: "offline",
            },
            teacherConstraints: {},
            lastRecommendationIds: [],
            pendingQuestionKeys: ["canTravel"],
            pendingQuestionOptions: ["可以", "不方便"],
            shortHistory: [],
            test: { failNextModelCall: false },
          },
          presentation: { recommendations: [] },
          actions: [],
          options: ["可以", "不方便"],
        },
      ),
    ]);

    expect(restored.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "我在北京，第一期偏好线下" },
      {
        role: "assistant",
        content: "请问您能否前往北京参加线下课程？",
      },
    ]);
    expect(restored.messages[1].options).toEqual(["可以", "不方便"]);
    expect(restored.state.domain).toBe("student");
    expect(restored.state.studentConstraints).toMatchObject({
      region: "beijing",
      availablePeriods: [1],
      modePreference: "offline",
    });
  });

  it("falls back to a safe initial state for messages without UI metadata", () => {
    const restored = restoreConversation([
      message(
        "44444444-4444-4444-8444-444444444444",
        "user",
        "联调用户消息",
        {},
      ),
    ]);

    expect(restored.messages[0].presentation).toEqual({ recommendations: [] });
    expect(restored.state.domain).toBe("unknown");
  });
});
