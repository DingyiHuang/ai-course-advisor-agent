import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ConversationStoreError } from "@/lib/history/conversationStore";
import {
  SupabaseConversationStore,
  type SupabaseClientFactory,
  type SupabaseConversationGateway,
  type SupabaseGatewayResult,
} from "@/lib/history/supabaseConversationStore";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const MESSAGE_ID_1 = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID_2 = "20000000-0000-4000-8000-000000000002";
const MESSAGE_ID_3 = "20000000-0000-4000-8000-000000000003";
const CREATED_AT = "2026-08-03T01:02:03.000Z";

const sessionRow = {
  id: SESSION_ID,
  created_at: CREATED_AT,
  updated_at: "2026-08-03T01:03:00.000Z",
  metadata: { channel: "h5" },
};

const source = {
  document: "A" as const,
  chapter: "课程安排",
  section: "日期",
  factIds: ["camp-bj-1.startDate"],
};

function success(data: unknown): SupabaseGatewayResult {
  return { data, error: null };
}

function makeGateway(): SupabaseConversationGateway {
  return {
    insertSession: vi.fn(async () => success(sessionRow)),
    selectSession: vi.fn(async () => success(sessionRow)),
    insertMessage: vi.fn(async (input) =>
      success({
        id: input.id ?? MESSAGE_ID_1,
        session_id: input.sessionId,
        role: input.role,
        content: input.content,
        sources: input.sources,
        metadata: input.metadata,
        created_at: input.createdAt ?? CREATED_AT,
      }),
    ),
    listMessages: vi.fn(async () => success([])),
  };
}

function makeStatefulGateway(): SupabaseConversationGateway {
  const sessions = new Map<string, Record<string, unknown>>();
  const messages: Array<Record<string, unknown>> = [];
  let sessionCounter = 0;
  let messageCounter = 0;

  return {
    async insertSession(metadata) {
      sessionCounter += 1;
      const suffix = String(sessionCounter).padStart(12, "0");
      const row = {
        ...sessionRow,
        id: `10000000-0000-4000-8000-${suffix}`,
        metadata,
      };
      sessions.set(row.id, row);
      return success(row);
    },
    async selectSession(sessionId) {
      return success(sessions.get(sessionId) ?? null);
    },
    async insertMessage(input) {
      messageCounter += 1;
      const suffix = String(messageCounter).padStart(12, "0");
      const row = {
        id: input.id ?? `20000000-0000-4000-8000-${suffix}`,
        session_id: input.sessionId,
        role: input.role,
        content: input.content,
        sources: input.sources,
        metadata: input.metadata,
        created_at: input.createdAt ?? CREATED_AT,
      };
      messages.push(row);
      return success(row);
    },
    async listMessages(sessionId) {
      return success(
        messages.filter((message) => message.session_id === sessionId),
      );
    },
  };
}

