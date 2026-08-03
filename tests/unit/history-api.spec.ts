import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConversationStoreError } from "@/lib/history/conversationStore";

const control = vi.hoisted(() => ({
  store: {
    createSession: vi.fn(),
    appendMessage: vi.fn(),
    getMessages: vi.fn(),
  },
}));

vi.mock("@/lib/history/createConversationStore", () => ({
  createConversationStore: () => control.store,
}));

import { POST } from "@/app/api/history/sessions/route";
import { GET } from "@/app/api/history/sessions/[sessionId]/messages/route";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("conversation history route handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a server-generated web session", async () => {
    control.store.createSession.mockResolvedValue({
      id: SESSION_ID,
      createdAt: "2026-08-03T07:10:00.000Z",
      updatedAt: "2026-08-03T07:10:00.000Z",
      metadata: { channel: "web" },
    });

    const response = await POST();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      session: { id: SESSION_ID },
    });
    expect(control.store.createSession).toHaveBeenCalledWith({
      metadata: { channel: "web" },
    });
  });

  it("awaits dynamic params and returns ordered store messages", async () => {
    control.store.getMessages.mockResolvedValue([
      { id: "22222222-2222-4222-8222-222222222222", role: "user" },
      { id: "33333333-3333-4333-8333-333333333333", role: "assistant" },
    ]);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ sessionId: SESSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.messages.map(({ role }: { role: string }) => role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(control.store.getMessages).toHaveBeenCalledWith(SESSION_ID);
  });

  it("normalizes missing sessions without exposing a provider response", async () => {
    control.store.getMessages.mockRejectedValue(
      new ConversationStoreError("session_not_found"),
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ sessionId: SESSION_ID }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "session_not_found" });
  });
});
