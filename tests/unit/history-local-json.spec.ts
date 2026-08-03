import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationStore } from "@/lib/history/conversationStore";
import { ConversationStoreError } from "@/lib/history/conversationStore";
import { LocalJsonConversationStore } from "@/lib/history/localJsonConversationStore";

const SOURCE = {
  document: "B" as const,
  chapter: "课程安排",
  section: "线上直播",
  factIds: ["camp-p1-online.startDate"],
};

describe("ConversationStore contract: LocalJsonConversationStore", () => {
  let testRoot: string;
  let store: LocalJsonConversationStore;

  beforeEach(async () => {
    testRoot = await mkdtemp(
      path.join(tmpdir(), "ai-course-advisor-local-json-"),
    );
    store = new LocalJsonConversationStore({ rootDirectory: testRoot });
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it("creates a session with a random UUID through the shared contract", async () => {
    const conversationStore: ConversationStore = store;
    const session = await conversationStore.createSession({
      metadata: { channel: "local-test" },
    });

    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(session.createdAt).toBe(session.updatedAt);
    expect(session.metadata).toEqual({ channel: "local-test" });
  });

  it("appends and reads a user message", async () => {
    const session = await store.createSession({});
    const written = await store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: "请介绍全部学生课程。",
    });

    expect(written.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await expect(store.getMessages(session.id)).resolves.toEqual([written]);
  });

  it("preserves assistant sources and metadata", async () => {
    const session = await store.createSession({});
    const written = await store.appendMessage({
      sessionId: session.id,
      role: "assistant",
      content: "线上直播共有三期可选。",
      sources: [SOURCE],
      metadata: { verified: true },
    });

    expect(written.sources).toEqual([SOURCE]);
    expect(written.metadata).toEqual({ verified: true });
    await expect(store.getMessages(session.id)).resolves.toEqual([written]);
  });

  it("sorts by creation time and then by ID for stable ties", async () => {
    const session = await store.createSession({});
    const inputs = [
      {
        id: "00000000-0000-4000-8000-000000000003",
        createdAt: "2026-08-03T01:00:02.000Z",
        content: "third",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        createdAt: "2026-08-03T01:00:01.000Z",
        content: "second",
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        createdAt: "2026-08-03T01:00:01.000Z",
        content: "first",
      },
    ];

    for (const input of inputs) {
      await store.appendMessage({
        ...input,
        sessionId: session.id,
        role: "user",
      });
    }

    const messages = await store.getMessages(session.id);
    expect(messages.map(({ id }) => id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000003",
    ]);
  });

  it("normalizes accepted timestamps to the shared ISO format", async () => {
    const session = await store.createSession({});
    const message = await store.appendMessage({
      sessionId: session.id,
      role: "user",
      content: "timestamp normalization",
      createdAt: "2026-08-03T09:00:00+08:00",
    });

    expect(message.createdAt).toBe("2026-08-03T01:00:00.000Z");
  });

  it("treats a stable message ID as an idempotency key", async () => {
    const session = await store.createSession({});
    const input = {
      id: "00000000-0000-4000-8000-000000000010",
      sessionId: session.id,
      role: "user" as const,
      content: "idempotent message",
      createdAt: "2026-08-03T01:00:00.000Z",
    };
    const first = await store.appendMessage(input);
    const retried = await store.appendMessage({
      ...input,
      createdAt: "2026-08-03T01:05:00.000Z",
    });

    expect(retried).toEqual(first);
    await expect(store.getMessages(session.id)).resolves.toEqual([first]);
  });

  it("returns the standard error for an unknown session", async () => {
    const unknownSessionId = "00000000-0000-4000-8000-000000000000";

    await expect(store.getMessages(unknownSessionId)).rejects.toMatchObject({
      name: "ConversationStoreError",
      code: "session_not_found",
    } satisfies Partial<ConversationStoreError>);
    await expect(
      store.appendMessage({
        sessionId: unknownSessionId,
        role: "user",
        content: "unknown",
      }),
    ).rejects.toMatchObject({
      name: "ConversationStoreError",
      code: "session_not_found",
    } satisfies Partial<ConversationStoreError>);
  });

  it("keeps messages isolated by session", async () => {
    const firstSession = await store.createSession({});
    const secondSession = await store.createSession({});
    await store.appendMessage({
      sessionId: firstSession.id,
      role: "user",
      content: "first session",
    });
    await store.appendMessage({
      sessionId: secondSession.id,
      role: "assistant",
      content: "second session",
      sources: [SOURCE],
    });

    const [firstMessages, secondMessages] = await Promise.all([
      store.getMessages(firstSession.id),
      store.getMessages(secondSession.id),
    ]);
    expect(firstMessages.map(({ content }) => content)).toEqual([
      "first session",
    ]);
    expect(secondMessages.map(({ content }) => content)).toEqual([
      "second session",
    ]);
  });

  it("rejects traversal-shaped identifiers as invalid input", async () => {
    await expect(store.getMessages("../outside")).rejects.toMatchObject({
      name: "ConversationStoreError",
      code: "invalid_input",
    } satisfies Partial<ConversationStoreError>);
  });
});