describe("SupabaseConversationStore", () => {
  it("satisfies the shared create, append, order, and isolation contract", async () => {
    const store = new SupabaseConversationStore({
      gateway: makeStatefulGateway(),
    });
    const firstSession = await store.createSession({});
    const secondSession = await store.createSession({});
    await store.appendMessage({
      sessionId: firstSession.id,
      role: "assistant",
      content: "second",
      sources: [source],
      createdAt: "2026-08-03T01:00:02.000Z",
    });
    await store.appendMessage({
      sessionId: firstSession.id,
      role: "user",
      content: "first",
      createdAt: "2026-08-03T01:00:01.000Z",
    });
    await store.appendMessage({
      sessionId: secondSession.id,
      role: "user",
      content: "other session",
    });

    const firstMessages = await store.getMessages(firstSession.id);
    expect(firstMessages.map(({ content }) => content)).toEqual([
      "first",
      "second",
    ]);
    expect(firstMessages[1].sources).toEqual([source]);
    await expect(store.getMessages(secondSession.id)).resolves.toHaveLength(1);
  });

  it("maps session rows from snake_case to the shared session shape", async () => {
    const gateway = makeGateway();
    const store = new SupabaseConversationStore({ gateway });

    await expect(
      store.createSession({ metadata: { channel: "h5" } }),
    ).resolves.toEqual({
      id: SESSION_ID,
      createdAt: CREATED_AT,
      updatedAt: "2026-08-03T01:03:00.000Z",
      metadata: { channel: "h5" },
    });
    expect(gateway.insertSession).toHaveBeenCalledWith({ channel: "h5" });
  });

  it("checks the session and maps assistant messages with sources", async () => {
    const gateway = makeGateway();
    const store = new SupabaseConversationStore({ gateway });
    const sourceWithUnapprovedField = {
      ...source,
      rawText: "must-not-be-stored",
    };

    await expect(
      store.appendMessage({
        id: MESSAGE_ID_1,
        sessionId: SESSION_ID,
        role: "assistant",
        content: "可以选择第一期。",
        sources: [sourceWithUnapprovedField],
        metadata: { state: "recommended" },
        createdAt: CREATED_AT,
      }),
    ).resolves.toEqual({
      id: MESSAGE_ID_1,
      sessionId: SESSION_ID,
      role: "assistant",
      content: "可以选择第一期。",
      sources: [source],
      metadata: { state: "recommended" },
      createdAt: CREATED_AT,
    });

    expect(gateway.selectSession).toHaveBeenCalledWith(SESSION_ID);
    expect(gateway.insertMessage).toHaveBeenCalledWith({
      id: MESSAGE_ID_1,
      sessionId: SESSION_ID,
      role: "assistant",
      content: "可以选择第一期。",
      sources: [source],
      metadata: { state: "recommended" },
      createdAt: CREATED_AT,
    });
  });

  it("checks existence before listing and returns a stable message order", async () => {
    const gateway = makeGateway();
    const selectSession = vi.mocked(gateway.selectSession);
    const listMessages = vi.mocked(gateway.listMessages);
    listMessages.mockResolvedValue(
      success([
        {
          id: MESSAGE_ID_3,
          session_id: SESSION_ID,
          role: "assistant",
          content: "第二条",
          sources: [],
          metadata: {},
          created_at: "2026-08-03T02:00:00.000Z",
        },
        {
          id: MESSAGE_ID_2,
          session_id: SESSION_ID,
          role: "user",
          content: "同一时间较后 ID",
          sources: [],
          metadata: {},
          created_at: CREATED_AT,
        },
        {
          id: MESSAGE_ID_1,
          session_id: SESSION_ID,
          role: "user",
          content: "第一条",
          sources: [],
          metadata: {},
          created_at: CREATED_AT,
        },
      ]),
    );
    const store = new SupabaseConversationStore({ gateway });

    const messages = await store.getMessages(SESSION_ID);

    expect(messages.map((message) => message.content)).toEqual([
      "第一条",
      "同一时间较后 ID",
      "第二条",
    ]);
    expect(selectSession.mock.invocationCallOrder[0]).toBeLessThan(
      listMessages.mock.invocationCallOrder[0],
    );
    expect(listMessages).toHaveBeenCalledWith(SESSION_ID);
  });

  it("returns the shared not-found error without querying messages", async () => {
    const gateway = makeGateway();
    vi.mocked(gateway.selectSession).mockResolvedValue(success(null));
    const store = new SupabaseConversationStore({ gateway });

    await expect(store.getMessages(SESSION_ID)).rejects.toMatchObject({
      name: "ConversationStoreError",
      code: "session_not_found",
      message: "Conversation session was not found.",
    });
    expect(gateway.listMessages).not.toHaveBeenCalled();
  });

  it("converts provider failures without exposing the provider response", async () => {
    const gateway = makeGateway();
    vi.mocked(gateway.insertSession).mockResolvedValue({
      data: null,
      error: { message: "provider-detail-placeholder", response: { code: 500 } },
    });
    const store = new SupabaseConversationStore({ gateway });

    try {
      await store.createSession({});
      throw new Error("Expected createSession to reject.");
    } catch (error) {
      expect(error).toBeInstanceOf(ConversationStoreError);
      expect(error).toMatchObject({
        code: "persistence_error",
        message: "Conversation store operation failed.",
      });
      expect(String(error)).not.toContain("provider-detail-placeholder");
    }
  });

  it("creates a server-only client with all auth session behaviors disabled", () => {
    const clientFactory: SupabaseClientFactory = vi.fn(
      () => ({}) as SupabaseClient,
    );

    new SupabaseConversationStore({
      url: "https://project.invalid",
      secretKey: "credential-placeholder",
      clientFactory,
    });

    expect(clientFactory).toHaveBeenCalledWith(
      "https://project.invalid",
      "credential-placeholder",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
  });

  it("rejects missing server configuration with the shared error", () => {
    expect(() => new SupabaseConversationStore()).toThrowError(
      expect.objectContaining({
        name: "ConversationStoreError",
        code: "configuration_error",
      }),
    );
  });
});

describe("Supabase chat history migration", () => {
  it("creates the two RLS-protected tables without public policies", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260803000000_create_chat_history.sql",
      ),
      "utf8",
    );

    expect(migration).toMatch(/create table public\.chat_sessions/i);
    expect(migration).toMatch(/create table public\.chat_messages/i);
    expect(migration).toMatch(
      /references public\.chat_sessions\(id\) on delete cascade/i,
    );
    expect(migration).toMatch(
      /on public\.chat_messages \(session_id, created_at, id\)/i,
    );
    expect(migration.match(/timestamptz\(3\)/gi)).toHaveLength(3);
    expect(migration).toMatch(/check \(role in \('user', 'assistant', 'system'\)\)/i);
    expect(migration).toMatch(/jsonb_typeof\(sources\) = 'array'/i);
    expect(migration).toMatch(/chat_messages_update_session_timestamp/i);
    expect(migration).toMatch(
      /revoke all on function public\.update_chat_session_timestamp\(\)/i,
    );
    expect(migration).toMatch(
      /alter table public\.chat_sessions enable row level security/i,
    );
    expect(migration).toMatch(
      /alter table public\.chat_messages enable row level security/i,
    );
    expect(migration).not.toMatch(/\bcreate\s+policy\b/i);
  });

  it("records only the minimum service-role table grants in a follow-up migration", () => {
    const migration = readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260803000100_grant_chat_history_service_role.sql",
      ),
      "utf8",
    );
    const normalized = migration.replace(/\s+/g, " ");

    expect(normalized).toMatch(
      /grant select, insert, update, delete on table public\.chat_sessions to service_role;/i,
    );
    expect(normalized).toMatch(
      /grant select, insert, delete on table public\.chat_messages to service_role;/i,
    );
    expect(normalized).not.toMatch(/\bgrant all\b/i);
    expect(normalized).not.toMatch(/\bto (anon|authenticated)\b/i);
    expect(normalized).not.toMatch(/\bcreate policy\b/i);
    expect(normalized).not.toMatch(/disable row level security/i);
  });
});
